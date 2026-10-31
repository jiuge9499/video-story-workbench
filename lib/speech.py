"""Synthesize scene audio and captions with service-provided word timings."""
import asyncio
import html
import json
import subprocess
import sys
import re
from pathlib import Path

# Keep the service compatibility fix local to this workbench.
sys.path.insert(0, str(Path(__file__).resolve().parent / 'python-packages'))

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


async def main():
    import edge_tts
    config = json.loads(Path(sys.argv[1]).read_text())
    dest = Path(sys.argv[1]).parent
    offset = 0.0
    captions, scenes, files = [], [], []
    for i, scene in enumerate(config['scenes']):
        raw = dest / f'speech-{i}.mp3'
        wav = dest / f'speech-{i}.wav'
        boundary_file = dest / f'boundaries-{i}.json'
        if raw.exists() and boundary_file.exists():
            words = json.loads(boundary_file.read_text())
        else:
            for attempt in range(2):
                words = []
                try:
                    with raw.open('wb') as output:
                        async for item in edge_tts.Communicate(scene['text'], config['voice'], boundary='WordBoundary').stream():
                            if item['type'] == 'audio':
                                output.write(item['data'])
                            elif item['type'] == 'WordBoundary':
                                words.append({'start': item['offset'] / 1e7, 'end': (item['offset'] + item['duration']) / 1e7, 'text': html.unescape(item['text'])})
                    break
                except edge_tts.exceptions.NoAudioReceived:
                    if attempt:
                        raise
                    await asyncio.sleep(1)
            if not words:
                raise RuntimeError('未收到配音时间信息')
            boundary_file.write_text(json.dumps(words, ensure_ascii=False))
        paced = dest / f'paced-{i}.wav'
        subprocess.run(['ffmpeg','-v','error','-y','-i',str(raw),'-af',f"atempo={config['speed']}",'-ar','48000','-ac','1',str(paced)], check=True)
        cuts = compact_audio(paced, wav)
        paced.unlink()
        duration = float(call(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',str(wav)]))
        # Restore authored punctuation while keeping service-provided word timings.
        source = scene['text']
        cursor = 0
        group = None
        for word in words:
            token = word['text']
            index = source.find(token, cursor)
            display = (source[cursor:index] if index >= cursor else '') + token
            cursor = index + len(token) if index >= 0 else cursor
            while cursor < len(source) and source[cursor] in '，。！？；：、,.!?;:':
                display += source[cursor]
                cursor += 1
            start = offset + min(duration, retime(word['start'] / config['speed'], cuts))
            end = offset + min(duration, retime(word['end'] / config['speed'], cuts))
            if group and len(group['text']) + len(display) > 18:
                captions.append(group)
                group = None
            if group is None:
                group = {'start': start, 'end': end, 'text': display.strip()}
            else:
                group['text'] += display
                group['end'] = end
            if display.endswith(('，','。','！','？','；',',','.','!','?',';')):
                captions.append(group)
                group = None
        if group:
            captions.append(group)
        if cursor < len(source) and source[cursor:].strip() and captions:
            captions[-1]['text'] += source[cursor:].strip()
        scenes.append({'id':scene['id'], 'start':offset, 'end':offset+duration})
        offset += duration
        files.append(wav.name)
        print(json.dumps({'scene':i+1,'total':len(config['scenes'])}), flush=True)
    (dest/'concat.txt').write_text(''.join(f"file '{f}'\n" for f in files))
    subprocess.run(['ffmpeg','-v','error','-y','-f','concat','-safe','1','-i',str(dest/'concat.txt'),'-af','loudnorm=I=-18:TP=-1.5:LRA=7','-ar','48000',str(dest/'narration.wav')],check=True)
    for i, caption in enumerate(captions):
        next_start = captions[i+1]['start'] if i+1 < len(captions) else offset
        caption['end'] = min(next_start, max(caption['end'], caption['start']+0.25) + 0.08)
    (dest/'speech.json').write_text(json.dumps({'alignment':'word-v2-compact','duration':offset,'scenes':scenes,'captions':captions},ensure_ascii=False,indent=2))

if __name__ == '__main__':
    asyncio.run(main())
