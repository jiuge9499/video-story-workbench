import test from 'node:test';
import assert from 'node:assert/strict';
import {freshProject,renderKey,speechKey} from './model.mjs';
import {STYLE_PRESETS} from './video-styles.mjs';
import {composition} from './pipeline.mjs';

function fixture(){
  const p=freshProject('水印检查');
  p.scenes=[{id:'one',text:'先示范，再练习。',image:'one.png',motion:'push'}];
  p.script=p.scenes[0].text;
  return p;
}

test('all video styles keep a single watermark above artwork for the entire video',()=>{
  for(const style of STYLE_PRESETS)for(const opening of [true,false]){
    const p=fixture();p.visualStyle=style.id;p.opening.enabled=opening;p.subtitle.enabled=false;
    const result=composition(p,{duration:4,scenes:[{id:'one',start:0,end:4}],captions:[]});
    const overlays=[...result.html.matchAll(/<div id="video-watermark"[^>]*><span>([^<]*)<\/span><\/div>/g)];
    assert.equal(overlays.length,1,style.id);
    assert.equal(overlays[0][1],'跃龙教育');
    assert.match(overlays[0][0],/class="clip video-watermark" data-start="0"/);
    assert.ok(overlays[0][0].includes(`data-duration="${result.duration}"`));
    assert.match(result.html,/\.video-watermark\{z-index:10;/);
    assert.match(result.html,/padding:40px 48px/);
    const track=Number(overlays[0][0].match(/data-track-index="(\d+)"/)[1]);
    assert.ok([...result.html.matchAll(/data-track-index="(\d+)"/g)].every(x=>Number(x[1])<=track));
  }
});

test('unwatermarked renders expire while the same narration remains reusable',()=>{
  const p=fixture();
  assert.notEqual(renderKey(p),'a06dd699635e6ee47e26bd59c950b6db043afdc9f912289a4aafb1de6a4111f8');
  assert.equal(speechKey(p),'be7d6aa48478b1144fa6b35fe2658662a42e73960af5b48a8349a7a5e533e98a');
});
