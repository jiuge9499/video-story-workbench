import {VOICE_CLIENT,assertSpeechApproved,speechBlocked} from './lib/shared-voice.mjs';
import {syncSharedVoices} from './lib/voices.mjs';
import {STYLE_PRESETS} from './lib/video-styles.mjs';
import {UNIFORM_VERSION} from './lib/costume.mjs';
import {deleteProject} from './lib/delete-project.mjs';
import {retry,settleBranches,failureKind} from './lib/workflow.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {ROOT,MEDIA,DATA,mediaFile,loadStore} from './lib/store.mjs';
import {MAX_SCENES,voices,freshProject,scene,splitScenes,validateProject,speechKey,renderKey,narrationMatches,id} from './lib/model.mjs';
import {CODEX,PYTHON,run,probe,hyperframes,explainError} from './lib/process.mjs';
import * as pipeline from './lib/pipeline.mjs';
import {ResourcePool,createScheduler,watchMemory,IMAGE_CONCURRENCY,VIDEO_CONCURRENCY,TOTAL_IMAGE_CONCURRENCY} from './lib/concurrency.mjs';
import {createUsageTracker,readSubscription,summarizeSubscription} from './lib/subscription-usage.mjs';

const PORT=Number(process.env.PORT||8776),TOKEN=crypto.randomBytes(24).toString('hex');
const {db,save}=loadStore();const controllers=new Map();const resources=new ResourcePool();let memoryCritical=false,maintenance=false;
const usageTracker=createUsageTracker({save});
const stamp=()=>new Date().toISOString();
const live=j=>['queued','running','cancelling','waiting'].includes(j.state);
const project=id=>{const p=db.projects.find(x=>x.id===id);if(!p)throw Object.assign(Error('作品不存在'),{status:404});return p;};
const assertEditable=p=>{if(db.jobs.some(j=>j.projectId===p.id&&live(j)))throw Object.assign(Error('此作品正在制作，停止或等待任务完成后再修改'),{status:409});};
const touch=p=>{p.revision++;p.updated=stamp();save();};
const serialize=p=>({...p,taskRecords:db.jobs.filter(j=>j.projectId===p.id).map(j=>({jobId:j.id,kind:j.kind,state:j.state,created:j.created,started:j.started,finished:j.finished})),subscriptionSummary:summarizeSubscription(db.jobs.filter(j=>j.projectId===p.id&&j.subscriptionUsage).map(j=>j.subscriptionUsage)),subscriptionRecords:db.jobs.filter(j=>j.projectId===p.id&&j.subscriptionUsage).map(j=>({jobId:j.id,kind:j.kind,state:j.state,started:j.started,finished:j.finished,...j.subscriptionUsage})),speechCurrent:!speechBlocked(p)&&narrationMatches(p)&&p.speech?.key===speechKey(p),renderCurrent:!speechBlocked(p)&&narrationMatches(p)&&!!p.renders.length&&p.renders.at(-1).key===renderKey(p)});
const send=(res,code,body)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
async function body(req){let bytes=0;const chunks=[];for await(const c of req){bytes+=c.length;if(bytes>28*1024*1024)throw Error('上传文件过大，图片上限 20 MB');chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw Error('请求内容无效');}}
function dispatch(p,kind,sceneId){
  if(maintenance)throw Object.assign(Error('工作台正在安全更新，请稍后刷新'),{status:503});
  assertEditable(p);
  if(!['draft','storyboard','images','speech','render','workflow','delivery'].includes(kind))throw Error('任务类型无效');
  if(sceneId&&!p.scenes.some(s=>s.id===sceneId))throw Error('镜头不存在');
  if(['speech','render','images'].includes(kind)&&p.scenes.length&&p.scenes.map(s=>s.text).join('').replace(/\s/g,'')!==p.script.replace(/\s/g,''))throw Error('文案已修改，请先重新拆分分镜，再开始制作');
  const j={id:id(),projectId:p.id,kind,sceneId,state:'queued',progress:0,message:'等待制作',created:stamp(),inputRevision:p.revision};db.jobs.push(j);save();setImmediate(drain);return j;
}
function drain(){scheduler.drain();}
const scheduler=createScheduler({jobs:db.jobs,execute:executeJob,limit:VIDEO_CONCURRENCY,canStart:()=>!memoryCritical&&!maintenance&&!db.queuePause});
const stopMemoryWatch=watchMemory(critical=>{memoryCritical=critical;resources.setPressure(critical);if(!critical)drain();});
async function executeJob(job){
  const p=project(job.projectId),controller=new AbortController();controllers.set(job.id,controller);
  job.state='running';job.started??=stamp();delete job.finished;job.branches={};save();
  const dir=path.join(MEDIA,p.id,'jobs',job.id);
  const ctx={dir,signal:controller.signal,save:()=>{p.updated=stamp();save();},progress:(message,progress)=>{job.message=message;job.progress=Math.round(progress);save();},capability:(key,ok)=>{db.capabilities[key]={ok,checked:stamp()};save();}};
  ctx.withResource=async(key,fn)=>{
    const message=job.message;
    try{return await resources.run(key,controller.signal,async()=>{delete job.waitingFor;job.message=message;save();return fn();},()=>{
      job.waitingFor=key;job.message=`等待${{text:'文字处理',image:'出图',speech:'配音',render:'渲染'}[key]}名额${memoryCritical&&key==='render'?'（内存压力较高）':''}`;save();
    });}finally{delete job.waitingFor;}
  };
  let outcome='done';
  try{
    job.message='正在记录制作前订阅额度';
    await usageTracker.begin(job);controller.signal.throwIfAborted();
    fs.mkdirSync(dir,{recursive:true});
    const stage=async(name,lo,hi,fn)=>{
      const child={...ctx,progress:(message,value)=>{job.stage=name;ctx.progress(message,lo+(hi-lo)*Math.max(0,Math.min(100,value))/100);}};
      return retry(()=>fn(child),{signal:controller.signal,onRetry:(n,ms)=>{
        job.stage=name;ctx.progress(`${name}等待重试 ${n}/2（${ms/1000} 秒后）`,job.progress);
      }});
    };
    if(job.kind==='workflow'){
      if(!p.script.trim())throw Error('请先输入完整文案');
      if(p.title==='未命名作品'){p.title=p.script.trim().slice(0,18);p.revision++;ctx.save();}
      if(!p.scenes.length||!narrationMatches(p)){
        job.stage='分镜';ctx.progress('正在按文案规划分镜',2);
        if(p.scenes.length)fs.writeFileSync(path.join(dir,'previous-scenes.json'),JSON.stringify(p.scenes,null,2));
        await stage('分镜',0,10,c=>pipeline.storyboard(p,job,c));
      }
      if(p.scenes.some(s=>!s.image&&s.locked))throw Error('存在锁定但缺少图片的镜头，请在高级编辑中解锁');
      const branch=(key,name,fn)=>async()=>{
        const b=job.branches[key]={state:'running',progress:0,message:'准备中'};
        const progress=(message,value)=>{
          Object.assign(b,{message,progress:Math.max(b.progress,Math.min(100,value))});
          job.stage='图片与配音';job.progress=Math.floor(10+(job.branches.images?.progress||0)*.50+(job.branches.speech?.progress||0)*.15);
          job.message=Object.values(job.branches).map(x=>x.message).join('；');save();
        };
        try{
          await fn({...ctx,progress,imageStatus:info=>{Object.assign(b,info);save();}});
          b.state='done';progress(`${name}已完成`,100);
        }catch(e){b.state='failed';progress(`${name}待恢复：${explainError(e)}`,b.progress);throw e;}
      };
      await settleBranches([
        branch('images','画面',async c=>{if(p.scenes.some(s=>!s.image))await pipeline.generateImages(p,job,c);}),
        branch('speech','配音字幕',c=>retry(()=>pipeline.speech(p,job,c),{signal:controller.signal,onRetry:(n,ms)=>c.progress(`配音等待重试 ${n}/2（${ms/1000} 秒后）`,job.branches.speech.progress)}))
      ]);
      if(p.renders.at(-1)?.key!==renderKey(p))await stage('视频合成',75,93,c=>pipeline.render(p,job,c));
      await stage('首图与发布内容',93,100,c=>pipeline.delivery(p,job,c));
    }else if(job.kind==='delivery')await stage('首图与发布内容',0,100,c=>pipeline.delivery(p,job,c));
    else await pipeline[job.kind==='images'?'generateImages':job.kind](p,job,ctx);
    if(controller.signal.aborted)throw Error('任务已取消');
    job.progress=100;job.message='已完成';
  }catch(e){
    const kind=failureKind(e);outcome=controller.signal.aborted?'cancelled':'failed';job.message=explainError(e);
    if(outcome==='failed'&&kind!=='local'){
      outcome='waiting';db.queuePause={reason:kind,message:job.message,nextCheckAt:Date.now()+300000,jobId:job.id};
      job.message=`等待恢复：${job.message}；5 分钟后自动重试`;job.nextRetryAt=db.queuePause.nextCheckAt;
    }
    if(e.details){try{fs.writeFileSync(path.join(dir,'error.log'),e.details);}catch{}}}
  finally{const message=job.message;job.message='正在记录制作后订阅额度';save();await usageTracker.end(job);job.state=outcome;job.message=message;job.finished=stamp();p.updated=stamp();controllers.delete(job.id);save();}
}
let voiceRefreshAt=0,voiceRefreshPromise=null;
async function refreshVoices(force=false){
  if(!force&&Date.now()-voiceRefreshAt<30000)return;
  if(voiceRefreshPromise)return voiceRefreshPromise;
  voiceRefreshPromise=run(PYTHON,[VOICE_CLIENT,'voices'],{timeout:30000}).then(output=>syncSharedVoices(JSON.parse(output))).finally(()=>{voiceRefreshAt=Date.now();voiceRefreshPromise=null;});
  return voiceRefreshPromise;
}
let healthCache=null,healthPromise=null;
async function health(force=false){
  if(!force&&healthCache&&Date.now()-healthCache.time<60000)return healthCache.value;
  if(healthPromise)return healthPromise;
  healthPromise=(async()=>{
    const results=await Promise.allSettled([run(CODEX,['login','status'],{timeout:15000}),refreshVoices(true),run('ffmpeg',['-version'],{timeout:10000})]);
    const auth=results[0];let renderer=false;try{renderer=fs.existsSync(hyperframes());}catch{}
    const subscription=await readSubscription();
    const value={subscription,login:auth.status==='fulfilled'&&/Logged in using ChatGPT/i.test(auth.value),tts:results[1].status==='fulfilled',render:results[2].status==='fulfilled'&&renderer,text:db.capabilities.text,image:db.capabilities.image,checked:stamp(),usage:subscription.ok?'已接入订阅额度记录':'订阅额度暂不可用'};
    healthCache={time:Date.now(),value};return value;
  })().finally(()=>{healthPromise=null;});return healthPromise;
}
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.mp3':'audio/mpeg','.wav':'audio/wav','.mp4':'video/mp4','.ttc':'font/collection','.srt':'application/x-subrip','.txt':'text/plain; charset=utf-8'};
function serve(req,res,file,download=false){
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end('文件不存在');}
  const ext=path.extname(file);if(!types[ext]){res.writeHead(403);return res.end();}
  const size=fs.statSync(file).size;const headers={'Content-Type':types[ext],'Accept-Ranges':'bytes','X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'};
  if(download)headers['Content-Disposition']=`attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file))}`;
  if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!match){res.writeHead(416);return res.end();}let start=match[1]?Number(match[1]):Math.max(0,size-Number(match[2]));let end=match[1]&&match[2]?Number(match[2]):size-1;end=Math.min(end,size-1);if(start>end||start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});return res.end();}res.writeHead(206,{...headers,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${size}`});if(req.method==='HEAD')return res.end();fs.createReadStream(file,{start,end}).pipe(res);
  }else{res.writeHead(200,{...headers,'Content-Length':size});if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);}
}
const server=http.createServer(async(req,res)=>{
  try{
    const allowedHosts=[`127.0.0.1:${PORT}`,`localhost:${PORT}`];
    if(!allowedHosts.includes(req.headers.host))return send(res,403,{error:'仅允许本机访问'});
    if(req.headers.origin&&!allowedHosts.some(h=>req.headers.origin===`http://${h}`))return send(res,403,{error:'请求来源无效'});
    const url=new URL(req.url,`http://127.0.0.1:${PORT}`);const route=decodeURIComponent(url.pathname);
    if(!['GET','HEAD'].includes(req.method)&&req.headers['x-workbench-token']!==TOKEN)return send(res,403,{error:'页面已过期，请刷新后重试'});
    if(req.method==='GET'&&route==='/api/state'){await refreshVoices().catch(()=>{});return send(res,200,{token:TOKEN,voices,stylePresets:STYLE_PRESETS,projects:db.projects.filter(p=>!p.archived).map(serialize),jobs:[...db.jobs.filter(j=>!live(j)).slice(-60),...db.jobs.filter(live)],capabilities:db.capabilities,concurrency:{version:2,subscriptionUsageVersion:1,taskTimingVersion:1,videos:VIDEO_CONCURRENCY,images:TOTAL_IMAGE_CONCURRENCY,imagesPerVideo:IMAGE_CONCURRENCY,renders:1,memoryCritical,maintenance,queuePause:db.queuePause||null}});}
    if(req.method==='GET'&&route==='/api/health')return send(res,200,await health(url.searchParams.has('refresh')));
    if(req.method==='POST'&&route==='/api/projects'){const b=await body(req);const p=freshProject(String(b.title||'未命名作品').slice(0,100));db.projects.push(p);save();return send(res,201,serialize(p));}
    if(req.method==='POST'&&route==='/api/tasks/batch'){
      const b=await body(req);
      if(!Array.isArray(b.projectIds)||!b.projectIds.length||b.projectIds.length>100||b.projectIds.some(x=>typeof x!=='string'))throw Error('请选择 1–100 个作品');
      const accepted=[],skipped=[];
      for(const projectId of new Set(b.projectIds)){
        try{const p=project(projectId);if(p.archived)throw Error('作品已归档');if(!p.script.trim())throw Error('请先填写文案');accepted.push(dispatch(p,'workflow'));}
        catch(e){skipped.push({projectId,error:e.message});}
      }
      return send(res,202,{accepted,skipped});
    }
    // Atomically stop accepting work only when every task has finished.
    if(req.method==='POST'&&route==='/api/maintenance'){
      if(db.jobs.some(live))return send(res,409,{error:'仍有制作任务，不能更新'});
      maintenance=true;return send(res,200,{ok:true});
    }
    if(req.method==='POST'&&route==='/api/queue/resume'){
      if(maintenance)return send(res,503,{error:'工作台正在安全更新'});
      resumeQueue();return send(res,200,{ok:true});
    }
    const match=/^\/api\/projects\/([\w-]+)(?:\/(.+))?$/.exec(route);
    if(match){
      const p=project(match[1]),action=match[2];
      if(req.method==='GET'&&!action)return send(res,200,serialize(p));
      if(req.method==='DELETE'&&!action)return send(res,200,deleteProject(db,p.id,MEDIA,save));
      if(['GET','HEAD'].includes(req.method)&&action==='export'){
        assertSpeechApproved(p);
        const r=p.renders.find(r=>r.id===url.searchParams.get('version'))||p.renders.at(-1);if(!r||r.key!==renderKey(p)||!narrationMatches(p))return send(res,409,{error:'成片已过期，请重新合成后导出'});
        const field=url.searchParams.get('file')||'video';if(field==='cover3x4'||field==='social'){if(r.delivery?.key!==renderKey(p))throw Error('发布素材尚未完成');return serve(req,res,mediaFile(field==='cover3x4'?r.delivery.cover:r.delivery.text),true);}
        if(!['video','srt','cover','publish'].includes(field)||!r[field])throw Error('此导出文件不存在');return serve(req,res,mediaFile(r[field]),true);
      }
      if(req.method==='POST'&&action==='tasks'){const b=await body(req);return send(res,202,dispatch(p,b.kind,b.sceneId));}
      if(req.method==='POST'&&action==='copy'){
        assertEditable(p);const copy=structuredClone(p);copy.id=id();copy.title+=' · 副本';copy.created=copy.updated=stamp();copy.revision=1;db.projects.push(copy);save();return send(res,201,serialize(copy));
      }
      assertEditable(p);const b=await body(req);
      if(req.method==='PUT'&&!action){if(b.revision!==p.revision)return send(res,409,{error:'此作品已更新，请刷新后再修改'});const next=validateProject(b,p);Object.assign(p,next);touch(p);return send(res,200,serialize(p));}
      if(req.method==='POST'&&action==='archive'){p.archived=true;touch(p);return send(res,200,{ok:true});}
      if(req.method==='POST'&&action==='split'){
        if(!p.script.trim())throw Error('请先输入文案');
        const chunks=splitScenes(p.script,p.speed);if(chunks.length>MAX_SCENES)throw Error(`分镜超过 ${MAX_SCENES} 个，请减少文案或合并极短段落`);
        p.scenes=chunks.map((t,i)=>p.scenes[i]?.text===t?p.scenes[i]:scene(t));touch(p);return send(res,200,serialize(p));
      }
      if(req.method==='POST'&&action==='add-scene'){if(p.scenes.length>=MAX_SCENES)throw Error(`最多支持 ${MAX_SCENES} 个镜头`);p.scenes.push(scene());touch(p);return send(res,200,serialize(p));}
      const sm=/^scenes\/([\w-]+)\/(image|version)$/.exec(action||'');
      if(req.method==='POST'&&sm){
        const s=p.scenes.find(s=>s.id===sm[1]);if(!s)throw Error('镜头不存在');if(s.locked)throw Error('请先解锁此镜头');
        if(sm[2]==='version'){if(!s.versions.some(v=>v.file===b.file))throw Error('图片版本不存在');s.image=b.file;s.uniformVersion=s.versions.find(v=>v.file===b.file)?.uniformVersion;touch(p);return send(res,200,serialize(p));}
        const image=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(b.image||'');if(!image)throw Error('请上传 PNG、JPG 或 WebP 图片');const bytes=Buffer.from(image[2],'base64');if(bytes.length>20*1024*1024)throw Error('图片不能超过 20 MB');
        const rel=`${p.id}/uploads/${id()}.${image[1]==='jpeg'?'jpg':image[1]}`;const file=mediaFile(rel);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);
        try{const info=await probe(file);const stream=info.streams.find(s=>s.width);if(!stream||stream.width<320||stream.height<180)throw Error('图片尺寸至少为 320×180');}catch(e){fs.unlinkSync(file);throw e;}
        // Recheck after asynchronous decoding; a render may have started meanwhile.
        assertEditable(p);s.image=rel;s.uniformVersion=UNIFORM_VERSION;s.versions.push({file:rel,uniformVersion:UNIFORM_VERSION,created:stamp(),label:'导入图片'});touch(p);return send(res,200,serialize(p));
      }
      return send(res,404,{error:'操作不存在'});
    }
    const jm=/^\/api\/jobs\/([\w-]+)\/cancel$/.exec(route);
    if(req.method==='POST'&&jm){const j=db.jobs.find(j=>j.id===jm[1]);if(!j)throw Error('任务不存在');if(['queued','waiting'].includes(j.state)){if(db.queuePause?.jobId===j.id)delete db.queuePause;j.state='cancelled';j.message='已取消排队';j.finished=stamp();}else if(j.state==='running'){j.state='cancelling';j.message='正在停止；已完成素材保留';controllers.get(j.id)?.abort();}save();setImmediate(drain);return send(res,200,j);}
    if(['GET','HEAD'].includes(req.method)){
      if(route.startsWith('/media/')){const rel=route.slice(7);if(!/\.(png|jpe?g|webp|mp3|wav|mp4|srt|txt)$/i.test(rel)||rel.endsWith('concat.txt'))return send(res,403,{error:'此文件不能直接访问'});return serve(req,res,mediaFile(rel));}
      const base=path.join(ROOT,'public'),file=path.resolve(base,route==='/'?'index.html':'.'+route);if(!file.startsWith(base+path.sep))return send(res,403,{error:'路径无效'});return serve(req,res,file);
    }
    send(res,404,{error:'接口不存在'});
  }catch(e){send(res,e.status||400,{error:explainError(e)});}
});
function resumeQueue(){
  delete db.queuePause;
  for(const j of db.jobs)if(j.state==='waiting'){j.state='queued';j.message='正在恢复制作，复用已有素材';delete j.nextRetryAt;delete j.finished;}
  save();setImmediate(drain);
}
const recoveryTimer=setInterval(()=>{if(db.queuePause&&Date.now()>=db.queuePause.nextCheckAt&&!maintenance)resumeQueue();},1000);recoveryTimer.unref();
server.listen(PORT,'127.0.0.1',()=>{console.log(`视频故事工坊：http://127.0.0.1:${PORT}`);setImmediate(drain);});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{scheduler.close();clearInterval(recoveryTimer);stopMemoryWatch();for(const c of controllers.values())c.abort();server.close();setTimeout(()=>process.exit(),2000).unref();});
