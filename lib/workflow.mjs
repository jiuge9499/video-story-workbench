// Scheduling helpers are independent of the media providers so recovery can be tested offline.
import {IMAGE_CONCURRENCY} from './concurrency.mjs';

export function failureKind(e){
 const t=String(e.details||e.message||e);
 if(/usage limit|quota exceeded|quota exhausted|insufficient.quota|\b429\b|rate.limit|额度不足/i.test(t))return 'quota';
 if(/expired|invalid_grant|not logged|unauthorized|\b401\b|登录.*失效/i.test(t))return 'auth';
 if(e.timedOut||/connection failed|error sending request|timed out|ENOTFOUND|network|NoAudioReceived|Cannot connect|ECONN|workspace routing discovery/i.test(t))return 'network';
 return 'local';
}
export function sleep(ms,signal){
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);reject(Error('任务已取消'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
  signal?.addEventListener('abort',abort,{once:true});
 });
}
export async function retry(fn,{signal,onRetry=()=>{},wait=sleep,delays=[5000,15000]}={}){
 for(let attempt=0;;attempt++){
  signal?.throwIfAborted();
  try{return await fn(attempt);}catch(e){
   if(signal?.aborted||failureKind(e)!=='network'||attempt>=delays.length)throw e;
   onRetry(attempt+1,delays[attempt]);await wait(delays[attempt],signal);
  }
 }
}
export async function settleBranches(fns){
 const results=await Promise.allSettled(fns.map(fn=>Promise.resolve().then(fn)));
 // Do not release the project slot while a sibling is still writing assets.
 const errors=results.filter(r=>r.status==='rejected').map(r=>r.reason);
 if(errors.length)throw errors.find(e=>failureKind(e)!=='local')||errors[0];
}
export async function imageQueue(items,{reference,generate,signal,onChange=()=>{},wait=sleep,concurrency=IMAGE_CONCURRENCY}){
 if(!Number.isInteger(concurrency)||concurrency<1)throw Error('图片并发数必须为正整数');
 const failures=new Map();let active=0,completed=0,stop;
 const report=extra=>onChange({active,completed,failed:failures.size,limit:concurrency,...extra});
 const attempt=async(item,final=false)=>{
  signal?.throwIfAborted();active++;report();
  try{
   const fn=()=>generate(item,reference);
   if(final)await retry(fn,{signal,wait,onRetry:n=>report({retry:n})});else await fn();
   failures.delete(item);completed++;
  }catch(e){failures.set(item,e);if(['quota','auth'].includes(failureKind(e)))stop=e;}
  finally{active--;report();}
 };
 let rest=[...items];
 if(!reference&&rest.length){
  // Freeze one successfully persisted reference before starting parallel workers.
  const first=rest.shift();await attempt(first,true);
  if(failures.size)throw failures.get(first);
  reference=first.image;
 }
 let cursor=0;
 const worker=async()=>{while(cursor<rest.length&&!stop&&!signal?.aborted)await attempt(rest[cursor++]);};
 await Promise.allSettled(Array.from({length:Math.min(concurrency,rest.length)},worker));signal?.throwIfAborted();if(stop)throw stop;
 // Failed scenes get another bounded chance after all other scenes have advanced.
 for(const item of [...failures.keys()]){await attempt(item,true);if(stop)throw stop;}
 signal?.throwIfAborted();
 if(failures.size)throw [...failures.values()].find(e=>failureKind(e)!=='local')||failures.values().next().value;
}
