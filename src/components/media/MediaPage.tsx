import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useHomeCloudPool } from '../../hooks/useHomeCloudPool';
import { useHomeCloudDeviceRegistry, type RegisteredDevice } from '../../hooks/useHomeCloudDeviceRegistry';
import { useHomeCloudStorage, type StoredFile } from '../../hooks/useHomeCloudStorage';
import { HcStorageTvLauncher } from './HcStorageTvLauncher';
import { kindOf } from '../devices/deviceKind';
import '../../styles/media.css';

type Kind = 'audio' | 'video' | 'image';
type Tab = 'local' | 'server' | 'outputs';
type LocalMedia = { id: string; name: string; kind: Kind; url: string; size: number };
type RemoteMedia = { serverId: string; serverName: string; file: StoredFile; kind: Kind };
type LoopMode = 'off' | 'all' | 'one';
type IconName = 'play' | 'pause' | 'stop' | 'next' | 'previous' | 'volume' | 'mute' | 'video' | 'music' | 'image' | 'cloud' | 'monitor' | 'upload' | 'download' | 'refresh' | 'search' | 'expand' | 'collapse' | 'trash' | 'shuffle' | 'repeat' | 'radio' | 'check' | 'folder';

function MediaIcon({ name, size = 20 }: { name: IconName; size?: number }) {
  const path: Record<IconName, ReactNode> = {
    play: <path d="m8 5 11 7-11 7V5Z"/>, pause: <><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></>,
    stop: <rect x="6" y="6" width="12" height="12" rx="2"/>, next: <><path d="m5 5 10 7-10 7V5Zm12 0v14"/></>, previous: <><path d="m19 5-10 7 10 7V5ZM7 5v14"/></>,
    volume: <><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M17 9a5 5 0 0 1 0 6m2-9a9 9 0 0 1 0 12"/></>,
    mute: <><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="m17 9 5 6m0-6-5 6"/></>,
    video: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3V9Z"/></>,
    music: <><path d="M10 19V5l10-2v14"/><circle cx="7" cy="19" r="3"/><circle cx="17" cy="17" r="3"/></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m3 18 6-6 4 4 3-3 5 5"/></>,
    cloud: <path d="M7 19h10a5 5 0 0 0 .5-10A7 7 0 0 0 4 11a4 4 0 0 0 3 8Z"/>,
    monitor: <><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8m-4-4v4"/></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5"/><path d="M4 17v4h16v-4"/></>,
    download: <><path d="M12 3v13m-5-5 5 5 5-5"/><path d="M4 18v3h16v-3"/></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14-5L3 9m0-5v5h5"/><path d="M4 13a8 8 0 0 0 14 5l3-3m0 5v-5h-5"/></>,
    search: <><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></>,
    expand: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/></>,
    collapse: <><path d="M3 9h6V3M21 9h-6V3M3 15h6v6M21 15h-6v6"/></>,
    trash: <><path d="M4 7h16M10 4h4M6 7l1 14h10l1-14M10 11v6m4-6v6"/></>,
    shuffle: <><path d="M3 6h3c6 0 6 12 12 12h3m-4-4 4 4-4 4M3 18h3c3 0 4-3 6-6m3-4c1-1 2-2 3-2h3m-4-4 4 4-4 4"/></>,
    repeat: <><path d="M7 4h11l3 3-3 3M21 7H6a3 3 0 0 0-3 3v2m14 8H6l-3-3 3-3M3 17h15a3 3 0 0 0 3-3v-2"/></>,
    radio: <><rect x="3" y="7" width="18" height="14" rx="3"/><path d="m5 7 14-4M7 12h6"/><circle cx="16" cy="15" r="2"/></>,
    check: <path d="m5 12 4 4L19 6"/>, folder: <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10H3V7Z"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path[name]}</svg>;
}

const EXT: Record<Kind, string[]> = {
  audio: ['mp3', 'flac', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'opus', 'wma'],
  video: ['mp4', 'm4v', 'webm', 'mov', 'mkv', 'avi', 'ts', 'mpeg', 'mpg'],
  image: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'],
};
function mediaKind(name: string, mime = ''): Kind | null {
  const type = mime.toLowerCase().split(';')[0];
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('image/')) return 'image';
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return (Object.keys(EXT) as Kind[]).find(k => EXT[k].includes(ext)) ?? null;
}
function bytes(n: number) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (!n) return '0 Б';
  const i = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ${['Б', 'КиБ', 'МиБ', 'ГиБ', 'ТиБ'][i]}`;
}
function clock(n: number) {
  if (!Number.isFinite(n)) return '0:00';
  const seconds = Math.max(0, Math.floor(n));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds / 60) % 60;
  const s = seconds % 60;
  return `${h ? `${h}:` : ''}${h ? String(m).padStart(2, '0') : m}:${String(s).padStart(2, '0')}`;
}
const kindName: Record<Kind, string> = { audio: 'Аудио', video: 'Видео', image: 'Изображение' };
const isOutput = (d: RegisteredDevice) => /tv|television|tizen|webos|android-tv|cast|speaker|audio|player|media|receiver|vlc/i.test(d.client_type);
const deviceKey = (d: RegisteredDevice) => JSON.stringify([d.server_id, d.device_id]);

export function MediaPage() {
  const { snapshot: pool } = useHomeCloudPool();
  const { snapshot: registry, send } = useHomeCloudDeviceRegistry();
  const storage = useHomeCloudStorage();
  const reduced = Boolean(useReducedMotion());
  const [tab, setTab] = useState<Tab>('server');
  const [local, setLocal] = useState<LocalMedia[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [playerFullscreen, setPlayerFullscreen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState<LoopMode>('off');
  const [shuffle, setShuffle] = useState(false);
  const [search, setSearch] = useState('');
  const [serverFilter, setServerFilter] = useState('all');
  const [catalog, setCatalog] = useState<RemoteMedia[]>([]);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [busyFile, setBusyFile] = useState<string | null>(null);
  const [selectedOutput, setSelectedOutput] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeError, setNoticeError] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const mediaElement = useRef<HTMLMediaElement | null>(null);
  const bindMedia = useCallback((element: HTMLMediaElement | null) => { mediaElement.current = element; }, []);
  const fullscreenButton = useRef<HTMLButtonElement>(null);
  const ownedUrls = useRef(new Set<string>());
  const localSequence = useRef(0);
  const current = local.find(m => m.id === selectedId) ?? null;
  const currentIndex = local.findIndex(m => m.id === current?.id);
  const hasMedia = Boolean(current && current.kind !== 'image');
  const serverSignature = pool.servers.map(s => `${s.id}:${s.phase}:${s.name}`).join('|');

  useEffect(() => () => {
    ownedUrls.current.forEach(url => URL.revokeObjectURL(url));
    ownedUrls.current.clear();
  }, []);

  useEffect(() => {
    const el = mediaElement.current;
    setElapsed(0); setDuration(0); setPlaying(false);
    if (!el || !current || current.kind === 'image') return;
    el.volume = volume;
    el.muted = muted;
    let cancelled = false;
    void el.play().then(() => { if (!cancelled) setPlaying(true); }).catch(() => {
      // WebView may require another user gesture to start playback.
    });
    return () => { cancelled = true; el.pause(); };
    // A new media element is mounted for each selected file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  useEffect(() => { if (mediaElement.current) mediaElement.current.volume = volume; }, [volume, selectedId]);
  useEffect(() => { if (mediaElement.current) mediaElement.current.muted = muted; }, [muted, selectedId]);

  const importFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []);
    event.currentTarget.value = '';
    const valid = picked.filter(f => mediaKind(f.name, f.type) !== null).slice(0, 200);
    if (valid.length !== picked.length) {
      setNoticeError(false);
      setNotice('Добавлены только поддерживаемые медиафайлы (до 200 за раз). Кодек должен поддерживаться WebView.');
    }
    if (!valid.length) return;
    const entries: LocalMedia[] = valid.map(file => {
      const url = URL.createObjectURL(file);
      ownedUrls.current.add(url);
      return { id: `local-${++localSequence.current}`, name: file.name, url, kind: mediaKind(file.name, file.type)!, size: file.size };
    });
    setLocal(old => [...old, ...entries]);
    setSelectedId(id => id ?? entries[0].id);
    setTab('local');
  };

  const removeLocal = (entry: LocalMedia) => {
    setLocal(old => old.filter(item => item.id !== entry.id));
    if (selectedId === entry.id) setSelectedId(local.find(item => item.id !== entry.id)?.id ?? null);
    // Unmount the element before releasing the URL.
    window.setTimeout(() => { URL.revokeObjectURL(entry.url); ownedUrls.current.delete(entry.url); }, 0);
  };

  const openIndex = (index: number) => {
    if (index >= 0 && index < local.length) setSelectedId(local[index].id);
  };
  const nextIndex = (step: 1 | -1) => {
    if (!local.length || currentIndex < 0) return -1;
    if (shuffle && local.length > 1) {
      const candidates = local.map((_, i) => i).filter(i => i !== currentIndex);
      return candidates[Math.floor(Math.random() * candidates.length)];
    }
    return (currentIndex + step + local.length) % local.length;
  };
  const move = (step: 1 | -1) => openIndex(nextIndex(step));
  const ended = () => {
    setPlaying(false);
    if (!current) return;
    if (loop === 'one') {
      const el = mediaElement.current;
      if (el) { el.currentTime = 0; void el.play().catch(() => {}); }
    } else if (loop === 'all' || currentIndex < local.length - 1) {
      move(1);
    }
  };
  const togglePlay = () => {
    const el = mediaElement.current;
    if (!el) return;
    if (el.paused) void el.play().then(() => setPlaying(true)).catch(() => { setNoticeError(true); setNotice('Не удалось воспроизвести файл. Возможно, его кодек не поддерживается WebView.'); });
    else { el.pause(); setPlaying(false); }
  };
  const seek = (value: number) => {
    const el = mediaElement.current;
    if (!el || !Number.isFinite(el.duration)) return;
    el.currentTime = value;
    setElapsed(value);
  };
  // HomeCloud's window is already fullscreen at the Tauri level. Never call the
  // browser Fullscreen API here: Esc can leave the *Tauri window* fullscreen,
  // while the player's controls (previously outside the requested element) vanish.
  // Reposition the complete player within the existing WebView instead.
  const toggleFullscreen = () => setPlayerFullscreen(value => !value);

  useEffect(() => {
    if (!playerFullscreen) return;
    // Capture before Shell/App shortcuts. Esc must dismiss ONLY the media player.
    const onPlayerKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setPlayerFullscreen(false);
        return;
      }
      const target = event.target;
      const isFormControl = target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'));
      if (isFormControl || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      if (event.code === 'Space') {
        event.preventDefault();
        const player = mediaElement.current;
        if (player) {
          if (player.paused) void player.play().catch(() => {});
          else player.pause();
        }
      } else if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
        const player = mediaElement.current;
        if (!player || !Number.isFinite(player.duration)) return;
        event.preventDefault();
        player.currentTime = Math.max(0, Math.min(player.duration, player.currentTime + (event.code === 'ArrowRight' ? 5 : -5)));
      }
    };
    window.addEventListener('keydown', onPlayerKeyDown, true);
    // Keyboard users can always find the explicit close control.
    fullscreenButton.current?.focus();
    return () => window.removeEventListener('keydown', onPlayerKeyDown, true);
  }, [playerFullscreen]);

  const onlineServers = pool.servers.filter(s => s.phase === 'ready');
  const catalogCount = catalog.filter(item => pool.servers.some(s => s.id === item.serverId)).length;
  useEffect(() => {
    let alive = true;
    const servers = pool.servers.filter(s => s.phase === 'ready');
    const ids = new Set(pool.servers.map(s => s.id));
    setCatalog(items => items.filter(item => ids.has(item.serverId)));
    if (!servers.length) { setLoading(false); setLoadErrors([]); return; }
    setLoading(true); setLoadErrors([]);
    void Promise.allSettled(servers.map(async server => {
      const files = await storage.listFiles(server.id);
      return { server, files: files.filter(file => mediaKind(file.name, file.mime_type) !== null) };
    })).then(results => {
      if (!alive) return;
      const received: RemoteMedia[] = [];
      const failures: string[] = [];
      results.forEach((result, idx) => {
        if (result.status === 'rejected') {
          failures.push(`${servers[idx].name}: ${String(result.reason)}`);
          return;
        }
        const { server, files } = result.value;
        for (const file of files) received.push({ serverId: server.id, serverName: server.name, file, kind: mediaKind(file.name, file.mime_type)! });
      });
      setCatalog(previous => [
        ...previous.filter(item => !servers.some(s => s.id === item.serverId)),
        ...received,
      ]);
      setLoadErrors(failures);
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // serverSignature deliberately tracks only identity/phase, not 1-second ping revisions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSignature, refreshKey, storage.listFiles]);

  const download = async (item: RemoteMedia) => {
    const server = pool.servers.find(s => s.id === item.serverId);
    if (server?.phase !== 'ready') return;
    setBusyFile(`${item.serverId}:${item.file.file_id}`);
    setNotice(null);
    try {
      const path = await storage.download(item.serverId, item.file);
      if (path) { setNoticeError(false); setNotice(`Файл сохранён: ${path}. Чтобы воспроизвести его здесь, добавь файл во вкладке «Локальные».`); }
    } catch (error) { setNoticeError(true); setNotice(String(error)); }
    finally { setBusyFile(null); }
  };

  const outputs = registry.devices.filter(isOutput).sort((a, b) => Number(b.online) - Number(a.online) || a.device_id.localeCompare(b.device_id));
  const currentOutput = outputs.find(d => deviceKey(d) === selectedOutput) ?? null;
  const sendCommand = async (action: string) => {
    if (!currentOutput?.online) return;
    setSending(true); setNotice(null);
    try {
      const result = await send(currentOutput, { action });
      setNoticeError(false);
      setNotice(`${result}. Команда отправлена клиенту, но выполнение им не подтверждено.`);
    } catch (error) { setNoticeError(true); setNotice(String(error)); }
    finally { setSending(false); }
  };

  const query = search.trim().toLowerCase();
  const visibleLocal = useMemo(() => local.filter(entry => entry.name.toLowerCase().includes(query)), [local, query]);
  const visibleCatalog = useMemo(() => catalog.filter(item =>
    (serverFilter === 'all' || serverFilter === item.serverId)
    && (!query || `${item.file.name} ${item.serverName} ${item.file.mime_type}`.toLowerCase().includes(query))
  ).sort((a, b) => a.serverName.localeCompare(b.serverName) || a.file.name.localeCompare(b.file.name)), [catalog, query, serverFilter]);

  const noticeView = notice && <div className={`hc-media-notice ${noticeError ? 'hc-media-notice--error' : ''}`} role="status">
    <span>{notice}</span><button type="button" aria-label="Закрыть уведомление" onClick={() => setNotice(null)}>×</button>
  </div>;

  return <section className="hc-media-page" aria-label="Мультимедиа HomeCloud">
    <input ref={fileInput} className="hc-media-file-input" type="file" accept="audio/*,video/*,image/*,.mkv,.flac,.opus,.avi,.wma,.ts" multiple onChange={importFiles} aria-label="Добавить медиафайлы"/>
    <header className="hc-media-header">
      <div><span className="hc-media-overline">HOMECLOUD · MULTIMEDIA</span><h2>Мультимедиа</h2><p>Локальный плеер, медиатека серверов и устройства воспроизведения</p></div>
      <motion.button type="button" className="hc-media-button hc-media-button--primary" onClick={() => fileInput.current?.click()} whileTap={reduced ? undefined : { scale: .97 }}><MediaIcon name="upload" size={17}/> Добавить файлы</motion.button>
    </header>
    <div className="hc-media-scroll">
      <div className="hc-media-player-grid">
        <motion.div className={`hc-media-stage homecloud-glass ${playerFullscreen ? 'hc-media-stage--fullscreen' : ''}`} role={playerFullscreen ? 'dialog' : undefined} aria-label={playerFullscreen ? 'Полноэкранный медиаплеер HomeCloud' : undefined} initial={{ opacity: 0, y: reduced ? 0 : 10 }} animate={{ opacity: 1, y: 0 }}>
          <div className="hc-media-display" onDoubleClick={toggleFullscreen} title={current ? 'Двойное нажатие — развернуть или свернуть плеер' : undefined}>
            {!current ? <div className="hc-media-empty-player"><span className="hc-media-empty-orb"><MediaIcon name="play" size={38}/></span><strong>Плеер HomeCloud</strong><span>Выбери видео, музыку или изображение на этом устройстве</span></div>
              : current.kind === 'image' ? <img className="hc-media-preview" src={current.url} alt={current.name}/>
              : current.kind === 'video' ? <video key={current.id} className="hc-media-preview" ref={bindMedia} src={current.url} playsInline preload="metadata" onClick={togglePlay} onLoadedMetadata={e => setDuration(e.currentTarget.duration || 0)} onTimeUpdate={e => setElapsed(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={ended} onError={() => {setNoticeError(true);setNotice('Не удалось прочитать видео: кодек или формат не поддерживается движком WebView.');}} />
              : <><div className="hc-media-art"><MediaIcon name="music" size={75}/><div className="hc-media-art-bars" aria-hidden="true">{Array.from({length:19},(_,i)=><i key={i} style={{height:`${20 + (i * 23) % 73}%`}}/>)}</div></div><audio key={current.id} ref={bindMedia} src={current.url} preload="metadata" onLoadedMetadata={e => setDuration(e.currentTarget.duration || 0)} onTimeUpdate={e => setElapsed(e.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={ended} onError={() => {setNoticeError(true);setNotice('Не удалось прочитать аудио: кодек или формат не поддерживается движком WebView.');}} /></>}
            {current && <>
              <div className="hc-media-display-brand" aria-hidden="true"><span className="hc-media-brand-dot"/> HOMECLOUD PLAYER</div>
              {current.kind === 'video' && !playing && <button type="button" className="hc-media-center-play" aria-label="Воспроизвести видео" title="Воспроизвести" onClick={togglePlay}><MediaIcon name="play" size={37}/></button>}
              <button ref={fullscreenButton} type="button" className="hc-media-expand" onClick={toggleFullscreen} aria-label={playerFullscreen ? 'Выйти из полноэкранного плеера' : 'Развернуть плеер'} title={playerFullscreen ? 'Свернуть плеер (Esc)' : 'Развернуть плеер (двойной щелчок)'}><MediaIcon name={playerFullscreen ? 'collapse' : 'expand'}/><span>{playerFullscreen ? 'Выйти' : ''}</span></button>
            </>}
          </div>
          <div className="hc-media-player-footer">
            <div className="hc-media-playing-label"><span className="hc-media-overline">{current ? `${kindName[current.kind]} · локальный файл` : 'СЕЙЧАС ИГРАЕТ'}</span><strong title={current?.name}>{current?.name ?? 'Ничего не выбрано'}</strong></div>
            {hasMedia && <div className="hc-media-seek"><span>{clock(elapsed)}</span><input aria-label="Перемотка" type="range" min={0} max={duration > 0 && Number.isFinite(duration) ? duration : 1} step={0.1} value={Math.min(elapsed, duration > 0 && Number.isFinite(duration) ? duration : 1)} disabled={!duration || !Number.isFinite(duration)} onChange={e => seek(Number(e.target.value))}/><span>{clock(duration)}</span></div>}
            <div className="hc-media-controls">
              <div className="hc-media-controls-group"><button type="button" aria-label="Перемешать" title="Перемешать" aria-pressed={shuffle} className={shuffle?'hc-media-toggle--active':''} onClick={() => setShuffle(v => !v)}><MediaIcon name="shuffle" size={18}/></button><button type="button" aria-label="Предыдущий" title="Предыдущий файл" disabled={!local.length} onClick={() => move(-1)}><MediaIcon name="previous"/></button><button type="button" aria-label={playing?'Пауза':'Воспроизвести'} className="hc-media-play" disabled={!hasMedia} onClick={togglePlay}><MediaIcon name={playing?'pause':'play'} size={23}/></button><button type="button" aria-label="Следующий" title="Следующий файл" disabled={!local.length} onClick={() => move(1)}><MediaIcon name="next"/></button><button type="button" aria-label="Повтор" title={`Повтор: ${loop}`} className={loop !== 'off'?'hc-media-toggle--active':''} onClick={() => setLoop(v => v === 'off' ? 'all' : v === 'all' ? 'one' : 'off')}><MediaIcon name="repeat" size={18}/><small>{loop === 'one'?'1':''}</small></button></div>
              <div className="hc-media-controls-group hc-media-volume"><button type="button" aria-label={muted?'Включить звук':'Отключить звук'} onClick={() => setMuted(v => !v)}><MediaIcon name={muted||volume===0?'mute':'volume'}/></button><input type="range" aria-label="Громкость" min={0} max={1} step={0.01} value={volume} onChange={e => {setVolume(Number(e.target.value));setMuted(false);}}/><span>{Math.round(muted?0:volume*100)}%</span></div>
            </div>
            {playerFullscreen && <div className="hc-media-player-hints">Esc — выйти · Пробел — пауза · ← → — ±5 секунд</div>}
          </div>
        </motion.div>
        <aside className="hc-media-queue homecloud-glass">
          <div className="hc-media-queue__head"><div><span className="hc-media-overline">PLAYLIST</span><h3>Очередь</h3></div><span>{local.length}</span></div>
          <div className="hc-media-queue__items">
            {!local.length && <div className="hc-media-queue__empty">Добавь файлы с компьютера. Они останутся в очереди до закрытия страницы.</div>}
            {local.map((item, idx) => <div key={item.id} className={`hc-media-queue-row ${current?.id===item.id?'hc-media-queue-row--active':''}`}>
              <button type="button" title={item.name} onClick={() => setSelectedId(item.id)}><span className="hc-media-queue-icon"><MediaIcon name={item.kind==='audio'?'music':item.kind==='video'?'video':'image'} size={17}/></span><span className="hc-media-queue-title"><strong>{item.name}</strong><small>{idx + 1} · {bytes(item.size)}</small></span></button>
              <button type="button" className="hc-media-delete" title="Убрать из очереди" aria-label={`Убрать ${item.name}`} onClick={() => removeLocal(item)}><MediaIcon name="trash" size={16}/></button>
            </div>)}
          </div>
        </aside>
      </div>

      <div className="hc-media-library homecloud-glass">
        <div className="hc-media-tabs" role="tablist" aria-label="Источники мультимедиа">
          {([{id:'local',title:'Локальные',icon:'folder'},{id:'server',title:'На серверах',icon:'cloud'},{id:'outputs',title:'Устройства',icon:'monitor'}] as const).map(t => <button key={t.id} role="tab" aria-selected={tab===t.id} type="button" className={tab===t.id?'hc-media-tab hc-media-tab--active':'hc-media-tab'} onClick={() => {setTab(t.id);setSearch('');}}><MediaIcon name={t.icon} size={17}/>{t.title}</button>)}
        </div>
        {tab !== 'outputs' && <div className="hc-media-toolbar"><label className="hc-media-search"><MediaIcon name="search" size={18}/><input value={search} onChange={e=>setSearch(e.target.value)} type="search" placeholder="Поиск по файлам..."/></label>{tab==='server' && <><select aria-label="Сервер" value={serverFilter} onChange={e=>setServerFilter(e.target.value)}><option value="all">Все серверы</option>{pool.servers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select><button type="button" className="hc-media-button" disabled={loading} onClick={()=>setRefreshKey(v=>v+1)}><MediaIcon name="refresh" size={17}/>{loading?'Опрос…':'Обновить'}</button></>}</div>}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} role="tabpanel" className="hc-media-tab-content" initial={{opacity:0,y:reduced?0:10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:reduced?0:-8}} transition={{duration:reduced?.08:.23}}>
            {tab==='local' ? <>
              <div className="hc-media-section-heading"><div><h3>На этом устройстве</h3><p>Файлы воспроизводятся локально в WebView; ничего не отправляется на сервер.</p></div><span>{local.length} файлов</span></div>
              {!visibleLocal.length ? <div className="hc-media-empty"><MediaIcon name="music" size={30}/><strong>{local.length?'Ничего не найдено':'Медиатека пуста'}</strong><span>{local.length?'Измени запрос поиска':'Добавь аудио, видео или изображения с этого устройства.'}</span><button className="hc-media-button" type="button" onClick={()=>fileInput.current?.click()}>Выбрать файлы</button></div>:
                <div className="hc-media-file-grid">{visibleLocal.map(item=><button type="button" key={item.id} onClick={()=>setSelectedId(item.id)} className={`hc-media-file homecloud-glass ${current?.id===item.id?'hc-media-file--active':''}`}><span className="hc-media-file__icon"><MediaIcon name={item.kind==='audio'?'music':item.kind==='video'?'video':'image'} size={27}/></span><span className="hc-media-file__info"><strong>{item.name}</strong><small>{kindName[item.kind]} · {bytes(item.size)}</small></span><MediaIcon name="play" size={15}/></button>)}</div>}
            </> : tab==='server' ? <>
              <HcStorageTvLauncher servers={pool.servers} devices={registry.devices}/>
              <div className="hc-media-section-heading"><div><h3>Медиатека HomeCloud</h3><p>Старый каталог Storage Manager (загрузка файлов). Для запуска на TV используй новый браузер HC Storage Service выше.</p></div><span>{catalogCount} файлов · {onlineServers.length} в сети</span></div>
              {!!loadErrors.length && <div className="hc-media-inline-error" role="status">{loadErrors.join(' · ')}</div>}
              {!visibleCatalog.length ? <div className="hc-media-empty"><MediaIcon name="cloud" size={30}/><strong>{loading?'Получаем каталог…':'Медиафайлы не найдены'}</strong><span>Файлы должны быть зарегистрированы в Storage Manager. Неподключённые серверы не опрашиваются.</span></div>:
                <div className="hc-media-file-grid">{visibleCatalog.map(item=>{const key=`${item.serverId}:${item.file.file_id}`;const ready=pool.servers.find(s=>s.id===item.serverId)?.phase==='ready'; return <div key={key} className="hc-media-file hc-media-file--remote homecloud-glass"><span className="hc-media-file__icon"><MediaIcon name={item.kind==='audio'?'music':item.kind==='video'?'video':'image'} size={27}/></span><span className="hc-media-file__info"><strong title={item.file.name}>{item.file.name}</strong><small>{item.serverName} · {bytes(item.file.size_bytes)}</small><small className={ready?'hc-media-remote-online':'hc-media-remote-offline'}>{ready?'Online':'Offline · данные последнего опроса'}</small></span><button type="button" disabled={!ready||busyFile!==null} className="hc-media-download" title="Скачать через HomeCloud Storage Manager" aria-label={`Скачать ${item.file.name}`} onClick={()=>void download(item)}><MediaIcon name="download" size={19}/></button></div>})}</div>}
              <p className="hc-media-fineprint">API возвращает до 500 зарегистрированных файлов на сервер. Потокового URL для воспроизведения на сервере пока нет: файл можно скачать и добавить в локальный плеер.</p>
            </> : <>
              <div className="hc-media-section-heading"><div><h3>Клиенты воспроизведения</h3><p>Медиаклиенты Backend. Для настоящего управления телевизором используй HC SS → TV во вкладке «На серверах».</p></div><span>{outputs.filter(d=>d.online).length} в сети</span></div>
              {!outputs.length ? <div className="hc-media-empty"><MediaIcon name="monitor" size={30}/><strong>Нет зарегистрированных медиаклиентов</strong><span>Устройство должно подключиться к одному из серверов и объявить подходящий client_type.</span></div>:
                <div className="hc-media-outputs">{outputs.map(device=><button type="button" key={deviceKey(device)} className={`hc-media-output homecloud-glass ${selectedOutput===deviceKey(device)?'hc-media-output--active':''}`} onClick={()=>setSelectedOutput(deviceKey(device))}><MediaIcon name="monitor" size={26}/><span><strong>{device.device_id}</strong><small>{pool.servers.find(s=>s.id===device.server_id)?.name??device.server_id} · {device.client_type}</small></span><span className={device.online?'hc-media-state':'hc-media-state hc-media-state--offline'}><i/>{device.online?'Online':'Offline'}</span></button>)}</div>}
              {currentOutput && (kindOf(currentOutput.client_type) === 'tv'
                ? <div className="hc-media-remote-control homecloud-glass"><div><strong>HomeCloud TV: {currentOutput.device_id}</strong><p>Управление телевизором переведено на настоящие <code>media.rooms.*</code>. Старые произвольные команды <code>clients.send</code> не выполняют Pause/Stop в TV Player.</p></div><button type="button" className="hc-media-button hc-media-button--primary" onClick={() => setTab('server')}>Открыть HC SS → TV / пульт</button></div>
                : <div className="hc-media-remote-control homecloud-glass"><div><strong>Команды клиенту: {currentOutput.device_id}</strong><p>Через <code>clients.send</code> для совместимых сторонних клиентов. Ответ Backend подтверждает лишь помещение команды в очередь.</p></div><div className="hc-media-remote-buttons">{([{action:'media.previous', icon:'previous',label:'Назад'},{action:'media.play',icon:'play',label:'Play'},{action:'media.pause',icon:'pause',label:'Pause'},{action:'media.stop',icon:'stop',label:'Stop'},{action:'media.next',icon:'next',label:'Вперёд'}] as const).map(c=><button key={c.action} type="button" className="hc-media-button" disabled={!currentOutput.online||sending} onClick={()=>void sendCommand(c.action)}><MediaIcon name={c.icon} size={17}/>{c.label}</button>)}</div></div>)}
              <p className="hc-media-fineprint">Обнаружение по client_type — не DLNA, Chromecast или AirPlay discovery. Для полноценной трансляции нужна отдельная реализация соответствующих протоколов или медиаклиент HomeCloud.</p>
            </>}
          </motion.div>
        </AnimatePresence>
      </div>
      {storage.progress && <div className="hc-media-transfer homecloud-glass"><span>Скачивание с {pool.servers.find(s=>s.id===storage.progress?.server_id)?.name??storage.progress.server_id}</span><strong>{bytes(storage.progress.completed_bytes)} / {bytes(storage.progress.total_bytes)}</strong><div><i style={{width:`${storage.progress.total_bytes>0?Math.min(100,storage.progress.completed_bytes/storage.progress.total_bytes*100):0}%`}}/></div></div>}
      {noticeView}
    </div>
  </section>;
}
