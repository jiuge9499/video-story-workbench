"""Shared local TTS client adapter; keep narration.wav and speech.json for rendering."""
import difflib
import hashlib
import importlib.util
import json
import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.error import URLError
from captions import phrase_captions
from chinese_alignment import simplified, comparison_units

PROVIDER = "local-qwen-voice-v1"
ALIGNMENT = "shared-whisper-chars-v1"
DEFAULT_CLIENT = Path(__file__).resolve().parents[2] / "ai-wenzi-workflow-main/src/mine/voice_service/client.py"


def plain_narration(text):
    method = json.loads(Path(__file__).with_name('production-method.json').read_text(encoding='utf-8'))
    return re.sub(method['narration']['emphasisPattern'], r'\2', text)


def atomic_json(file, value):
    file = Path(file)
    file.parent.mkdir(parents=True, exist_ok=True)
    temp = file.with_suffix(file.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, file)


def load_client(entry):
    spec = importlib.util.spec_from_file_location("shared_voice_client", entry)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def synthesize_scene(client, text, output, config, wait=time.sleep):
    """Persist request identity outside the workflow job, including terminal failures."""
    text = plain_narration(text)
    fingerprint = hashlib.sha256(json.dumps(
        [config.get("provider", PROVIDER), text, config["voice"], float(config.get("speed", 1.0))],
        ensure_ascii=False).encode()).hexdigest()
    record_file = Path(config["cacheDir"]) / (fingerprint + ".json")
    record = json.loads(record_file.read_text()) if record_file.exists() else {"attempt": 1}
    prefix = f"video-story:{config['projectId']}:{fingerprint}"
    # Terminal failure requires a new key. Connection loss/timeout keeps the same one.
    if record.get("state") == "failed":
        record["attempt"] += 1
    failures = 0
    while True:
        key = f"{prefix}:v{record['attempt']}"
        record.update(key=key, state="waiting")
        atomic_json(record_file, record)
        for network_try in range(3):
            try:
                result = client.synthesize(text=text, output=str(output), voice=config["voice"],
                    speed=config.get("speed", 1.0), timeout=config.get("waitTimeout", 3600),
                    idempotency_key=key)
                record.update(state="succeeded", jobId=result["id"], warnings=result.get("warnings", []))
                atomic_json(record_file, record)
                return result
            except Exception as exc:
                message = str(exc)
                if re.search(r"配音任务 [0-9a-f]+ 失败", message):
                    record.update(state="failed", error=message)
                    atomic_json(record_file, record)
                    failures += 1
                    if failures >= 2:
                        raise
                    record["attempt"] += 1
                    break
                transient = isinstance(exc, (TimeoutError, URLError, ConnectionError, socket.timeout)) or bool(
                    re.search(r"队列已满|429|连接|timed out|Connection", message, re.I))
                record.update(error=message, state="waiting" if transient else "error")
                atomic_json(record_file, record)
                if not transient or network_try == 2:
                    raise
                print(json.dumps({"retry": network_try + 1, "key": key, "message": message}, ensure_ascii=False), flush=True)
                wait([2, 5][network_try])
        else:
            raise RuntimeError("配音等待未完成，请复用原任务编号重试")


def call(args):
    return subprocess.check_output(args, text=True)

def silence_ranges(log, duration):
    ranges, start = [], None
    for match in re.finditer(r'silence_(start|end): ([0-9.]+)', log):
        kind, value = match[1], float(match[2])
        if kind == 'start':
            start = value
        elif start is not None:
            ranges.append((start, min(value, duration)))
            start = None
    if start is not None:
        ranges.append((start, duration))
    return ranges


def pause_cuts(duration, silences):
    """Only remove measured silence; leave breath room around each edit."""
    cuts = []
    for start, end in silences:
        start, end = max(0, start), min(duration, end)
        if start <= .001 and end >= duration - .001:
            raise RuntimeError('配音没有可用的有声内容')
        if start <= .001:
            cut = (0, end - .06)
        elif end >= duration - .001:
            cut = (start + .14, duration)
        elif end - start > .45:
            cut = (start + .14, end - .14)
        else:
            continue
        if cut[1] > cut[0]:
            cuts.append(cut)
    if duration - sum(b-a for a,b in cuts) < .05:
        raise RuntimeError('配音没有可用的有声内容')
    return cuts


def retime(time, cuts):
    return time - sum(max(0, min(time, end) - start) for start, end in cuts)


