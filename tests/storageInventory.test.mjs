import test from 'node:test';
import assert from 'node:assert/strict';
import { inventoryTotals, capacityOf } from '../src/components/explorer/storageInventory.ts';

const fsVolume=(id,free,size=1000)=>({
  volume_id:id,kind:'filesystem',mounted:true,size_bytes:size,free_bytes:free,
  available_bytes:free,read_only:false,removable:false,
});
const block=(id)=>({
  volume_id:id,kind:'block',mounted:true,size_bytes:1000,free_bytes:0,
  available_bytes:0,read_only:false,removable:false,
});

test('inventory totals keep per-node filesystems distinct from physical disks',()=>{
  const a={storage_node_id:'node-a',online:true,
    volumes:[block('block:sdb'),fsVolume('mount:storage',320),fsVolume('mount:storage',320)],
    roots:[{id:'main',kind:'disk',online:true,allow_list:true},
      {id:'private',kind:'folder',online:true,allow_list:false}]};
  const b={storage_node_id:'node-b',online:false,
    volumes:[block('block:sda'),fsVolume('mount:root',500),fsVolume('empty',0,0)],
    roots:[{id:'root',kind:'disk',online:false,allow_list:true}]};
  assert.deepEqual(inventoryTotals([a,b]),{
    nodes:2,online:1,filesystems:2,blockDevices:2,roots:3,browsable:1,
  });
  assert.deepEqual(inventoryTotals([]),{
    nodes:0,online:0,filesystems:0,blockDevices:0,roots:0,browsable:0,
  });
});
test('disk utilization handles full disks, missing and invalid numbers safely',()=>{
  assert.deepEqual(capacityOf(100,40),{used:60,percent:60});
  assert.deepEqual(capacityOf(100,0),{used:100,percent:100});
  assert.deepEqual(capacityOf(100,200),{used:0,percent:0});
  assert.deepEqual(capacityOf(0,0),{used:0,percent:0});
  assert.deepEqual(capacityOf(-5,Number.NaN),{used:0,percent:0});
});
