import {execFile} from 'node:child_process';

// One service owns the store. These pools coordinate all projects in that service.
export class ResourcePool {
  constructor(limits={text:2,image:2,speech:1,render:1}) {
    this.limits=limits;this.used={};this.queues={};this.blockHeavy=false;
  }
  acquire(key,signal,onWait=()=>{}) {
    signal?.throwIfAborted();
    if(!this.limits[key])throw Error('未知制作资源');
    return new Promise((resolve,reject)=>{
      const queue=this.queues[key]??=[];
      const entry={signal,resolve,reject,abort:()=>{
        const i=queue.indexOf(entry);if(i>=0)queue.splice(i,1);
        reject(Error('任务已取消'));this.flush(key);
      }};
      signal?.addEventListener('abort',entry.abort,{once:true});queue.push(entry);
      if(queue.length>1||(this.used[key]||0)>=this.limits[key]||(this.blockHeavy&&key==='render'))onWait();
      this.flush(key);
    });
  }
  flush(key) {
    const queue=this.queues[key]||[];
    while(queue.length&&(this.used[key]||0)<this.limits[key]&&!(this.blockHeavy&&key==='render')){
      const entry=queue.shift();entry.signal?.removeEventListener('abort',entry.abort);
      if(entry.signal?.aborted){entry.reject(Error('任务已取消'));continue;}
      this.used[key]=(this.used[key]||0)+1;let released=false;
      entry.resolve(()=>{if(released)return;released=true;this.used[key]--;this.flush(key);});
    }
  }
  setPressure(critical){this.blockHeavy=critical;for(const key of Object.keys(this.queues))this.flush(key);}
  async run(key,signal,fn,onWait){const release=await this.acquire(key,signal,onWait);try{signal?.throwIfAborted();return await fn();}finally{release();}}
}

export function createScheduler({jobs,execute,limit=1,canStart=()=>true,onError=console.error}){
  const active=new Set();let closing=false;
  function drain(){
    if(closing||!canStart())return;
    while(active.size<limit){
      const job=jobs.find(j=>j.state==='queued'&&!active.has(j.id)&&!jobs.some(other=>other.projectId===j.projectId&&active.has(other.id)));
      if(!job)return;
      active.add(job.id);
      Promise.resolve().then(()=>execute(job)).catch(onError).finally(()=>{active.delete(job.id);setImmediate(drain);});
    }
  }
  return {drain,close:()=>{closing=true;},active};
}

// macOS reports 1=normal, 2=warning, 4=critical. Swap size alone is not current pressure.
export function watchMemory(onChange){
  let stopped=false;
  const sample=()=>{
    if(process.platform!=='darwin')return;
    execFile('/usr/sbin/sysctl',['-n','kern.memorystatus_vm_pressure_level'],{timeout:2000},(error,stdout)=>{
      if(!stopped&&!error)onChange(Number(stdout.trim())>=4);
    });
  };
  sample();const timer=setInterval(sample,5000);timer.unref();
  return ()=>{stopped=true;clearInterval(timer);};
}
