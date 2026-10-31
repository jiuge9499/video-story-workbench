import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),port=process.env.PORT||'8776',url=`http://127.0.0.1:${port}`;
const existing=await fetch(url+'/api/state',{signal:AbortSignal.timeout(1500)}).then(r=>r.json()).catch(()=>null);
if(existing&&!Array.isArray(existing.voices))throw Error('该端口被其他应用占用，请设置 PORT 后重试。');
if(!existing){
 fs.mkdirSync(path.join(root,'data'),{recursive:true});const fd=fs.openSync(path.join(root,'data/server.log'),'a');
 const child=spawn(process.execPath,[path.join(root,'server.mjs')],{cwd:root,env:{...process.env,PORT:port},detached:true,stdio:['ignore',fd,fd]});child.unref();fs.closeSync(fd);
 let ready=false;for(let i=0;i<50;i++){await new Promise(r=>setTimeout(r,200));if(await fetch(url+'/api/state').then(r=>r.ok).catch(()=>false)){ready=true;break;}}if(!ready)throw Error('工作台启动失败，请查看 data/server.log');
}
spawn('open',[url],{stdio:'ignore'}).unref();console.log('视频故事工坊已打开：'+url);
