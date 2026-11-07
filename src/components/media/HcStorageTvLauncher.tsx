import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { PoolServer } from '../../hooks/useHomeCloudPool';
import type { RegisteredDevice } from '../../hooks/useHomeCloudDeviceRegistry';
import { kindOf } from '../devices/deviceKind';
import { useHomeCloudMediaRooms, sendMediaControl, refreshMediaRooms } from '../../hooks/useHomeCloudMediaRooms';

type Root = {
  kind: 'disk' | 'folder';
  id: string;
  name: string;
  online: boolean;
  allow_list: boolean;
  allow_read: boolean;
};
type Agent = { storage_node_id: string; online: boolean; roots?: Root[] };
type AgentList = { agents?: Agent[] };
type Entry = {
  name: string;
  kind: 'file' | 'folder';
  path: string;
  file_id?: string;
  size_bytes?: number;
};
type Directory = { root: { kind: string; id: string }; path: string; items: Entry[]; next_cursor?: string };
type Network = 'lan' | 'tailscale';

const isMedia = (name: string) => /\.(mp3|flac|wav|ogg|oga|m4a|aac|opus|wma|mp4|m4v|webm|mov|mkv|avi|ts|mpeg|mpg)$/i.test(name);
const rootKey = (root: Pick<Root, 'kind' | 'id'>) => JSON.stringify([root.kind, root.id]);
const up = (path: string) => path.split('/').slice(0, -1).join('/');
const sizeLabel = (bytes = 0) => bytes >= 1073741824
  ? `${(bytes / 1073741824).toFixed(2)} ГиБ` : `${(bytes / 1048576).toFixed(1)} МиБ`;

