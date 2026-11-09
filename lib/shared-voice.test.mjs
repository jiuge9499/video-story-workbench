import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {assertSpeechApproved,speechBlocked,SPEECH_PROVIDER,SPEECH_ALIGNMENT} from './shared-voice.mjs';
import {freshProject,scene,speechKey} from './model.mjs';
import {speech,delivery} from './pipeline.mjs';
import {MEDIA} from './store.mjs';

test('new projects use the requested shared voice and speed',()=>{
  const p=freshProject();assert.equal(p.voice,'男播客');assert.equal(p.speed,1);
});
test('review, failure and unfinished requests cannot release publication',()=>{
  const ready={provider:SPEECH_PROVIDER,status:'ready',warnings:[]};
  assert.doesNotThrow(()=>assertSpeechApproved({speech:ready}));
  for(const p of [{speech:{...ready,status:'review'}},{speech:{...ready,warnings:[{}]}},
    {speech:ready,speechIssue:{status:'failed'}},{speech:ready,speechIssue:{status:'generating'}}]){
    assert.equal(speechBlocked(p),true);assert.throws(()=>assertSpeechApproved(p));
  }
  assert.throws(()=>assertSpeechApproved({speech:{alignment:'word-v3-phrases'}}));
});
test('cached audio with unresolved pronunciation warnings blocks speech and delivery',async()=>{
  const dir=fs.mkdtempSync(path.join(MEDIA,'voice-contract-'));
  try{
    const p=freshProject();p.script='孩子放学回家。';p.scenes=[scene(p.script)];
    const file=path.join(dir,'narration.wav');fs.writeFileSync(file,'preserved review audio');
    p.speech={key:speechKey(p),audio:path.relative(MEDIA,file),alignment:SPEECH_ALIGNMENT,
      provider:SPEECH_PROVIDER,status:'review',warnings:[{part:1}]};
    const ctx={dir,save:()=>{},progress:()=>{}};
    await assert.rejects(speech(p,{},ctx),/读音/);
    await assert.rejects(delivery(p,{},ctx),/读音/);
    assert.equal(fs.readFileSync(file,'utf8'),'preserved review audio');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('outdated scene text cannot be synthesized',async()=>{
  const p=freshProject();p.script='最终文案';p.scenes=[scene('过期分镜')];
  await assert.rejects(speech(p,{},{}),/不一致/);
});