def compact_audio(source, target):
    duration = float(call(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(source)]))
    scan = subprocess.run(['ffmpeg','-hide_banner','-i',str(source),'-af',
                           'silencedetect=noise=-45dB:d=0.10','-f','null','-'],
                          capture_output=True, text=True, check=True)
    cuts = pause_cuts(duration, silence_ranges(scan.stderr, duration))
    segments, cursor = [], 0
    for start, end in cuts:
        if start > cursor:
            segments.append((cursor, start))
        cursor = end
    if cursor < duration:
        segments.append((cursor, duration))
    filters = [f'[0:a]atrim=start={a:.9f}:end={b:.9f},asetpts=PTS-STARTPTS[a{i}]'
               for i, (a,b) in enumerate(segments)]
    filters.append(''.join(f'[a{i}]' for i in range(len(segments))) +
                   f'concat=n={len(segments)}:v=0:a=1[out]')
    subprocess.run(['ffmpeg','-v','error','-y','-i',str(source),'-filter_complex',
                    ';'.join(filters),'-map','[out]','-ar','48000','-ac','1',str(target)], check=True)
    return cuts


def match_character_times(authored, chars, times):
    """Compare glyphs in one script while preserving original character positions."""
    timeline = [None] * len(authored)
    expected = comparison_units(simplified(''.join(c for _, c in authored)))
    recognized = comparison_units(simplified(''.join(chars)))
    for block in difflib.SequenceMatcher(None, [u[0] for u in expected],
                                        [u[0] for u in recognized], autojunk=False).get_matching_blocks():
        for k in range(block.size):
            _, start, end = expected[block.a+k]
            _, heard_start, heard_end = recognized[block.b+k]
            for i in range(start, end):
                if end-start == heard_end-heard_start:
                    timeline[i] = times[heard_start+i-start]
                else:
                    left = times[heard_start]
                    right = times[min(heard_end, len(times)-1)]
                    timeline[i] = left + (right-left)*(i-start)/(end-start)
    known = [i for i, t in enumerate(timeline) if t is not None]
    coverage = len(known) / len(authored)
    if coverage < .65:
        raise RuntimeError(f'字幕与原文仅对齐 {coverage:.0%}，已暂停后续制作，需复核配音')
    return timeline, known, coverage


def align_words(source, audio, dest, index, tools):
    """Reuse installed whisper.cpp and its model; map measured character times to authored text."""
    whisper = tools / "whisper.cpp"
    binary = next((p for p in whisper.glob("**/whisper-cli") if p.is_file() and os.access(p, os.X_OK)), None)
    model = whisper / "ggml-large-v3-turbo.bin"
    if not binary or not model.is_file():
        raise RuntimeError("现有 Whisper 时间对齐环境缺失，已暂停后续制作")
    wav, base = dest / f"align-{index}.wav", dest / f"align-{index}"
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(audio), '-ar', '16000', '-ac', '1', str(wav)], check=True)
    try:
        result = subprocess.run([str(binary), '-m', str(model), '-l', 'zh', '-mc', '0', '-ml', '1',
            '-oj', '-of', str(base), '-f', str(wav)], capture_output=True, timeout=600)
        if result.returncode:
            raise RuntimeError("字幕时间对齐失败：" + result.stderr.decode(errors='replace')[-600:])
        segments = json.loads(base.with_suffix('.json').read_bytes().decode('latin1'))['transcription']
    finally:
        wav.unlink(missing_ok=True)
    buf, owners = bytearray(), []
    for segment in segments:
        raw = segment['text'].encode('latin1')
        buf.extend(raw)
        owners.extend([segment['offsets']['from'] / 1000] * len(raw))
    chars, times, pos = [], [], 0
    for char in buf.decode('utf-8', errors='replace'):
        size = len(char.encode('utf-8'))
        if re.match(r'[^\W_]', char):
            chars.append(char.lower())
            times.append(owners[min(pos, len(owners)-1)])
        pos += size
    authored = [(m.start(), m.group().lower()) for m in re.finditer(r'[^\W_]', source)]
    if not authored or not chars:
        raise RuntimeError('配音没有可用的字幕时间信息，已暂停后续制作')
    timeline, known, coverage = match_character_times(authored, chars, times)
    duration = float(call(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(audio)]))
    for i, value in enumerate(timeline):
        if value is None:
            left = max((k for k in known if k < i), default=None)
            right = min((k for k in known if k > i), default=None)
            timeline[i] = (timeline[right] if left is None else timeline[left] if right is None else
                           timeline[left] + (timeline[right]-timeline[left])*(i-left)/(right-left))
        timeline[i] = min(duration, max(timeline[i-1] if i else 0, timeline[i]))
    by_position = {position: i for i, (position, _) in enumerate(authored)}
    words = []
    for match in re.finditer(r"[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*|[^\W_]", source):
        a = by_position[match.start()]
        b = max(by_position[k] for k in range(match.start(), match.end()) if k in by_position) + 1
        words.append({'text':match.group(), 'start':timeline[a], 'end':timeline[b] if b < len(timeline) else duration})
    atomic_json(dest / f'boundaries-{index}.json', {'coverage':coverage, 'words':words, 'recognizedText':''.join(chars)})
    return words


