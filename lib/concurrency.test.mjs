import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as tick} from 'node:timers/promises';
import {ResourcePool,createScheduler,VIDEO_CONCURRENCY,IMAGE_CONCURRENCY,TOTAL_IMAGE_CONCURRENCY} from './concurrency.mjs';
import {imageQueue} from './workflow.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const until=async condition=>{for(let i=0;i<30&&!condition();i++)await tick();assert.ok(condition());};

test('two videos each generate four images while the third waits, then fills a free video slot',async()=>{
 const pool=new ResourcePool(),gates=[deferred(),deferred(),deferred()];
 const jobs=gates.map((_,i)=>({id:String(i),projectId:String(i),state:'queued'}));
 const active=[0,0,0],peaks=[0,0,0],started=[],errors=[];let total=0,peak=0;
 const scheduler=createScheduler({jobs,limit:VIDEO_CONCURRENCY,onError:e=>errors.push(e),execute:async job=>{
  const index=Number(job.id);job.state='running';started.push(index);
  await imageQueue(Array.from({length:7},()=>({})),{reference:`${index}.png`,generate:()=>pool.run('image',undefined,async()=>{
   active[index]++;peaks[index]=Math.max(peaks[index],active[index]);total++;peak=Math.max(peak,total);
   await gates[index].promise;active[index]--;total--;
  })});
  job.state='done';
 }});
 scheduler.drain();scheduler.drain();await tick();
 assert.equal(VIDEO_CONCURRENCY,2);assert.equal(IMAGE_CONCURRENCY,4);assert.equal(TOTAL_IMAGE_CONCURRENCY,8);
 assert.deepEqual(started,[0,1]);assert.deepEqual(active,[4,4,0]);assert.equal(total,8);
 gates[0].resolve();await until(()=>active[2]===4);
 assert.deepEqual(started,[0,1,2]);assert.equal(jobs[0].state,'done');assert.equal(active[1],4);
 gates[1].resolve();gates[2].resolve();await until(()=>jobs.every(j=>j.state==='done')&&scheduler.active.size===0);
 assert.deepEqual(peaks,[4,4,4]);assert.equal(peak,8);assert.deepEqual(errors,[]);assert.equal(pool.used.image,0);
 scheduler.close();
});

test('different projects overlap but tasks for the same project remain exclusive',async()=>{
 const jobs=[['a1','a'],['a2','a'],['b1','b'],['c1','c']].map(([id,projectId])=>({id,projectId,state:'queued'}));
 const gates=Object.fromEntries(jobs.map(j=>[j.id,deferred()])),started=[],errors=[];
 const scheduler=createScheduler({jobs,limit:VIDEO_CONCURRENCY,onError:e=>errors.push(e),execute:async job=>{
  job.state='running';started.push(job.id);await gates[job.id].promise;job.state='done';
 }});
 scheduler.drain();await tick();assert.deepEqual(started,['a1','b1']);
 gates.b1.resolve();await until(()=>started.includes('c1'));assert.deepEqual(started,['a1','b1','c1']);
 gates.a1.resolve();await until(()=>started.includes('a2'));
 gates.a2.resolve();gates.c1.resolve();await until(()=>scheduler.active.size===0);
 assert.deepEqual(errors,[]);scheduler.close();
});

test('a failed video frees its slot without interrupting the other video',async()=>{
 const gates=[deferred(),deferred(),deferred()],errors=[],started=[];
 const jobs=gates.map((_,i)=>({id:String(i),projectId:String(i),state:'queued'}));
 const scheduler=createScheduler({jobs,limit:VIDEO_CONCURRENCY,onError:e=>errors.push(e),execute:async job=>{
  job.state='running';const i=Number(job.id);started.push(i);await gates[i].promise;
  if(i===0){job.state='failed';throw Error('failed video');}job.state='done';
 }});
 scheduler.drain();await tick();gates[0].resolve();await until(()=>started.includes(2));
 assert.equal(jobs[1].state,'running');assert.equal(errors.length,1);
 gates[1].resolve();gates[2].resolve();await until(()=>scheduler.active.size===0);scheduler.close();
});

test('cancelling one video releases only its image slots and the other keeps working',async()=>{
 const pool=new ResourcePool(),controller=new AbortController(),gates=[deferred(),deferred()],started=[0,0];
 const queue=(index,signal)=>imageQueue(Array.from({length:9},()=>({})),{reference:`${index}.png`,signal,
  generate:()=>pool.run('image',signal,async()=>{
   started[index]++;await gates[index].promise;signal?.throwIfAborted();
  })});
 const first=queue(0,controller.signal),second=queue(1);
 const cancelled=assert.rejects(first,/abort/i);
 await tick();assert.deepEqual(started,[4,4]);assert.equal(pool.used.image,8);
 controller.abort();gates[0].resolve();await cancelled;
 assert.deepEqual(started,[4,4]);assert.equal(pool.used.image,4);
 gates[1].resolve();await second;assert.deepEqual(started,[4,9]);assert.equal(pool.used.image,0);
});

test('queue pause prevents starting another video until resumed',async()=>{
 const jobs=[0,1,2].map(i=>({id:String(i),projectId:String(i),state:'queued'}));
 const gates=jobs.map(deferred),started=[];let paused=false;
 const scheduler=createScheduler({jobs,limit:VIDEO_CONCURRENCY,canStart:()=>!paused,execute:async job=>{
  job.state='running';started.push(job.id);await gates[Number(job.id)].promise;job.state='done';
 }});
 scheduler.drain();await tick();paused=true;gates[0].resolve();await until(()=>scheduler.active.size===1);
 assert.deepEqual(started,['0','1']);paused=false;scheduler.drain();await until(()=>started.length===3);
 gates[1].resolve();gates[2].resolve();await until(()=>scheduler.active.size===0);scheduler.close();
});
