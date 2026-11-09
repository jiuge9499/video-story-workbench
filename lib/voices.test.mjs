import test from 'node:test';
import assert from 'node:assert/strict';
import {voices,onlineVoices,syncSharedVoices} from './voices.mjs';
import {freshProject,validateProject,scene,speechKey,hash} from './model.mjs';
import {assertSpeechApproved,providerForVoice,SPEECH_PROVIDER,EDGE_SPEECH_PROVIDER} from './shared-voice.mjs';

test('previous online choices remain selectable without changing voice or speed',()=>{
 assert.equal(onlineVoices.length,11);
 for(const v of onlineVoices){
  const p=freshProject();const next=validateProject({...p,voice:v.id,speed:1.2},p);
  assert.equal(next.voice,v.id);assert.equal(next.speed,1.2);
  assert.equal(providerForVoice(next.voice),EDGE_SPEECH_PROVIDER);
 }
});

test('shared voices synchronize by service id without removing online choices',()=>{
 const original=structuredClone(voices);
 try{
  syncSharedVoices({voices:[{id:'panel:男播客',name:'男播客'},{id:'local:test-clone',name:'女博客'},
   {id:'local:test-clone',name:'重复'},{id:'../bad',name:'坏路径'}]},{persist:false});
  assert.equal(voices.filter(v=>v.id==='男播客').length,1);
  assert.equal(voices.filter(v=>v.id==='local:test-clone').length,1);
  assert.equal(voices.length,13);
  const p=freshProject();assert.equal(validateProject({...p,voice:'local:test-clone'},p).voice,'local:test-clone');
  assert.throws(()=>validateProject({...p,voice:'unknown'},p),/音色/);
 }finally{voices.splice(0,voices.length,...original);}
});

test('provider choice preserves existing local caches and prevents wrong-provider exports',()=>{
 const p=freshProject();p.scenes=[scene('配音测试。')];
 assert.equal(speechKey(p),hash(['local-qwen-voice-v1:shared-whisper-chars-v1',p.voice,p.speed,p.scenes.map(s=>[s.id,s.text])]));
 const ready=provider=>({provider,status:'ready',warnings:[]});
 assert.doesNotThrow(()=>assertSpeechApproved({voice:'local:clone',speech:ready(SPEECH_PROVIDER)}));
 assert.doesNotThrow(()=>assertSpeechApproved({voice:onlineVoices[0].id,speech:ready(EDGE_SPEECH_PROVIDER)}));
 assert.throws(()=>assertSpeechApproved({voice:onlineVoices[0].id,speech:ready(SPEECH_PROVIDER)}),/当前音色/);
 assert.notEqual(speechKey(p),speechKey({...p,voice:onlineVoices[0].id}));
});
