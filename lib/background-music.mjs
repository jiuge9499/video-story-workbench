import fs from 'node:fs';
import path from 'node:path';
import {ROOT} from './store.mjs';
import {run} from './process.mjs';

// Narration is normalized to -18 LUFS by speech.py. Keep the bed 7 LU
// below it before voice-driven ducking, leaving the voice untouched.
export async function prepareBackgroundMusic(narration,output,duration,signal){
  const source=path.join(ROOT,'背景音乐.mp3');
  if(!fs.existsSync(source))throw Error('缺少背景音乐.mp3，请放回工作台根目录后重新合成');
  const fadeIn=Math.min(.6,duration/2),fadeOut=Math.min(.8,duration/2);
  // Retain 70% of the bed: ducking cannot reduce music by more than 3.1 dB.
  const filters=[
    '[0:a]loudnorm=I=-25:TP=-6:LRA=7,aresample=48000,aformat=channel_layouts=stereo,asplit=2[base][music]',
    '[1:a]apad,aresample=48000,aformat=channel_layouts=stereo[voice]',
    `[music][voice]sidechaincompress=threshold=0.08:ratio=2:attack=25:release=250:makeup=1[ducked];[base][ducked]amix=inputs=2:weights=0.7 0.3:normalize=0,afade=t=in:d=${fadeIn},afade=t=out:st=${duration-fadeOut}:d=${fadeOut},atrim=duration=${duration}[bed]`,
  ].join(';');
  await run('ffmpeg',['-v','error','-y','-stream_loop','-1','-i',source,'-i',narration,'-filter_complex',filters,'-map','[bed]','-t',String(duration),'-ar','48000','-c:a','pcm_s16le',output],{signal,timeout:300000});
}