export function HcStorageTvLauncher({ servers, devices }: { servers: PoolServer[]; devices: RegisteredDevice[] }) {
  const [serverId, setServerId] = useState('');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentId, setAgentId] = useState('');
  const [rootId, setRootId] = useState('');
  const [folder, setFolder] = useState('');
  const [files, setFiles] = useState<Entry[]>([]);
  const [selectedFile, setSelectedFile] = useState<Entry | null>(null);
  const [tvId, setTvId] = useState('');
  const [network, setNetwork] = useState<Network>('lan');
  const [refreshKey, setRefreshKey] = useState(0);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const onlineServer = servers.some(s => s.id === serverId && s.phase === 'ready');
  const { snapshot: rooms, error: roomsError } = useHomeCloudMediaRooms(serverId);
  const synced = onlineServer && rooms.server_id === serverId && rooms.phase === 'ready';
  const candidates = useMemo(() => devices
    .filter(d => d.server_id === serverId && kindOf(d.client_type) === 'tv')
    .sort((a, b) => Number(b.online) - Number(a.online) || a.device_id.localeCompare(b.device_id)),
  [devices, serverId]);
  const chosenTV = candidates.find(d => d.device_id === tvId) ?? null;
  const agent = agents.find(a => a.storage_node_id === agentId && a.online) ?? null;
  const roots = agent?.roots?.filter(r => r.online && r.allow_list && r.allow_read) ?? [];
  const root = roots.find(r => rootKey(r) === rootId) ?? null;
  const room = synced ? rooms.rooms.find(r => r.target.device_id === tvId) ?? null : null;
  const canPause = Boolean(chosenTV?.online && room && room.room_state === 'ACTIVE'
    && room.tv_attach === 'READY' && ['PLAYING', 'PAUSED'].includes(room.playback_state));
  const pauseAction = room?.playback_state === 'PAUSED' ? 'resume' : 'pause';

  // A Backend may disappear from the pool. Never preserve its selected files/TV.
  useEffect(() => {
    if (servers.length && !servers.some(s => s.id === serverId)) {
      setServerId(servers.find(s => s.phase === 'ready')?.id ?? servers[0].id);
    }
  }, [servers, serverId]);

  useEffect(() => {
    let active = true;
    setAgents([]);
    setAgentId('');
    setRootId('');
    setFolder('');
    setFiles([]);
    setSelectedFile(null);
    setTvId('');
    setError(null);
    if (!onlineServer) return () => { active = false; };
    setLoadingAgents(true);
    void invoke<AgentList>('homecloud_hcss_sources', { serverId })
      .then(data => { if (active) setAgents((data.agents ?? []).filter(a => a.online)); })
      .catch(reason => { if (active) setError(`HC SS: ${String(reason)}`); })
      .finally(() => { if (active) setLoadingAgents(false); });
    return () => { active = false; };
  }, [serverId, onlineServer, refreshKey]);

  useEffect(() => {
    let active = true;
    setFiles([]);
    setSelectedFile(null);
    setError(null);
    if (!onlineServer || !agent || !root) return () => { active = false; };
    setLoadingFiles(true);
    void invoke<Directory>('homecloud_hcss_browse', {
      serverId, storageNodeId: agent.storage_node_id,
      rootKind: root.kind, rootId: root.id, path: folder,
    }).then(data => {
      if (!active) return;
      if (data.root.kind !== root.kind || data.root.id !== root.id || data.path !== folder) {
        throw Error('Backend вернул содержимое другого корня');
      }
      setFiles(data.items ?? []);
      if (data.next_cursor) setNotice('Показаны первые 500 элементов каталога. Для остальных файлов открой подкаталог.');
    }).catch(reason => { if (active) setError(`Каталог HC SS: ${String(reason)}`); })
      .finally(() => { if (active) setLoadingFiles(false); });
    return () => { active = false; };
  }, [serverId, onlineServer, agentId, rootId, folder, agent?.storage_node_id, root?.kind, root?.id]);

  async function play() {
    if (!onlineServer || !synced || !chosenTV?.online || !agent || !root
        || !selectedFile?.file_id || !selectedFile.file_id.startsWith('hc1.') || busy) return;
    if (room && !window.confirm('На этом телевизоре уже есть медиакомната. Заменить текущий файл?')) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await invoke<{ room_id: string; command_status: string }>('homecloud_hcss_play', {
        serverId, deviceId: chosenTV.device_id, storageNodeId: agent.storage_node_id,
        fileId: selectedFile.file_id, network,
      });
      setNotice(`Backend принял запуск «${selectedFile.name}» (комната ${result.room_id}). Ожидаем подтверждение воспроизведения от TV.`);
      await refreshMediaRooms(serverId);
    } catch (reason) { setError(`Запуск на TV не выполнен: ${String(reason)}`); }
    finally { setBusy(false); }
  }

  async function remote(action: 'pause' | 'resume' | 'stop') {
    if (!room || !synced || busy || (action !== 'stop' && !canPause)) return;
    if (action === 'stop' && !window.confirm('Полностью остановить трансляцию и закрыть комнату на телевизоре?')) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await sendMediaControl({
        serverId, deviceId: room.target.device_id, roomId: room.room_id,
        playbackId: room.playback_id, generation: room.generation, action,
      });
      setNotice(action === 'stop'
        ? `Backend закрыл медиакомнату (${String(result.room_state ?? 'CLOSED')}). Команда закрытия отправлена TV и Gateway; если они Offline, подтверждения физической остановки нет.`
        : 'Команда отправлена. Реальное состояние плеера подтвердит отчёт TV.');
      await refreshMediaRooms(serverId);
    } catch (reason) { setError(`Управление TV: ${String(reason)}`); }
    finally { setBusy(false); }
  }

  return (
    <section className="hc-hcss-launcher" aria-label="HC Storage Service — воспроизведение на телевизоре">
      <header className="hc-hcss-launcher__header">
        <div><span className="hc-media-overline">HC SS → MEDIA GATEWAY → TV</span>
          <h3>Запустить файл на телевизоре</h3>
          <p>Файлы остаются на домашнем HC Storage Service; управление работает через Backend, в том числе по Tailscale.</p>
        </div>
        <button type="button" className="hc-media-button" onClick={() => setRefreshKey(k => k + 1)} disabled={loadingAgents || busy}>Обновить HC SS</button>
      </header>

      <div className="hc-hcss-launcher__selectors">
        <label>Backend
          <select value={serverId} onChange={e => setServerId(e.target.value)} disabled={busy}>
            {servers.map(s => <option key={s.id} value={s.id}>{s.name} · {s.phase}</option>)}
          </select>
        </label>
        <label>HC Storage Service
          <select value={agentId} disabled={!onlineServer || busy || loadingAgents} onChange={e => {
            setAgentId(e.target.value); setRootId(''); setFolder(''); setSelectedFile(null);
          }}>
            <option value="">Выбери хранилище</option>
            {agents.map(a => <option key={a.storage_node_id} value={a.storage_node_id}>{a.storage_node_id}</option>)}
          </select>
        </label>
        <label>Разрешённый диск / каталог
          <select value={rootId} disabled={!agent || busy} onChange={e => {
            setRootId(e.target.value); setFolder(''); setSelectedFile(null);
          }}>
            <option value="">Выбери корень</option>
            {roots.map(r => <option key={rootKey(r)} value={rootKey(r)}>{r.name || r.id} ({r.kind})</option>)}
          </select>
        </label>
      </div>
      {!onlineServer && <p className="hc-hcss-launcher__hint">Для запуска нужен подключённый Backend. Удали́ть или остановить локальный поток при разрыве связи не получится до восстановления управления.</p>}
      {onlineServer && !loadingAgents && !agents.length && <p className="hc-hcss-launcher__hint">Нет зарегистрированных HC SS. Проверь, что Storage Service подключён к этому Backend и опубликовал разрешённые корни.</p>}

      {root && <div className="hc-hcss-launcher__browser">
        <div className="hc-hcss-launcher__path">
          <button type="button" className="hc-media-button" disabled={loadingFiles || !folder || busy}
            onClick={() => setFolder(up(folder))}>Вверх</button>
          <span>{root.name || root.id} / {folder || 'корень'}</span>
        </div>
        <div className="hc-hcss-launcher__files">
          {loadingFiles ? <p>Получение списка файлов…</p>
            : files.length === 0 ? <p>Каталог пуст или недоступен.</p>
            : files.map(file => {
              const folderItem = file.kind === 'folder';
              const playable = file.kind === 'file' && isMedia(file.name)
                && typeof file.file_id === 'string' && file.file_id.startsWith('hc1.');
              if (!folderItem && !playable) return null;
              return <button type="button" key={file.path} disabled={busy}
                className={selectedFile?.path === file.path ? 'hc-hcss-launcher__file hc-hcss-launcher__file--active' : 'hc-hcss-launcher__file'}
                onClick={() => folderItem ? (setFolder(file.path), setSelectedFile(null)) : setSelectedFile(file)}>
                <span>{folderItem ? '📁' : '▶'}</span>
                <strong title={file.path}>{file.name}</strong>
                <small>{folderItem ? 'Папка' : sizeLabel(file.size_bytes)}</small>
              </button>;
            })}
        </div>
      </div>}

      <div className="hc-hcss-launcher__selectors">
        <label>Телевизор на том же Backend
          <select value={tvId} disabled={busy} onChange={e => setTvId(e.target.value)}>
            <option value="">Выбери TV</option>
            {candidates.map(tv => <option key={tv.device_id} value={tv.device_id}>{tv.device_id} · {tv.online ? 'Online' : 'Offline'}</option>)}
          </select>
        </label>
        <label>Маршрут TV ↔ Gateway
          <select value={network} disabled={busy} onChange={e => setNetwork(e.target.value as Network)}>
            <option value="lan">Домашняя LAN</option>
            <option value="tailscale">Tailscale (если TV поддерживает)</option>
          </select>
        </label>
      </div>
      <p className="hc-hcss-launcher__hint">Рабочее подключение панели по Tailscale не означает, что TV должен использовать Tailscale: если он и Gateway дома в одной сети, выбирай LAN.</p>
      <div className="hc-hcss-launcher__actions">
        <button type="button" className="hc-media-button hc-media-button--primary"
          disabled={!selectedFile || !chosenTV?.online || !agent || !synced || busy}
          onClick={() => void play()}>{busy ? 'Выполняется…' : 'Воспроизвести на TV'}</button>
        <button type="button" className="hc-media-button" disabled={!canPause || busy}
          onClick={() => void remote(pauseAction)}>{pauseAction === 'pause' ? 'Пауза TV' : 'Продолжить TV'}</button>
        <button type="button" className="hc-media-button hc-hcss-launcher__stop"
          disabled={!room || !synced || busy} onClick={() => void remote('stop')}>Полный стоп TV</button>
      </div>
      <p className="hc-hcss-launcher__status" role="status">
        {!synced ? `Медиакомнаты: ${rooms.phase}`
          : room ? `Комната ${room.room_id} · ${room.playback_state} · TV attach: ${room.tv_attach} · подтверждение: ${room.control_status ?? '—'}`
            : 'На выбранном TV нет активной медиакомнаты'}
      </p>
      {roomsError && <p role="alert" className="hc-media-inline-error">{roomsError}</p>}
      {error && <p role="alert" className="hc-media-inline-error">{error}</p>}
      {notice && <p className="hc-hcss-launcher__notice" role="status">{notice}</p>}
    </section>
  );
}
