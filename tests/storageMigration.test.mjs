import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the Storage screen points only to HC Storage Service', () => {
  const page = read('src/components/storage/StoragePage.tsx');
  assert.match(page, /HcssStoragePage/);
  assert.doesNotMatch(page, /LegacyStoragePage|Storage Manager|legacy/i);
  assert.equal(existsSync(new URL('../src/components/storage/LegacyStoragePage.tsx', import.meta.url)), false);
});

test('the Media page uses HC SS → TV, never the legacy file catalog', () => {
  const media = read('src/components/media/MediaPage.tsx');
  assert.match(media, /HcStorageTvLauncher/);
  for (const banned of ['useHomeCloudStorage', 'storage.files.list', 'visibleCatalog', 'Storage Manager']) {
    assert.equal(media.includes(banned), false, `Unexpected legacy media path: ${banned}`);
  }
  assert.equal(existsSync(new URL('../src/hooks/useHomeCloudStorage.ts', import.meta.url)), false);
});

test('Rust IPC does not allow Backend Storage Manager transfer commands', () => {
  const storage = read('src-tauri/src/storage.rs');
  const lib = read('src-tauri/src/lib.rs');
  for (const action of ['storage.register','storage.upload.prepare','storage.download.prepare',
    'storage.files.list','storage.transfer.cancel','storage.list']) {
    assert.equal(storage.includes(`"${action}"`), false, `Legacy command still exposed: ${action}`);
  }
  for (const command of ['homecloud_storage_command', 'homecloud_storage_local_file', 'homecloud_storage_transfer']) {
    assert.equal(lib.includes(command), false, `Legacy Tauri IPC still registered: ${command}`);
  }
  assert.match(lib, /media_source::homecloud_hcss_browse/);
  assert.match(storage, /"storage\.fs\.list"/);
  assert.equal(existsSync(new URL('../src-tauri/capabilities/homecloud-storage.json', import.meta.url)), false);
});

test('native HC SS mutations are fenced across file dialogs and root changes', () => {
  const page = read('src/components/storage/HcssStoragePage.tsx');
  const native = read('src-tauri/src/file_transfer.rs');
  assert.match(page, /operationLock\.current = true/);
  assert.match(page, /if \(liveSelection\.current !== actionKey\) return/);
  assert.match(page, /setPendingDelete\(null\)/);
  assert.match(page, /disabled=\{fileBusy/);
  assert.match(native, /valid_endpoint\(endpoint\)/);
  assert.match(native, /sha256/gi);
  assert.match(native, /fs::hard_link\(&tmp,&local\)/);
});
