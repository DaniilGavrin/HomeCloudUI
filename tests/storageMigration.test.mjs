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

test('no implicitly registered localhost primary or undeletable server', () => {
  const pool = read('src-tauri/src/server_pool.rs');
  const runtime = read('src-tauri/src/lib.rs');
  const page = read('src/components/servers/ServersPage.tsx');
  const storage = read('src/components/storage/HcssStoragePage.tsx');
  assert.match(pool, /fn migrate_legacy_primary/);
  assert.match(pool, /server\.ipv4\.as_deref\(\) == Some\("127\.0\.0\.1"\)/);
  assert.doesNotMatch(pool, /Основной HomeCloudBackend нельзя удалить/);
  assert.doesNotMatch(runtime, /homecloud_ws::start\(app\.handle\(\)\.clone\(\)\)/);
  assert.doesNotMatch(page, /ipv4: '127\.0\.0\.1'/);
  assert.doesNotMatch(storage, /<option value="primary">/);
});

test('HC SS file connections are discovered without Tailnet URL or token inputs', () => {
  const ui = read('src/components/storage/HcssStoragePage.tsx');
  const native = read('src-tauri/src/file_transfer.rs');
  const model = read('src/components/storage/hcssModel.ts');
  assert.match(model, /file_ws\?/);
  assert.match(ui, /agent\.file_ws/);
  assert.doesNotMatch(ui, /fileToken|setFileToken|setFileEndpoint|Адрес HC SS в Tailscale|Ключ HC SS/);
  assert.doesNotMatch(native, /HeaderValue|Bearer|token: String/);
  assert.match(native, /ip\.is_private\(\)/);
});
