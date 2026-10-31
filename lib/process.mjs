import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const CODEX=process.env.STORY_CODEX||'/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const runtime=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.runtime');
// Scope HTTPS transport to this workbench; preserve the existing account and model.
export const CODEX_NETWORK_ARGS=['-c','model_providers.workflow-https={name="OpenAI",base_url="https://chatgpt.com/backend-api/codex",wire_api="responses",requires_openai_auth=true,supports_websockets=false}','-c','model_provider="workflow-https"'];
export const PYTHON=process.env.STORY_PYTHON||path.join(runtime,'python/bin/python');
export function hyperframes(){
  const cli=process.env.STORY_HYPERFRAMES||path.join(runtime,'hyperframes/node_modules/hyperframes/dist/cli.js');
  if(!fs.existsSync(cli))throw Error('固定版本的视频渲染工具缺失，请检查 .runtime/manifest.json 或 STORY_HYPERFRAMES 配置；不要清理工作台的 .runtime 目录');
  return cli;
}
export function run(command,args,{cwd,signal,timeout=180000,onData,input}={}){
  return new Promise((resolve,reject)=>{
    if(signal?.aborted)return reject(Error('任务已取消'));
    const child=spawn(command,args,{cwd,env:process.env,detached:true,stdio:['pipe','pipe','pipe']});
    let output='',timedOut=false;
    const stop=()=>{try{process.kill(-child.pid,'SIGTERM');}catch{};setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},1500).unref();};
    const timer=setTimeout(()=>{timedOut=true;stop();},timeout);
    signal?.addEventListener('abort',stop,{once:true});
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',stop);};
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{const t=chunk.toString();output=(output+t).slice(-80000);onData?.(t);});
    child.stdin.on('error',()=>{});child.stdin.end(input||'');
    child.on('error',e=>{cleanup();reject(e);});
    child.on('close',code=>{cleanup();if(signal?.aborted)reject(Error('任务已取消'));else if(timedOut)reject(Object.assign(Error('任务超时，已有产物已保留，请核对后重试'),{details:output,timedOut:true}));else if(code!==0)reject(Object.assign(Error('处理失败'),{details:output,code}));else resolve(output);});
  });
}
export async function probe(file,signal){return JSON.parse(await run('ffprobe',['-v','error','-show_format','-show_streams','-of','json',file],{signal}));}
export function explainError(e){const t=e.details||e.message||'';if(/contains symlink component|symlinked writable roots/i.test(t))return '任务目录含旧兼容链接，请使用真实目录重启闲置工作台后继续；已有图片保留。';if(/workspace routing discovery timed out/i.test(t))return '生成服务连接路由超时，已有图片保留；请检查连接后继续缺失镜头。';if(/WSServerHandshakeError: 403/.test(t))return '配音服务拒绝连接（403），请检查 edge-tts 组件版本及服务状态后重试；已完成图片已保留。';if(e.timedOut)return '生成任务超时，已完成图片已保留；可重试缺失镜头。';if(/usage limit|quota|429|rate.limit/i.test(t))return '服务额度不足或请求受限，请稍后重试。';if(/expired|invalid_grant|not logged|unauthorized|401/i.test(t))return '登录已失效，请在本机 Codex 重新登录后重试。';if(/connection failed|error sending request|request timed out|NoAudioReceived|Cannot connect|ENOTFOUND|DNS|network|connection|WebSocket/i.test(t))return '配音或生成服务连接失败，请检查网络后重试。';if(/image_gen.*(unavailable|not available)|图片.*不可用/i.test(t))return '当前本机图片能力不可用，已有图片保留，可导入图片继续。';return e.message==='处理失败'?'处理未完成，诊断记录已保存在本地任务目录。':e.message;}