def main(config_file):
    config = json.loads(config_file.read_text())
    dest = config_file.parent.resolve()
    if not isinstance(config.get('voice'), str) or not config['voice'].strip():
        raise ValueError('请选择配音音色')
    online = bool(re.fullmatch(r'[a-z]{2}-[A-Z]{2}-.+Neural', config['voice']))
    provider = 'edge-tts-v1' if online else PROVIDER
    config['provider'] = provider
    if not .5 <= float(config.get('speed', 1.0)) <= 2:
        raise ValueError('配音语速须为 0.5–2.0')
    scenes_input = [dict(s, text=plain_narration(s['text'])) for s in config['scenes']]
    config['script'] = plain_narration(config.get('script', ''))
    if not scenes_input or not config.get('script', '').strip() or any(not s['text'].strip() for s in scenes_input):
        raise ValueError('请先确定完整文案和每镜旁白')
    normalize = lambda s: re.sub(r'\s', '', s)
    if normalize(''.join(s['text'] for s in scenes_input)) != normalize(config['script']):
        raise ValueError('分镜旁白与最终文案不一致，已暂停配音')
    entry = Path(config.get('client') or os.environ.get('STORY_VOICE_CLIENT') or DEFAULT_CLIENT).resolve()
    if online:
        from online_voice import OnlineVoiceClient
        client = OnlineVoiceClient(config['cacheDir'])
    else:
        client = load_client(entry)
    offset = 0.0
    captions, scenes, files, warnings, jobs = [], [], [], [], []
    (dest/'final-script.txt').write_text(config['script'], encoding='utf-8')
    for i, scene in enumerate(scenes_input):
        raw, wav = dest / f'speech-{i}.mp3', dest / f'speech-{i}.wav'
        result = synthesize_scene(client, scene['text'], raw, config)
        jobs.append({'sceneId':scene['id'], 'id':result['id'], 'output':str(raw), 'warnings':result.get('warnings', [])})
        warnings.extend({'scene':i+1, **w} for w in result.get('warnings', []))
        atomic_json(dest/'service-jobs.json', {'provider':provider, 'jobs':jobs, 'warnings':warnings})
        cuts = compact_audio(raw, wav)  # The shared service has already applied speed.
        duration = float(call(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(wav)]))
        boundary_file = dest / f'boundaries-{i}.json'
        boundary_key = hashlib.sha256(raw.read_bytes()).hexdigest()
        cached = json.loads(boundary_file.read_text()) if boundary_file.exists() else {}
        if cached.get('audioHash') == boundary_key:
            words = cached['words']
        else:
            words = align_words(scene['text'], raw, dest, i, entry.parents[3] / 'tools')
            cached = json.loads(boundary_file.read_text())
            atomic_json(boundary_file, {**cached, 'audioHash':boundary_key})
        if online:
            # Reuse the measured transcript; compare without loading another speech model.
            checker = entry.parents[3] / 'tools/voice_check.py'
            spec = importlib.util.spec_from_file_location('workbench_online_voice_check', checker)
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            differences = module.compare(scene['text'], cached.get('recognizedText', ''))
            if differences:
                warning = {'part':1, 'differences':differences}
                jobs[-1]['warnings'] = [warning]
                warnings.append({'scene':i+1, **warning})
            atomic_json(dest/'service-jobs.json', {'provider':provider, 'jobs':jobs, 'warnings':warnings})
        timed_words = [dict(text=w['text'], start=offset+min(duration, retime(w['start'], cuts)),
                           end=offset+min(duration, retime(w['end'], cuts))) for w in words]
        captions.extend(phrase_captions(scene['text'], timed_words))
        scenes.append({'id':scene['id'], 'start':offset, 'end':offset+duration})
        offset += duration
        files.append(wav.name)
        print(json.dumps({'scene':i+1, 'total':len(scenes_input), 'warnings':len(warnings)}), flush=True)
    (dest/'concat.txt').write_text(''.join(f"file '{f}'\n" for f in files))
    subprocess.run(['ffmpeg','-v','error','-y','-f','concat','-safe','1','-i',str(dest/'concat.txt'),
                    '-af','loudnorm=I=-18:TP=-1.5:LRA=7','-ar','48000',str(dest/'narration.wav')], check=True)
    for i, caption in enumerate(captions):
        next_start = captions[i+1]['start'] if i+1 < len(captions) else offset
        caption['end'] = min(next_start, max(caption['end'], caption['start']+.25)+.08)
    report = {'provider':provider, 'alignment':ALIGNMENT, 'status':'review' if warnings else 'ready',
              'voice':config['voice'], 'speed':config.get('speed',1.0), 'duration':offset,
              'warnings':warnings, 'jobs':jobs, 'scenes':scenes, 'captions':captions}
    atomic_json(dest/'speech.json', report)
    return 2 if warnings else 0


if __name__ == '__main__':
    config_file = Path(sys.argv[1]).resolve()
    try:
        sys.exit(main(config_file))
    except Exception as exc:
        atomic_json(config_file.parent/'failure.json', {'status':'failed', 'error':str(exc)})
        print(json.dumps({'error':str(exc)}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
