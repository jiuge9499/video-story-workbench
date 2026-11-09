import fs from 'node:fs';
import path from 'node:path';
import {DATA,ROOT,atomic} from './store.mjs';

export const onlineVoices=[
 {id:'en-US-EmmaMultilingualNeural',name:'Emma',gender:'女声',style:'在线 · 多语中文',sample:'07-Emma-1.2倍.mp3'},
 {id:'en-US-AvaMultilingualNeural',name:'Ava',gender:'女声',style:'在线 · 多语中文',sample:'08-Ava-1.2倍.mp3'},
 {id:'fr-FR-VivienneMultilingualNeural',name:'Vivienne',gender:'女声',style:'在线 · 多语中文',sample:'09-Vivienne-1.2倍.mp3'},
 {id:'de-DE-SeraphinaMultilingualNeural',name:'Seraphina',gender:'女声',style:'在线 · 多语中文',sample:'10-Seraphina-1.2倍.mp3'},
 {id:'pt-BR-ThalitaMultilingualNeural',name:'Thalita',gender:'女声',style:'在线 · 多语中文',sample:'11-Thalita-1.2倍.mp3'},
 {id:'zh-CN-YunyangNeural',name:'云扬',gender:'男声',style:'在线 · 专业可靠',sample:'01-云扬-1.2倍.mp3'},
 {id:'zh-CN-YunjianNeural',name:'云健',gender:'男声',style:'在线 · 热情有力',sample:'02-云健-1.2倍.mp3'},
 {id:'zh-CN-YunxiNeural',name:'云希',gender:'男声',style:'在线 · 阳光活泼',sample:'03-云希-1.2倍.mp3'},
 {id:'zh-CN-YunxiaNeural',name:'云夏',gender:'男声',style:'在线 · 轻快亲切',sample:'06-云夏-1.2倍.mp3'},
 {id:'zh-CN-XiaoxiaoNeural',name:'晓晓',gender:'女声',style:'在线 · 温暖自然',sample:'04-晓晓-1.2倍.mp3'},
 {id:'zh-CN-XiaoyiNeural',name:'晓伊',gender:'女声',style:'在线 · 清新柔和',sample:'05-晓伊-1.2倍.mp3'},
];
export const sharedSample=id=>`shared-${id.replace(/[^a-zA-Z0-9-]/g,'_')}-1.0倍.mp3`;
const male={id:'男播客',name:'男播客',gender:'男声',style:'本机共享 · 播客口播',sample:'男播客-1.0倍.mp3'};
export const voices=[male,...onlineVoices];
const cache=path.join(DATA,'shared-voices.json');
export function syncSharedVoices(result,{persist=true}={}){
 if(!Array.isArray(result?.voices))throw Error('共享音色列表无效');
 const seen=new Set(['男播客',...onlineVoices.map(v=>v.id)]),local=[];
 for(const voice of result.voices){
  if(typeof voice.id!=='string'||! /^(local|panel):[^\s/\\]+$/.test(voice.id)||typeof voice.name!=='string'||!voice.name.trim()||voice.name.length>80||voice.name==='男播客'||seen.has(voice.id))continue;
  seen.add(voice.id);const sample=sharedSample(voice.id);
  local.push({id:voice.id,name:voice.name,gender:voice.name.includes('女')?'女声':voice.name.includes('男')?'男声':'自定义',style:'本机共享 · 克隆音色',sample:fs.existsSync(path.join(ROOT,'public/assets/voices',sample))?sample:null});
 }
 voices.splice(0,voices.length,male,...local,...onlineVoices);
 if(persist)atomic(cache,{voices:result.voices});
 return voices;
}
try{if(fs.existsSync(cache))syncSharedVoices(JSON.parse(fs.readFileSync(cache,'utf8')),{persist:false});}catch{}
