import test from 'node:test';
import assert from 'node:assert/strict';
import { canDropInto, planDrop } from '../src/components/explorer/explorerDrag.ts';

const rw={read:true,write:true};
test('WebOS pointer drop allows moving files between folders and into root',()=>{
  assert.equal(canDropInto(['Movie/test.mkv'],'Other','move',rw),true);
  assert.deepEqual(planDrop(['Movie/test.mkv'],'Other','move'),[
    {path:'Movie/test.mkv',newPath:'Other/test.mkv'},
  ]);
  assert.equal(canDropInto(['Movie/test.mkv'],'','move',rw),true);
  assert.deepEqual(planDrop(['Movie/test.mkv'],'','move'),[
    {path:'Movie/test.mkv',newPath:'test.mkv'},
  ]);
});
test('copy on same directory produces a unique filename instead of INVALID_PATH',()=>{
  assert.equal(canDropInto(['Movie/a.mkv'],'Movie','copy',rw),true);
  assert.deepEqual(planDrop(['Movie/a.mkv'],'Movie','copy',['a.mkv','a (копия).mkv']),[
    {path:'Movie/a.mkv',newPath:'Movie/a (копия 2).mkv'},
  ]);
});
test('drag rejects nested destinations and no-op folder moves',()=>{
  for(const mode of ['copy','move']){
    assert.equal(canDropInto(['Movie'],'Movie/sub',mode,rw),false);
    assert.equal(canDropInto(['Movie'],'Movie',mode,rw),false);
  }
  assert.equal(canDropInto(['a.txt'],'','move',rw),false);
  assert.equal(canDropInto(['a.txt'],'','copy',rw),true);
  assert.deepEqual(planDrop(['a.txt'],'','copy',['a.txt']),[
    {path:'a.txt',newPath:'a (копия).txt'},
  ]);
});
test('HC SS read/write flags gate remote drag/drop',()=>{
  assert.equal(canDropInto(['a.txt'],'Movie','copy',{read:false,write:true}),false);
  assert.equal(canDropInto(['a.txt'],'Movie','move',{read:false,write:true}),true);
  assert.equal(canDropInto(['a.txt'],'Movie','move',{read:true,write:false}),false);
  assert.equal(canDropInto([],'Movie','move',rw),false);
});
