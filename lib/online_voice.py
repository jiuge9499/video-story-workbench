"""Restore the existing online voices without changing the local cloning service."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent / 'python-packages'))


class OnlineVoiceClient:
    def __init__(self, cache_dir):
        self.cache = Path(cache_dir) / 'online'

    def synthesize(self, text, output, voice, speed=1.0, timeout=3600, idempotency_key=None):
        if not re.fullmatch(r'[a-z]{2}-[A-Z]{2}-.+Neural', voice):
            raise ValueError('在线音色编号无效')
        key = hashlib.sha256(json.dumps([text, voice, float(speed)], ensure_ascii=False).encode()).hexdigest()
        self.cache.mkdir(parents=True, exist_ok=True)
        cached = self.cache / (key + '.mp3')
        if not cached.is_file() or not cached.stat().st_size:
            import edge_tts

            async def generate():
                pending = self.cache / (key + '.pending.mp3')
                try:
                    for attempt in range(2):
                        try:
                            await edge_tts.Communicate(text, voice, boundary='WordBoundary').save(str(pending))
                            break
                        except edge_tts.exceptions.NoAudioReceived:
                            if attempt:
                                raise
                            await asyncio.sleep(1)
                    if not pending.is_file() or not pending.stat().st_size:
                        raise RuntimeError('在线配音没有返回声音')
                    if float(speed) == 1:
                        os.replace(pending, cached)
                    else:
                        paced = self.cache / (key + '.paced.mp3')
                        try:
                            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(pending),
                                            '-af', f'atempo={float(speed)}', '-ar', '44100', '-ac', '1',
                                            '-b:a', '192k', str(paced)], check=True, timeout=120)
                            os.replace(paced, cached)
                        finally:
                            paced.unlink(missing_ok=True)
                finally:
                    pending.unlink(missing_ok=True)

            asyncio.run(generate())
        output = Path(output)
        output.parent.mkdir(parents=True, exist_ok=True)
        pending = output.with_suffix('.pending.mp3')
        shutil.copy2(cached, pending)
        os.replace(pending, output)
        return {'id':key, 'warnings':[], 'output':str(output)}
