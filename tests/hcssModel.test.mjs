import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filesystemVolumes, folderCrumbs, formatBytes, formatModified, isBrowsableRoot,
  pathIsDirectChild, rootKey,
} from '../src/components/storage/hcssModel.ts';

const root = { kind:'disk', id:'storage-hdd', name:'Диск хранения', online:true,
  allow_list:true, allow_read:true, allow_write:false, allow_delete:false };

test('browse uses only explicit whitelisted root identifiers, not host paths', () => {
  assert.equal(rootKey(root), '["disk","storage-hdd"]');
  assert.equal(isBrowsableRoot(root), true);
  assert.equal(isBrowsableRoot({ ...root, online:false }), false);
  assert.equal(isBrowsableRoot({ ...root, allow_list:false }), false);
  assert.equal(isBrowsableRoot({ ...root, allow_read:false }), true,
    'listing metadata is allowed separately from downloading contents');
});

test('folder traversal accepts direct children but never parent or injected paths', () => {
  const item = (path, name, kind='file') => ({ path, name, kind, size_bytes:5, modified_unix_nano:0 });
  assert.equal(pathIsDirectChild('media', item('media/video.mp4','video.mp4')), true);
  assert.equal(pathIsDirectChild('', item('films','films','folder')), true);
  assert.equal(pathIsDirectChild('media', item('other/video.mp4','video.mp4')), false);
  assert.equal(pathIsDirectChild('media', item('media/nested/video.mp4','video.mp4')), false);
  assert.equal(pathIsDirectChild('media', item('media/../secret','../secret')), false);
  assert.equal(pathIsDirectChild('media', item('media/a\\b','a\\b')), false);
  assert.deepEqual(folderCrumbs('films/family/2026'), [
    {label:'Корень',path:''}, {label:'films',path:'films'},
    {label:'family',path:'films/family'}, {label:'2026',path:'films/family/2026'},
  ]);
});

test('volume inventory does not double-count disks as mounted filesystems', () => {
  const physical = { volume_id:'block:/dev/sdb', kind:'block', size_bytes:1000, mounted:false };
  const mount = { volume_id:'8:17:/mnt/storage', kind:'filesystem', size_bytes:990, mounted:true };
  const virtual = { volume_id:'nfsd', kind:'filesystem', size_bytes:0, mounted:true };
  assert.deepEqual(filesystemVolumes([physical,mount,virtual]), [mount]);
});

test('file metadata formatting handles empty values and Go nanosecond timestamps', () => {
  assert.equal(formatBytes(0), '0 Б');
  assert.equal(formatBytes(-1), '—');
  assert.equal(formatBytes(1048576), '1 МиБ');
  assert.equal(formatModified(undefined), '—');
  assert.notEqual(formatModified(1794000000000000000), '—');
});
