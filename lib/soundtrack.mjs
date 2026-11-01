import fs from 'node:fs';
import path from 'node:path';
import {run,probe} from './process.mjs';

export async function prepareSoundtrack(assets,duration,voiceOffset,soundEvents,signal){
 if(!Number.isFinite(duration)||duration<=0)throw Error('混音时长无效');
 const samples=Math.ceil(duration*48000),output=path.join(assets,'soundtrack.wav');
 const expectedBytes=samples*4;
 const args=['-v','error','-y','-i',path.join(assets,'narration.wav'),'-i',path.join(assets,'background-music.wav')];
 const filters=[`[0:a]adelay=${Math.round(voiceOffset*1000)}:all=1[v]`];
 let inputs='[v][1:a]',count=2;
 for(const [i,s] of soundEvents.entries()){
  args.push('-i',path.join(assets,s.file));
  filters.push(`[${i+2}:a]atrim=duration=${s.duration},volume=${s.gain},adelay=${Math.round(s.start*1000)}:all=1[hit${i}]`);
  inputs+=`[hit${i}]`;count++;
 }
 // Bound padding by sample count, rebuild timestamps, and cap the muxed output too.
 filters.push(`${inputs}amix=inputs=${count}:normalize=0,aresample=48000,alimiter=limit=0.794328:level=false:latency=true,apad=whole_len=${samples},atrim=end_sample=${samples},asetpts=N/SR/TB[mix]`);
 args.push('-filter_complex',filters.join(';'),'-map','[mix]','-t',String(duration),'-ar','48000','-ac','2','-c:a','pcm_s16le','-fs',String(expectedBytes+8192),output);
 try{
  await run('ffmpeg',args,{signal,timeout:300000});
  const info=await probe(output,signal),actualDuration=Number(info.format.duration);
  if(!Number.isFinite(actualDuration)||Math.abs(actualDuration-duration)>.03||fs.statSync(output).size>expectedBytes+32768)throw Error('混音文件时长或大小异常');
 }catch(e){fs.rmSync(output,{force:true});throw e;}
}
