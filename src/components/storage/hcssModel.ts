/** HC SS inventory/read-only browse domain. Backend is the control-plane proxy. */
export type HcssRoot = {
  id: string;
  kind: 'disk' | 'folder';
  name: string;
  online: boolean;
  allow_list: boolean;
  allow_read: boolean;
  allow_write: boolean;
  allow_delete: boolean;
};
export type HcssVolume = {
  volume_id: string;
  kind: string;
  device?: string;
  model?: string;
  mount_path?: string;
  fs_type?: string;
  size_bytes: number;
  free_bytes: number;
  available_bytes: number;
  read_only: boolean;
  removable: boolean;
  mounted: boolean;
};
export type HcssAgent = {
  storage_node_id: string;
  boot_id: string;
  session_epoch: number;
  last_seen: string;
  online: boolean;
  capabilities: string[];
  volumes?: HcssVolume[];
  roots?: HcssRoot[];
  file_ws?: { endpoint: string; endpoints?: string[]; mode?: string };
};
export type HcssDirectoryItem = {
  file_id?: string;
  name: string;
  kind: 'file' | 'folder';
  path: string;
  size_bytes: number;
  modified_unix_nano: number;
};
export type HcssListResponse = {
  root: { kind: string; id: string };
  path: string;
  items: HcssDirectoryItem[];
  next_cursor?: string;
};

export function rootKey(root: Pick<HcssRoot, 'kind' | 'id'>): string {
  return JSON.stringify([root.kind, root.id]);
}

export function isBrowsableRoot(root: HcssRoot): boolean {
  return root.online && root.allow_list && (root.kind === 'disk' || root.kind === 'folder');
}

export function pathIsDirectChild(parent: string, item: HcssDirectoryItem): boolean {
  if (item.kind !== 'file' && item.kind !== 'folder') return false;
  if (!item.name || item.name === '.' || item.name === '..' ||
    item.name.includes('/') || item.name.includes('\\') || item.name.includes('\0')) return false;
  return item.path === (parent ? `${parent}/${item.name}` : item.name);
}

export function folderCrumbs(path: string): { label: string; path: string }[] {
  const parts = path ? path.split('/') : [];
  return [{ label: 'Корень', path: '' }, ...parts.map((label, i) =>
    ({ label, path: parts.slice(0, i + 1).join('/') }))];
}

export function filesystemVolumes(volumes: HcssVolume[] = []): HcssVolume[] {
  // An inventory may include both a physical block device AND its mounted fs.
  // Summing or displaying them as independent capacities would double-count.
  return volumes.filter(v => v.kind === 'filesystem' && v.mounted && v.size_bytes > 0);
}

export function formatBytes(n?: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return '—';
  if (n === 0) return '0 Б';
  const power = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** power).toLocaleString('ru-RU', { maximumFractionDigits: power ? 2 : 0 })} ${['Б', 'КиБ', 'МиБ', 'ГиБ', 'ТиБ'][power]}`;
}

export function formatModified(ns?: number): string {
  if (typeof ns !== 'number' || !Number.isFinite(ns) || ns <= 0) return '—';
  const date = new Date(Math.trunc(ns / 1_000_000));
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU');
}
