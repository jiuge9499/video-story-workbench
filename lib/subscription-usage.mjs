import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {CODEX} from './process.mjs';

// Query the official local CLI protocol. No model turn, credential reads or tokens are involved.
export function readSubscription({command=CODEX,timeout=12000}={}){
  return new Promise(resolve=>{
    let child,buffer='',settled=false;
    const finish=value=>{if(settled)return;settled=true;clearTimeout(timer);child?.kill('SIGTERM');const kill=setTimeout(()=>child?.kill('SIGKILL'),1000);kill.unref();resolve(value);};
    const fail=()=>finish({capturedAt:new Date().toISOString(),ok:false,error:'订阅额度读取失败或超时；制作仍可继续'});
    const timer=setTimeout(fail,timeout);
    try{child=spawn(command,['app-server'],{stdio:['pipe','pipe','ignore']});}catch{fail();return;}
    const send=message=>child.stdin.write(JSON.stringify(message)+'\n');
    child.on('error',fail);child.on('exit',()=>{if(!settled)fail();});child.stdin.on('error',fail);
    child.stdout.on('data',chunk=>{
      buffer+=chunk.toString();if(buffer.length>1024*1024){fail();return;}
      let end;while((end=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let message;
        try{message=JSON.parse(line);}catch{continue;}
        if(message.id===1){
          if(message.error){fail();return;}
          send({method:'initialized',params:{}});send({id:2,method:'account/rateLimits/read',params:{}});
        }
        if(message.id===2){
          if(message.error||!message.result){fail();return;}
          finish(normalizeSubscription(message.result));return;
        }
      }
    });
    send({id:1,method:'initialize',params:{clientInfo:{name:'video_story_workbench',version:'1.0.0'}}});
  });
}

export function normalizeSubscription(result,now=new Date().toISOString()){
  // A missing multi-bucket view can fall back to the legacy bucket; never count both.
  const buckets=result.rateLimitsByLimitId??(result.rateLimits?{[result.rateLimits.limitId||'codex']:result.rateLimits}:{});
  const windows=[];
  for(const [bucketId,bucket] of Object.entries(buckets)){
    for(const slot of ['primary','secondary']){
      const w=bucket?.[slot];
      if(!w||typeof w.usedPercent!=='number'||!Number.isFinite(w.usedPercent)||w.usedPercent<0||w.usedPercent>100||!Number.isFinite(w.windowDurationMins)||w.windowDurationMins<=0||!Number.isFinite(w.resetsAt))continue;
      windows.push({key:`${bucketId}:${slot}`,bucketId,bucketName:bucket.limitName||bucketId,slot,usedPercent:w.usedPercent,windowDurationMins:w.windowDurationMins,resetsAt:w.resetsAt,planType:bucket.planType??null});
    }
  }
  return {capturedAt:now,ok:windows.length>0,accountKey:result.accountId?createHash('sha256').update(result.accountId).digest('hex'):null,windows,...(!windows.length?{error:'账户未返回可统计的订阅额度'}:{})};
}

export function compareSubscription(before,after,overlapJobIds=[]){
  if(!before?.ok||!after?.ok)return {status:'unavailable',windows:[],overlapJobIds};
  if(!before.accountKey||!after.accountKey||before.accountKey!==after.accountKey)return {status:'account_changed',windows:[],overlapJobIds};
  const windows=before.windows.map(start=>{
    const end=after.windows.find(w=>w.key===start.key);
    let reason=null;
    if(!end)reason='额度窗口缺失';
    else if(start.planType!==end.planType||start.windowDurationMins!==end.windowDurationMins)reason='套餐或窗口发生变化';
    // Server estimates can drift a few seconds. Crossing the original reset is never comparable.
    else if(Math.abs(start.resetsAt-end.resetsAt)>60||Date.parse(after.capturedAt)>=start.resetsAt*1000)reason='制作期间额度已重置';
    else if(end.usedPercent<start.usedPercent)reason='额度回落或发生重置';
    return {...start,beforeUsedPercent:start.usedPercent,afterUsedPercent:end?.usedPercent??null,deltaPoints:reason?null:Math.round((end.usedPercent-start.usedPercent)*10000)/10000,reason};
  });
  for(const end of after.windows)if(!before.windows.some(w=>w.key===end.key))windows.push({...end,beforeUsedPercent:null,afterUsedPercent:end.usedPercent,deltaPoints:null,reason:'开始时未返回此额度窗口'});
  return {status:overlapJobIds.length?'overlap':windows.some(w=>w.reason)?'partial':'observed',windows,overlapJobIds};
}

export function createUsageTracker({read=readSubscription,save=()=>{}}={}){
  const active=new Map();
  const snapshot=async()=>{try{return await read();}catch{return {ok:false,capturedAt:new Date().toISOString(),error:'订阅额度读取失败；制作仍可继续'};}};
  return {
    async begin(job){
      job.subscriptionUsage={version:1,status:'recording',overlapJobIds:[...active.keys()]};
      for(const other of active.values())other.subscriptionUsage.overlapJobIds.push(job.id);
      active.set(job.id,job);save();
      job.subscriptionUsage.before=await snapshot();save();
    },
    async end(job){
      const record=job.subscriptionUsage;
      record.after=await snapshot();Object.assign(record,compareSubscription(record.before,record.after,record.overlapJobIds));
      active.delete(job.id);save();
    },
  };
}

// Sum only non-overlapping, comparable tasks, keeping accounts, plans and windows separate.
export function summarizeSubscription(records){
  const groups=new Map();let included=0,excluded=0;
  for(const record of records){
    if(record.status!=='observed'){excluded++;continue;}
    included++;
    for(const w of record.windows||[]){
      if(w.deltaPoints===null||!Number.isFinite(w.deltaPoints))continue;
      const key=JSON.stringify([record.before.accountKey,w.bucketId,w.slot,w.windowDurationMins,w.planType]);
      const total=groups.get(key)||{bucketName:w.bucketName,windowDurationMins:w.windowDurationMins,planType:w.planType,deltaPoints:0,tasks:0};
      total.deltaPoints=Math.round((total.deltaPoints+w.deltaPoints)*10000)/10000;total.tasks++;groups.set(key,total);
    }
  }
  return {included,excluded,windows:[...groups.values()]};
}
