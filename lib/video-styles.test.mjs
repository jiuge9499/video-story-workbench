import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {REALISTIC_STYLE,REALISTIC_VERSION,STYLE_PRESETS,stylePreset,realisticReference,teacherReferences,realisticReferences,realisticScenePrompt} from './video-styles.mjs';
import {freshProject,scene,validateProject,speechKey,renderKey} from './model.mjs';
import {composition} from './pipeline.mjs';
import {mediaFile,ROOT} from './store.mjs';

test('teacher identity references precede style and only matching scene versions provide continuity',()=>{
 const p={scenes:[{id:'old',image:'old.png',imageStyle:REALISTIC_STYLE,imageStyleVersion:0},{id:'other',image:'other.png',imageStyle:'story'},{id:'current',image:'same.png',imageStyle:REALISTIC_STYLE,imageStyleVersion:REALISTIC_VERSION}]};
 assert.deepEqual(realisticReferences(p,'current'),[...teacherReferences,realisticReference]);
 assert.deepEqual(realisticReferences(p,'next'),[...teacherReferences,realisticReference,'same.png']);
 for(const ref of realisticReferences({scenes:[]},'next'))assert.ok(fs.existsSync(mediaFile(ref)));
 assert.ok(fs.existsSync(ROOT+'/public'+stylePreset(REALISTIC_STYLE).image));
 const prompt=realisticScenePrompt({...p,style:stylePreset(REALISTIC_STYLE).prompt},{text:'和家长沟通学习反馈',prompt:'老师打开反馈册'},'/tmp/generated.png');
 assert.match(prompt,/前两张附图是同一位老师/);
 assert.match(prompt,/第三张附图是已确认手绘风格/);
 assert.match(prompt,/不要绘制标题、流程标签、字幕/);
 assert.match(prompt,/和家长沟通学习反馈/);
 const first={id:'first',text:'老师示范',prompt:'课堂'};
 const firstPrompt=realisticScenePrompt({style:'',opening:{enabled:true},scenes:[first]},first,'/tmp/generated.png');
 assert.match(firstPrompt,/右上区域/);
 assert.match(firstPrompt,/头脸放在画面左侧/);
 assert.doesNotMatch(realisticScenePrompt({style:'',opening:{enabled:false},scenes:[first]},first,'/tmp/generated.png'),/本镜是B5片头/);
});

test('selecting the added style preserves sound, B5 settings, locked shots and version history',()=>{
 const p=freshProject('课堂反馈');p.script='第一句。第二句。';
 p.scenes=[{...scene('第一句。'),image:'old.png',versions:[{file:'old.png'}]},{...scene('第二句。'),locked:true,image:'locked.png'}];
 const key=speechKey(p);
 const next=validateProject({...p,visualStyle:REALISTIC_STYLE,style:stylePreset(REALISTIC_STYLE).prompt},p);
 assert.equal(next.scenes[0].image,null);assert.deepEqual(next.scenes[0].versions,p.scenes[0].versions);
 assert.equal(next.scenes[0].motion,'push');assert.equal(next.scenes[1].image,'locked.png');
 assert.equal(speechKey(next),key);
 for(const field of ['voice','speed','subtitle','opening','transition','sfx'])assert.deepEqual(next[field],p[field]);
 assert.equal(new Set(STYLE_PRESETS.map(x=>x.id)).size,STYLE_PRESETS.length);
});

test('new image style renders through exactly the existing B5 composition',()=>{
 const p=freshProject('课堂反馈');p.visualStyle=REALISTIC_STYLE;p.script='先给示范。再给提示。';
 p.scenes=[{...scene('先给示范。'),image:'one.png'},{...scene('再给提示。'),image:'two.png'}];
 const speech={duration:8,scenes:p.scenes.map((s,i)=>({id:s.id,start:i*4,end:(i+1)*4})),captions:[{text:'先给示范。',start:0,end:4},{text:'再给提示。',start:4,end:8}]};
 const original={...p,visualStyle:'story'};
 assert.deepEqual(composition(p,speech),composition(original,speech));
 assert.notEqual(renderKey(p),renderKey(original));
 assert.equal(stylePreset(REALISTIC_STYLE).motion,stylePreset('story').motion);
});
