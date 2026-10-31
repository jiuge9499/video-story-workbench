import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const ROOT=fs.realpathSync(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
export const DATA=process.env.STORY_DATA_DIR||path.join(ROOT,'data');
export const MEDIA=path.join(DATA,'media');
export const atomic=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2));fs.renameSync(file+'.tmp',file);};
export const mediaFile=rel=>{
  if(typeof rel!=='string'||!rel||rel.includes('\0'))throw Error('素材路径无效');
  const file=path.resolve(MEDIA,rel);
  if(!file.startsWith(path.resolve(MEDIA)+path.sep))throw Error('素材路径无效');
  // Reject symlink traversal as well as ../ paths.
  let ancestor=file;while(!fs.existsSync(ancestor))ancestor=path.dirname(ancestor);
  if(!fs.realpathSync(ancestor).startsWith(fs.realpathSync(MEDIA)+path.sep)&&fs.realpathSync(ancestor)!==fs.realpathSync(MEDIA))throw Error('素材路径无效');
  return file;
};
export function loadStore(){
  fs.mkdirSync(MEDIA,{recursive:true});
  const dbfile=path.join(DATA,'state.json');
  const db=fs.existsSync(dbfile)?JSON.parse(fs.readFileSync(dbfile,'utf8')):{projects:[],jobs:[],capabilities:{text:null,image:null}};
  db.capabilities||={text:null,image:null};
  for(const j of db.jobs){
    if(j.subscriptionUsage?.status==='recording'){j.subscriptionUsage.status='interrupted';j.subscriptionUsage.windows=[];}
    if(j.state==='cancelling'){j.state='cancelled';j.message='已取消';j.finished=new Date().toISOString();}
    else if(['running','queued'].includes(j.state)&&j.kind==='workflow'){
      j.state='queued';j.message='已恢复排队，将复用已有素材继续制作';delete j.finished;j.resumed=(j.resumed||0)+1;
    }else if(['running','queued'].includes(j.state)){j.state='interrupted';j.message='步骤已中断；已有素材保留，可重试';j.finished=new Date().toISOString();}
  }
  for(const p of db.projects){
    p.opening??={enabled:true,title:''};
    p.transition??={type:'auto',duration:.4};
    p.sfx??={enabled:true,volume:.12};
  }
  const save=()=>atomic(dbfile,db);
  save();return {db,save};
}
