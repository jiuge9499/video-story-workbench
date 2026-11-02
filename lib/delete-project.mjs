import {UNIFORM_REFERENCE} from './costume.mjs';
import fs from 'node:fs';
import path from 'node:path';

export function deleteProject(db,projectId,media,save){
 const index=db.projects.findIndex(p=>p.id===projectId);
 if(index<0)throw Object.assign(Error('作品不存在'),{status:404});
 if(db.jobs.some(j=>j.projectId===projectId&&['queued','running','waiting','cancelling'].includes(j.state)))throw Object.assign(Error('请先停止此作品的制作任务，再删除'),{status:409});
 db.projects.splice(index,1);
 // Keep scheduler references to both arrays valid.
 for(let i=db.jobs.length-1;i>=0;i--)if(db.jobs[i].projectId===projectId)db.jobs.splice(i,1);
 save();
 // Shared character references belong to the application, not an individual work.
 const keep=new Set(['shared',UNIFORM_REFERENCE.split('/')[0],...db.projects.map(p=>p.id)]);
 const visit=value=>{
  if(Array.isArray(value))value.forEach(visit);
  else if(value&&typeof value==='object')Object.values(value).forEach(visit);
  else if(typeof value==='string'&&value.length<1024){const match=/^([\w-]+)\/.+/.exec(value);if(match)keep.add(match[1]);}
 };
 // Copies can refer to images/audio originally generated for a different project.
 db.projects.forEach(visit);
 let cleanupWarning=false;
 for(const entry of fs.readdirSync(media,{withFileTypes:true})){
  if(keep.has(entry.name))continue;
  try{fs.rmSync(path.join(media,entry.name),{recursive:true,force:true});}catch{cleanupWarning=true;}
 }
 return {ok:true,cleanupWarning};
}
