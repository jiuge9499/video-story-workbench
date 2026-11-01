const live = new Set(['running','cancelling','queued','waiting']);
const priority = j => ['running','cancelling'].includes(j.state)?0:live.has(j.state)?1:2;

// One project card; task attempts remain available as history.
export function groupJobs(jobs){
 const groups=new Map();
 for(const job of jobs){
  if(!groups.has(job.projectId))groups.set(job.projectId,[]);
  groups.get(job.projectId).push(job);
 }
 return [...groups].map(([projectId,records])=>{
  records=records.slice().sort((a,b)=>(b.created||'').localeCompare(a.created||''));
  const current=records.filter(j=>live.has(j.state)).sort((a,b)=>priority(a)-priority(b))[0]||records[0];
  return {projectId,current,history:records.filter(j=>j.id!==current.id)};
 }).sort((a,b)=>priority(a.current)-priority(b.current)||(b.current.created||'').localeCompare(a.current.created||''));
}
