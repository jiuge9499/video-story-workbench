import test from 'node:test';
import assert from 'node:assert/strict';
import {plainNarration} from './narration-text.mjs';
import {freshProject,scene,validateProject,narrationMatches} from './model.mjs';

test('saving formatted narration keeps words and removes controls from every output source',()=>{
  const p=freshProject();p.title='**初二成绩下滑，不是孩子变懒了**';p.script=p.title;
  p.scenes=[scene(p.script)];p.opening.title=p.title;
  const saved=validateProject(p,p);
  assert.equal(saved.title,'初二成绩下滑，不是孩子变懒了');
  assert.equal(saved.script,saved.title);assert.equal(saved.scenes[0].text,saved.title);
  assert.equal(saved.opening.title,saved.title);assert.ok(narrationMatches(saved));
});
test('literal multiplication and unmatched markers remain literal',()=>{
  assert.equal(plainNarration('2 ** 3，A*B，**好**，__学习__'),'2 ** 3，A*B，好，学习');
});
