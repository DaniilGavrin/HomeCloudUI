import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the Storage screen points only to HC Storage Service', () => {
  const page = read('src/components/storage/StoragePage.tsx');
  assert.match(page, /HcssStorageOverviewPage/);
  assert.doesNotMatch(page, /LegacyStoragePage|Storage Manager|legacy/i);
  assert.equal(existsSync(new URL('../src/components/storage/LegacyStoragePage.tsx', import.meta.url)), false);
});

test('the old local multimedia player is replaced by the HC SS explorer', () => {
  const nav = read('src/data/navigation.ts');
  const shell = read('src/components/shell/ShellLayout.tsx');
  const explorer = read('src/components/explorer/HcssExplorerPage.tsx');
  assert.match(nav, /label: 'Проводник'/);
  assert.match(nav, /id: 'explorer'/);
  assert.match(shell, /activeId === 'explorer'/);
  assert.match(shell, /HcssExplorerPage/);
  assert.doesNotMatch(shell, /MediaPage|mediaActivated/);
  assert.doesNotMatch(explorer, /<video|<audio|URL\.createObjectURL|HTMLMediaElement/);
  assert.equal(existsSync(new URL('../src/components/media/MediaPage.tsx', import.meta.url)), false);
  assert.match(explorer, /homecloud_hcss_browse/);
  assert.match(explorer, /homecloud_hcss_file_operation/);
  assert.match(explorer, /homecloud_hcss_play/);
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
  const page = read('src/components/explorer/HcssExplorerPage.tsx');
  const native = read('src-tauri/src/file_transfer.rs');
  assert.match(page, /locked\.current=true/);
  assert.match(page, /if\(fence!==currentFence\.current\)throw/);
  assert.match(page, /aria-modal="true"/);
  assert.match(native, /valid_endpoint\(endpoint\)/);
  assert.match(native, /sha256/gi);
  assert.match(native, /fs::hard_link\(&tmp,&local\)/);
});

test('no implicitly registered localhost primary or undeletable server', () => {
  const pool = read('src-tauri/src/server_pool.rs');
  const runtime = read('src-tauri/src/lib.rs');
  const page = read('src/components/servers/ServersPage.tsx');
  const storage = read('src/components/explorer/HcssExplorerPage.tsx');
  assert.match(pool, /fn migrate_legacy_primary/);
  assert.match(pool, /server\.ipv4\.as_deref\(\) == Some\("127\.0\.0\.1"\)/);
  assert.doesNotMatch(pool, /Основной HomeCloudBackend нельзя удалить/);
  assert.doesNotMatch(runtime, /homecloud_ws::start\(app\.handle\(\)\.clone\(\)\)/);
  assert.doesNotMatch(page, /ipv4: '127\.0\.0\.1'/);
  assert.doesNotMatch(storage, /<option value="primary">/);
});

test('HC SS file connections are discovered without Tailnet URL or token inputs', () => {
  const ui = read('src/components/explorer/HcssExplorerPage.tsx');
  const native = read('src-tauri/src/file_transfer.rs');
  const model = read('src/components/storage/hcssModel.ts');
  assert.match(model, /file_ws\?/);
  assert.match(ui, /agent\.file_ws/);
  assert.doesNotMatch(ui, /fileToken|setFileToken|setFileEndpoint|Адрес HC SS в Tailscale|Ключ HC SS/);
  assert.doesNotMatch(native, /HeaderValue|Bearer|token: String/);
  assert.match(native, /ip\.is_private\(\)/);
});


