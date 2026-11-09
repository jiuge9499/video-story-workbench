import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {imageQueue} from './workflow.mjs';
import {IMAGE_CONCURRENCY,ResourcePool} from './concurrency.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('one video runs four images through the resource pool and refills free slots',async()=>{
 const pool=new ResourcePool(),items=Array.from({length:9},(_,id)=>({id}));
 const gates=items.map(deferred),started=[],reports=[];let active=0,peak=0;
 const task=imageQueue(items,{reference:'approved.png',onChange:s=>reports.push(s),
  generate:(item,ref)=>pool.run('image',undefined,async()=>{
   assert.equal(ref,'approved.png');started.push(item.id);active++;peak=Math.max(peak,active);
   await gates[item.id].promise;item.image=`${item.id}.png`;active--;
  })});
 await tick();assert.equal(IMAGE_CONCURRENCY,4);assert.deepEqual(started,[0,1,2,3]);
 gates[2].resolve();await tick();assert.deepEqual(started,[0,1,2,3,4]);
 for(const gate of gates)gate.resolve();await task;
 assert.equal(peak,4);assert.equal(new Set(started).size,9);
 assert.ok(items.every(item=>item.image));assert.equal(pool.used.image,0);
 assert.deepEqual(reports.at(-1),{active:0,completed:9,failed:0,limit:4});
});

test('without a reference the first image is persisted before parallel work starts',async()=>{
 const seed=deferred(),started=[],refs=[];
 const items=Array.from({length:6},(_,id)=>({id}));
 const task=imageQueue(items,{generate:async(item,ref)=>{
  started.push(item.id);refs.push(ref);
  if(item.id===0)await seed.promise;
  item.image=`${item.id}.png`;
 }});
 await tick();assert.deepEqual(started,[0]);seed.resolve();await task;
 assert.equal(refs[0],undefined);assert.ok(refs.slice(1).every(ref=>ref==='0.png'));
});

test('only failed images are retried and successful images remain intact',async()=>{
 const calls=new Map(),items=Array.from({length:7},(_,id)=>({id}));
 await imageQueue(items,{reference:'fixed.png',wait:async()=>{},generate:async item=>{
  const count=(calls.get(item.id)||0)+1;calls.set(item.id,count);
  if(item.id===2&&count<3)throw Error('network failure');
  item.image=`${item.id}.png`;
 }});
 for(const item of items){assert.equal(calls.get(item.id),item.id===2?3:1);assert.ok(item.image);}
});

test('quota failure stops new images and waits for in-flight images to finish',async()=>{
 const gate=deferred(),started=[],finished=[],items=Array.from({length:10},(_,id)=>({id}));
 const task=imageQueue(items,{reference:'fixed.png',generate:async item=>{
  started.push(item.id);
  if(item.id===0)throw Error('429 rate limit');
  await gate.promise;finished.push(item.id);
 }});
 const outcome=assert.rejects(task,/429/);
 await tick();assert.deepEqual(started,[0,1,2,3]);assert.deepEqual(finished,[]);
 gate.resolve();await outcome;assert.deepEqual(finished,[1,2,3]);
});

test('cancellation stops new images and retains completed work',async()=>{
 const controller=new AbortController(),gate=deferred(),started=[];
 const items=Array.from({length:8},(_,id)=>({id}));
 const task=imageQueue(items,{reference:'fixed.png',signal:controller.signal,generate:async item=>{
  started.push(item.id);await gate.promise;item.image=`${item.id}.png`;
 }});
 const outcome=assert.rejects(task,/abort/i);
 await tick();controller.abort();gate.resolve();await outcome;
 assert.deepEqual(started,[0,1,2,3]);assert.ok(items.slice(0,4).every(item=>item.image));
 assert.ok(items.slice(4).every(item=>!item.image));
});

test('the image pool caps simultaneous requests across queues',async()=>{
 const pool=new ResourcePool(),gate=deferred();let active=0,peak=0;
 const queue=()=>imageQueue(Array.from({length:6},()=>({})),{reference:'fixed.png',
  generate:()=>pool.run('image',undefined,async()=>{active++;peak=Math.max(peak,active);await gate.promise;active--;})});
 const tasks=[queue(),queue(),queue()];await tick();assert.equal(active,8);
 gate.resolve();await Promise.all(tasks);assert.equal(peak,8);assert.equal(pool.used.image,0);
});
