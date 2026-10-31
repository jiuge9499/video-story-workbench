import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {freshProject,scene,speechKey,renderKey} from './model.mjs';

export const ROOT=fs.realpathSync(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
export const WORKSPACE=path.dirname(ROOT);
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
  for(const j of db.jobs)if(['running','queued','cancelling'].includes(j.state)){j.state='interrupted';j.message='工作台曾退出，任务已中断；已有产物保留，请核对后继续。';j.finished=new Date().toISOString();if(j.subscriptionUsage?.status==='recording'){j.subscriptionUsage.status='interrupted';j.subscriptionUsage.windows=[];}}
  for(const p of db.projects){
    p.opening??={enabled:true,title:''};
    p.transition??={type:'auto',duration:.4};
    p.sfx??={enabled:true,volume:.12};
  }
  const save=()=>atomic(dbfile,db);
  if(!db.projects.length&&!process.env.STORY_NO_SEED){
    const p=freshProject('刷题很多，为什么还是不会？');p.id='study-sample';p.transition={type:'cut',duration:0.4};
    const lines=['明明刷了很多题，为什么一换题型，还是不知道从哪下手？','先别急着做下一套。回头看看，这一道题，你究竟卡在哪一步。','是概念没弄清，还是推导没跟上？把原因写下来，再自己讲一遍。','下一次练习，就从这个卡点开始。'];
    const prompts=['同一位黑发高中生穿蓝色校服，坐在教室书桌前，一手扶额一手握笔，面对练习册困惑，窗边午后暖光，中景。','同一位学生低头看书页，米色衬衫老师在桌旁俯身指向书页，双方视线朝向笔记本，教室暖光，双人中景。','同一位学生穿蓝色校服在家整理错题，低头写笔记，左侧暖色台灯，右侧窗外蓝色黄昏，中景。','同一位学生双手和书页的斜俯视特写，右手握笔，左手压纸，蓝色校服衣袖，蓝色笔袋，木桌与暖光，无可读文字。'];
    const dir=path.join(MEDIA,p.id,'seed');fs.mkdirSync(dir,{recursive:true});
    p.scenes=lines.map((text,i)=>{const s=scene(text);s.prompt=prompts[i];s.motion=i%2?'pull':'push';const src=path.join(WORKSPACE,'output/study-sample/assets',`scene-${i+1}.png`);if(fs.existsSync(src)){s.image=`${p.id}/seed/scene-${i+1}.png`;fs.copyFileSync(src,mediaFile(s.image));s.versions=[{file:s.image,created:p.created,label:'已确认样片'}];}return s;});
    p.script=lines.join('\n\n');
    const src=path.join(WORKSPACE,'output/study-sample');
    for(const [from,to] of [['刷题卡点-1.2倍配音.mp4','sample.mp4'],['assets/narration.wav','narration.wav'],['字幕-1.2倍.srt','subtitles.srt']])if(fs.existsSync(path.join(src,from)))fs.copyFileSync(path.join(src,from),path.join(dir,to));
    if(fs.existsSync(path.join(dir,'sample.mp4'))){
      p.speech={key:speechKey(p),audio:`${p.id}/seed/narration.wav`,duration:17.405333,scenes:[0,4.291667,9.343333,14.5725].map((start,i)=>({id:p.scenes[i].id,start,end:[4.291667,9.343333,14.5725,17.405333][i]})),captions:[]};
      p.renders=[{id:'seed',key:renderKey(p),revision:1,video:`${p.id}/seed/sample.mp4`,srt:`${p.id}/seed/subtitles.srt`,duration:18,created:p.created,voice:p.voice,speed:p.speed}];
      // Do not reuse manually timed sample audio as a generated timing manifest.
      p.speech.key='seed-manual-timing';
    }
    db.projects.push(p);
  }
  save();return {db,save};
}
