export function taskDuration(job,now=Date.now()){
 const start=Date.parse(job.started);
 if(!Number.isFinite(start)||job.state==='interrupted')return null;
 const end=['running','cancelling'].includes(job.state)?now:Date.parse(job.finished);
 return Number.isFinite(end)&&end>=start?end-start:null;
}
export function formatDuration(ms){
 if(ms===null)return '用时未知';
 const seconds=Math.floor(ms/1000),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;
 return hours?`${hours} 小时 ${minutes} 分 ${rest} 秒`:minutes?`${minutes} 分 ${rest} 秒`:`${rest} 秒`;
}
export function totalDuration(records,now=Date.now()){
 return records.reduce((total,job)=>total+(taskDuration(job,now)??0),0);
}
