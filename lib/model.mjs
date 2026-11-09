import {VIDEO_WATERMARK} from './video-watermark.mjs';
import {DEFAULT_STYLE} from './costume.mjs';
import {stylePreset,isEducation,isRealistic,REALISTIC_VERSION} from './video-styles.mjs';
import crypto from 'node:crypto';

import {voices} from './voices.mjs';
import {providerForVoice} from './shared-voice.mjs';
import {plainNarration} from './narration-text.mjs';
export {voices};
export const MAX_SCENES = 300;
export const motions = ['push','pull','left','right','still'];
export const id = () => crypto.randomUUID();
export const hash = v => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const speechKey = p => hash([`${providerForVoice(p.voice)}:shared-whisper-chars-v1`,p.voice,p.speed,p.scenes.map(s=>[s.id,s.text])]);
export const renderKey = p => hash(['b5-long-deng-linear-zoom-v3-white-captions',VIDEO_WATERMARK,speechKey(p),p.subtitle,p.scenes.map(s=>[s.id,s.image,s.motion,...(s.transition?[s.transition]:[])]),...(p.transition?[p.transition]:[]),...(p.opening?[p.opening]:[]),...(p.opening?.enabled&&!p.opening.title.trim()?[p.title]:[]),...(p.sfx?[p.sfx]:[]),...(isEducation(p)?['education-diagram-v3-visual',p.title]:[]),...(isRealistic(p)?['realistic-handdrawn',REALISTIC_VERSION]:[])]);
export const narrationMatches = p => p.scenes.map(s=>s.text).join('').replace(/\s/g,'')===p.script.replace(/\s/g,'');
export const esc = v => String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validateProject(input,old) {
  const p=structuredClone(old);
  if(typeof input.title!=='string'||!input.title.trim()||input.title.length>100) throw Error('作品名称须为 1–100 字');
  if(!voices.some(v=>v.id===input.voice)) throw Error('请选择有效音色');
  if(!Number.isFinite(input.speed)||input.speed<0.8||input.speed>1.5) throw Error('语速范围为 0.8–1.5 倍');
  if(!Array.isArray(input.scenes)||input.scenes.length>MAX_SCENES) throw Error(`最多支持 ${MAX_SCENES} 个镜头`);
  const seen=new Set();
  p.scenes=input.scenes.map(s=>{
    const existing=old.scenes.find(x=>x.id===s.id);
    if(!existing||seen.has(s.id)) throw Error('镜头编号无效或重复');
    seen.add(s.id);
    if(typeof s.text!=='string'||s.text.length>1500||typeof s.prompt!=='string'||s.prompt.length>4000) throw Error('镜头文案或画面描述过长');
    if(!motions.includes(s.motion)) throw Error('运镜选项无效');
    if(s.transition&&!['auto','cut','dissolve','push','blur','slide','match'].includes(s.transition))throw Error('镜头转场选项无效');
    return {...existing,...(s.transition?{transition:s.transition}:{}),text:plainNarration(s.text),prompt:s.prompt,motion:s.motion,locked:!!s.locked};
  });
  if(p.scenes.reduce((n,s)=>n+s.text.length,0)>6000) throw Error('单片文案最多 6000 字');
  if(typeof input.script!=='string'||input.script.length>6000) throw Error('文案最多 6000 字');
  if(typeof input.style!=='string'||input.style.length>2000) throw Error('风格描述最多 2000 字');
  if(!input.subtitle||!/^#[0-9a-f]{6}$/i.test(input.subtitle.color)||!Number.isFinite(input.subtitle.size)||input.subtitle.size<36||input.subtitle.size>76) throw Error('字幕设置无效');
  Object.assign(p,{title:plainNarration(input.title.trim()),voice:input.voice,speed:input.speed,script:plainNarration(input.script),style:input.style,subtitle:{color:input.subtitle.color,size:input.subtitle.size,enabled:!!input.subtitle.enabled}});
  if(input.transition){
    if(!['auto','cut','dissolve','push','blur','slide','match'].includes(input.transition.type)||!Number.isFinite(input.transition.duration)||input.transition.duration<0.2||input.transition.duration>0.8)throw Error('转场时长须为 0.2–0.8 秒');
    p.transition={type:input.transition.type,duration:input.transition.duration};
  }
  if(input.opening){
    if(typeof input.opening.title!=='string'||input.opening.title.length>40)throw Error('开场标题最多 40 字');
    p.opening={enabled:!!input.opening.enabled,title:plainNarration(input.opening.title)};
  }
  if(input.sfx){
    if(!Number.isFinite(input.sfx.volume)||input.sfx.volume<0||input.sfx.volume>0.3)throw Error('音效音量须为 0–30%');
    p.sfx={enabled:!!input.sfx.enabled,volume:input.sfx.volume};
  }
  if(input.visualStyle!==undefined){
    if(!stylePreset(input.visualStyle))throw Error('视频风格无效');
    const previous=old.visualStyle||'story';p.visualStyle=input.visualStyle;
    if(previous!==p.visualStyle)for(const s of p.scenes){if(!s.locked){s.image=null;s.prompt='';s.motion=stylePreset(p.visualStyle).motion;delete s.imageStyle;}}
  }
  if(input.brand!==undefined){
    if(!input.brand||typeof input.brand.name!=='string'||input.brand.name.length>40||typeof input.brand.enabled!=='boolean')throw Error('品牌名称最多40字');
    p.brand={enabled:input.brand.enabled,name:input.brand.name.trim()};
  }
  return p;
}
// Keep every authored character; prefer sentence/clause boundaries near a short visual beat.
export function splitScenes(script,speed=1.2) {
  const target=Math.round(28*Math.min(1.5,Math.max(.8,speed))/1.2);
  const max=Math.round(target*1.45),min=Math.round(target*.5);
  const chunks=[];
  for(const para of script.trim().split(/\n+/).map(s=>s.trim()).filter(Boolean)){
    const chars=Array.from(para);let offset=0;
    while(chars.length-offset>max){
      let best=0,score=Infinity;
      for(let n=min;n<=max;n++){
        const c=chars[offset+n-1];
        if(!/[。！？!?；;，,：:]/.test(c))continue;
        const rest=chars.length-offset-n;
        const cost=Math.abs(n-target)+(/[。！？!?；;]/.test(c)?-5:0)+(rest<min?min-rest:0);
        if(cost<score){score=cost;best=n;}
      }
      const size=best||target;chunks.push(chars.slice(offset,offset+size).join(''));offset+=size;
    }
    if(offset<chars.length)chunks.push(chars.slice(offset).join(''));
  }
  return chunks;
}
export function scene(text='') {return {id:id(),text,prompt:'',motion:'push',locked:false,image:null,versions:[]};}
export function freshProject(title='未命名作品') {
  return {id:id(),title,revision:1,created:new Date().toISOString(),updated:new Date().toISOString(),script:'',visualStyle:'story',opening:{enabled:true,title:''},sfx:{enabled:true,volume:0.12},transition:{type:'auto',duration:0.4},voice:'男播客',speed:1.0,style:DEFAULT_STYLE,subtitle:{enabled:true,color:'#ffffff',size:62},scenes:[],speech:null,renders:[],archived:false};
}
export function srtTime(s){const ms=Math.round(s*1000);return `${String(Math.floor(ms/3600000)).padStart(2,'0')}:${String(Math.floor(ms/60000)%60).padStart(2,'0')}:${String(Math.floor(ms/1000)%60).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;}
export function srt(caps){return caps.map((c,i)=>`${i+1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}`).join('\n\n')+'\n';}