test('HC SS discovers file transfer without a mode or key configuration', () => {
  const ui = read('src/components/explorer/HcssExplorerPage.tsx');
  const model = read('src/components/storage/hcssModel.ts');
  const native = read('src-tauri/src/file_transfer.rs');
  assert.match(model, /endpoints\?: string\[\]/);
  assert.match(ui, /endpoints/);
  assert.match(ui, /endpoints:\[\.\.\.endpoints\]/);
  assert.doesNotMatch(ui, /file_ws\?\.mode|auth_mode|включи file_ws|trusted_network/);
  assert.match(native, /endpoints: Vec<String>/);
  assert.match(native, /for endpoint in endpoints/);
  assert.doesNotMatch(native, /Bearer|HeaderValue|token: String/);
});

test('both Servers overview and Settings retain confirmed server removal', () => {
  const overview = read('src/components/servers/ServersPage.tsx');
  const settings = read('src/components/settings/SettingsPage.tsx');
  const poolHook = read('src/hooks/useHomeCloudPool.ts');
  const poolNative = read('src-tauri/src/server_pool.rs');

  assert.match(overview, /role="alertdialog"/);
  assert.match(overview, /setConfirmId\(server\.id\)/);
  assert.match(overview, /await pool\.remove\(deleting\.id\)/);
  assert.match(overview, /Сам HomeCloudBackend не будет остановлен или удалён/);
  assert.match(settings, /setScreen\('delete'\)/);
  assert.match(settings, /await pool\.remove\(deleting\.id\)/);
  assert.match(poolHook, /invoke<PoolSnapshot>\('homecloud_pool_delete'/);
  assert.match(poolNative, /fn homecloud_pool_delete\(/);
});

test('native file transfer repeats only integrity errors, not failed permissions', () => {
  const native = read('src-tauri/src/file_transfer.rs');
  const page = read('src/components/explorer/HcssExplorerPage.tsx');
  assert.match(native, /MAX_INTEGRITY_ATTEMPTS: usize = 3/);
  assert.match(native, /async fn retry_integrity/);
  assert.match(native, /INTEGRITY_ERROR: &str = "CHECKSUM_MISMATCH"/);
  assert.match(native, /tokio::test/);
  assert.match(native, /drop\(file\)/);
  assert.match(page, /homecloud:hcss-transfer-progress/);
});

test('HC SS moves files and directories through native WS and destination dialog', () => {
  const ui = read('src/components/explorer/HcssExplorerPage.tsx');
  const native = read('src-tauri/src/file_transfer.rs');
  assert.match(native, /"move"=>"file\.move"/);
  assert.match(native, /action=="file\.rename" \|\| action=="file\.move"/);
  assert.match(ui, /setDestFolder/);
  assert.match(ui, /homecloud_hcss_browse/);
  assert.match(ui, /modal\.type==='destination'/);
  assert.match(ui, /onDrop/);
});

test('WebOS explorer supports remote copy/move and modal-only file properties', () => {
  const explorer = read('src/components/explorer/HcssExplorerPage.tsx');
  const native = read('src-tauri/src/file_transfer.rs');
  assert.match(explorer,/await batch\(mode==='copy'\?'copy':'move',entries\)/);
  assert.match(explorer,/await fileAction\(operation,entry.path,entry.newPath,entry.localFile\)/);
  assert.match(explorer,/aria-modal="true"/);
  assert.match(explorer,/onContextMenu/);
  assert.match(explorer,/onDragStart/);
  assert.match(explorer,/onDrop/);
  assert.match(explorer,/event\.shiftKey/);
  assert.match(explorer,/event\.ctrlKey/);
  assert.match(native,/"copy"=>"file\.copy"/);
  assert.match(native,/"touch"=>"file\.touch"/);
  assert.match(native,/action=="file\.copy"/);
});

test('TV playback from HC SS explorer requires confirmed room replacement', () => {
 const explorer = read('src/components/explorer/HcssExplorerPage.tsx');
 assert.match(explorer, /useHomeCloudMediaRooms/);
 assert.match(explorer, /existingRoom&&!replaceRoom/);
 assert.match(explorer, /type="checkbox" checked=\{replaceRoom\}/);
 assert.match(explorer, /refreshMediaRooms\(serverId\)/);
});
