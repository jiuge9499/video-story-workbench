import path from 'node:path';
import {run} from './process.mjs';

// Approved B5 mix: unchanged voice/music gains, one hit and a shared ceiling.
export async function prepareSoundtrack(assets,duration,voiceOffset,soundEvents,signal){
 const args=['-v','error','-y','-i',path.join(assets,'narration.wav'),'-i',path.join(assets,'background-music.wav')];
 const filters=[`[0:a]adelay=${Math.round(voiceOffset*1000)}:all=1[v]`];
 let inputs='[v][1:a]',count=2;
 for(const [i,s] of soundEvents.entries()){
  args.push('-i',path.join(assets,s.file));
  filters.push(`[${i+2}:a]atrim=duration=${s.duration},volume=${s.gain},adelay=${Math.round(s.start*1000)}:all=1[hit${i}]`);
  inputs+=`[hit${i}]`;count++;
 }
 filters.push(`${inputs}amix=inputs=${count}:normalize=0,alimiter=limit=0.794328:level=false:latency=true,apad,atrim=duration=${duration}[mix]`);
 args.push('-filter_complex',filters.join(';'),'-map','[mix]','-ar','48000','-c:a','pcm_s16le',path.join(assets,'soundtrack.wav'));
 await run('ffmpeg',args,{signal,timeout:300000});
}
