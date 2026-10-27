import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useHomeCloudPool } from '../../hooks/useHomeCloudPool';
import { useHomeCloudConnection } from '../../hooks/useHomeCloudConnection';
import { useHomeCloudStorage, type StorageVolume, type StoredFile } from '../../hooks/useHomeCloudStorage';
import '../../styles/storage.css';

type Screen = 'list' | 'register' | 'file';
function bytes(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n) || n < 0) return '—';
  if (n === 0) return '0 Б';
  const i = Math.min(4, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toLocaleString('ru-RU', { maximumFractionDigits: i ? 2 : 0 })} ${['Б', 'КиБ', 'МиБ', 'ГиБ', 'ТиБ'][i]}`;
}
function date(s: string): string {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString('ru-RU');
}
function Icon({ name, size = 21 }: { name: 'drive' | 'file' | 'upload' | 'download' | 'refresh' | 'plus' | 'arrow' | 'back' | 'search' | 'server'; size?: number }) {
  const paths: Record<typeof name, ReactNode> = {
    drive: <><rect x="2" y="6" width="20" height="13" rx="3"/><path d="M2 15h20M6.5 17h.01M10 17h.01"/></>,
    file: <><path d="M5 2h9l5 5v15H5zM14 2v6h5"/><path d="M8 13h8M8 17h8"/></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5"/><path d="M4 16v5h16v-5"/></>,
    download: <><path d="M12 3v13m-5-5 5 5 5-5"/><path d="M4 18v3h16v-3"/></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14-5L3 9m0-5v5h5"/><path d="M4 13a8 8 0 0 0 14 5l3-3m0 5v-5h-5"/></>,
    plus: <path d="M12 5v14M5 12h14"/>, arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    back: <path d="M15 18l-6-6 6-6"/>, search: <><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/></>,
    server: <><rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h.01M7 17h.01"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function StoragePage() {
  const { snapshot: pool } = useHomeCloudPool();
  const connection = useHomeCloudConnection();
  const api = useHomeCloudStorage();
  const [serverId, setServerId] = useState('primary');
  const [storageId, setStorageId] = useState('');
  const [volumes, setVolumes] = useState<StorageVolume[]>([]);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [search, setSearch] = useState('');
  const [screen, setScreen] = useState<Screen>('list');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [path, setPath] = useState('');
  const [priority, setPriority] = useState('10');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const reduced = Boolean(useReducedMotion());

  const selected = files.find(f => f.file_id === selectedId) ?? null;
  const server = pool.servers.find(s => s.id === serverId);
  const online = serverId === 'primary' ? connection.phase === 'online' : server?.phase === 'ready';
  const onRefresh = useCallback(async () => {
    if (!online) return;
    setLoading(true); setError(null);
    try {
      const [nextVolumes, nextFiles] = await Promise.all([api.listVolumes(serverId), api.listFiles(serverId, storageId)]);
      setVolumes(nextVolumes); setFiles(nextFiles);
    } catch (cause) { setError(String(cause)); }
    finally { setLoading(false); }
  }, [api.listVolumes, api.listFiles, serverId, storageId, online]);

  useEffect(() => {
    let active = true;
    setVolumes([]); setFiles([]); setSelectedId(null); setScreen('list'); setError(null); setNotice(null);
    if (!online) return;
    setLoading(true);
    void Promise.all([api.listVolumes(serverId), api.listFiles(serverId, storageId)])
      .then(([v, f]) => { if (active) { setVolumes(v); setFiles(f); } })
      .catch(cause => { if (active) setError(String(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [serverId, storageId, online, refreshKey, api.listVolumes, api.listFiles]);

  useEffect(() => {
    if (screen === 'list') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      if (event.target instanceof HTMLElement && event.target.closest('input,textarea,select')) return;
      event.preventDefault(); setScreen('list');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [screen, busy]);

  const visible = useMemo(() => files.filter(f => {
    const needle = search.trim().toLowerCase();
    return !needle || `${f.name} ${f.mime_type} ${f.file_id}`.toLowerCase().includes(needle);
  }).sort((a, b) => b.created_at.localeCompare(a.created_at)), [files, search]);
  const used = volumes.reduce((sum, v) => sum + Math.max(0, v.total_bytes - v.available_bytes), 0);
  const total = volumes.reduce((sum, v) => sum + v.total_bytes, 0);
  const registeredSize = files.reduce((sum, f) => sum + f.size_bytes, 0);

  const register = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy || !online) return;
    setBusy(true); setError(null);
    try {
      await api.register(serverId, name.trim(), path.trim(), Number(priority));
      setNotice('Хранилище зарегистрировано.'); setScreen('list'); setName(''); setPath('');
      setRefreshKey(k => k + 1);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  const upload = async () => {
    if (busy || !online || volumes.length === 0) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await api.upload(serverId, storageId || 'auto');
      if (result) { setNotice(`Загружен файл «${result}».`); setRefreshKey(k => k + 1); }
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  const download = async (file: StoredFile) => {
    if (busy || !online) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const result = await api.download(serverId, file);
      if (result) setNotice(`Скачано: ${result}`);
    } catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  };
  const enter = { initial: { opacity: 0, x: reduced ? 0 : 16 }, animate: { opacity: 1, x: 0 }, exit: { opacity: 0, x: reduced ? 0 : -12 }, transition: { duration: reduced ? .08 : .24 } };
  return <section className="hc-storage homecloud-glass" aria-label="Хранилища HomeCloud">
    <AnimatePresence mode="wait" initial={false}>
      {screen === 'register' ? <motion.div key="register" className="hc-storage__screen" {...enter}>
        <div className="hc-storage__head"><button type="button" className="hc-storage__button" onClick={() => { setScreen('list'); setError(null); }}><Icon name="back"/> Назад</button><h2>Новое хранилище</h2></div>
        <div className="hc-storage__scroll"><div className="hc-storage__form-card homecloud-glass">
          <p>Регистрация каталога на сервере «{server?.name || 'HomeCloudBackend'}». Путь должен уже существовать на сервере и входить в разрешённые <code>storage.allowed_roots</code>.</p>
          <form onSubmit={e => void register(e)} className="hc-storage__form">
            <label>Название<input required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="Основной диск"/></label>
            <label>Каталог на сервере<input required value={path} onChange={e => setPath(e.target.value)} placeholder="/mnt/storage или D:\\Data" spellCheck={false}/></label>
            <label>Приоритет (0–1000)<input required type="number" min="0" max="1000" value={priority} onChange={e => setPriority(e.target.value)}/></label>
            <button type="submit" className="hc-storage__button hc-storage__button--primary" disabled={!online || busy}>Зарегистрировать</button>
          </form>
        </div></div>
      </motion.div> : screen === 'file' && selected ? <motion.div key={`file-${selected.file_id}`} className="hc-storage__screen" {...enter}>
        <div className="hc-storage__head"><button type="button" className="hc-storage__button" onClick={() => setScreen('list')}><Icon name="back"/> К файлам</button><h2>Сведения о файле</h2></div>
        <div className="hc-storage__scroll"><article className="hc-storage__file-detail homecloud-glass">
          <div className="hc-storage__file-big"><Icon name="file" size={32}/></div><h3>{selected.name}</h3>
          <div className="hc-storage__details"><div><span>Размер</span><strong>{bytes(selected.size_bytes)}</strong></div><div><span>Хранилище</span><strong>{volumes.find(v => v.storage_id === selected.storage_id)?.name || selected.storage_id}</strong></div><div><span>MIME-тип</span><strong>{selected.mime_type || '—'}</strong></div><div><span>Добавлен</span><strong>{date(selected.created_at)}</strong></div><div><span>Загрузил</span><strong>{selected.uploaded_by || '—'}</strong></div><div><span>File ID</span><strong>{selected.file_id}</strong></div><div><span>SHA-256</span><strong className="hc-storage__hash">{selected.sha256 || '—'}</strong></div></div>
          <button type="button" className="hc-storage__button hc-storage__button--primary" onClick={() => void download(selected)} disabled={!online || busy}><Icon name="download"/> Скачать файл</button>
        </article></div>
      </motion.div> : <motion.div key="list" className="hc-storage__screen" {...enter}>
        <header className="hc-storage__head hc-storage__head--main">
          <div><div className="hc-storage__overline">HOMECLOUD · STORAGE MANAGER</div><h2>Хранилища</h2><p>Локальные, USB, NFS и SMB-тома серверов HomeCloud</p></div>
          <div className="hc-storage__actions"><button className="hc-storage__button" type="button" disabled={loading || busy || !online} onClick={() => void onRefresh()}><Icon name="refresh"/> Обновить</button><button className="hc-storage__button hc-storage__button--primary" type="button" disabled={!online || busy} onClick={() => { setError(null); setScreen('register'); }}><Icon name="plus"/> Хранилище</button></div>
        </header>
        <div className="hc-storage__scroll">
          <div className="hc-storage__filters">
            <label><Icon name="server"/><select value={serverId} onChange={e => { setServerId(e.target.value); setStorageId(''); }} aria-label="Сервер">
              {pool.servers.length ? pool.servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>) : <option value="primary">HomeCloudBackend</option>}
            </select></label>
            <div className={`hc-storage__state ${online ? 'hc-storage__state--online' : ''}`}><i/>{online ? 'Online' : 'Offline'}</div>
          </div>
          <div className="hc-storage__stats">
            <div className="hc-storage__stat homecloud-glass"><span>Зарегистрировано томов</span><strong>{online ? volumes.length : '—'}</strong><small>Storage Manager</small></div>
            <div className="hc-storage__stat homecloud-glass"><span>Занято на томах</span><strong>{online ? bytes(used) : '—'}</strong><small>{online ? `Из ${bytes(total)} общего объёма` : 'Нет соединения'}</small></div>
            <div className="hc-storage__stat homecloud-glass"><span>Файлы HomeCloud</span><strong>{online ? files.length : '—'}</strong><small>{online ? `${bytes(registeredSize)} · до 500 записей` : 'Нет соединения'}</small></div>
          </div>
          <div className="hc-storage__section-head"><h3>Доступные тома</h3><span>{volumes.length} шт.</span></div>
          <div className="hc-storage__volumes">
            {volumes.length === 0 ? <div className="hc-storage__empty homecloud-glass"><Icon name="drive"/><strong>{online ? 'Тома не зарегистрированы' : 'Сервер недоступен'}</strong><span>{online ? 'Зарегистрируй каталог, разрешённый настройками Go Backend.' : 'Хранилища появятся после восстановления WebSocket.'}</span></div>
              : volumes.map(v => { const percent = v.total_bytes ? Math.round(Math.max(0, Math.min(100, (v.total_bytes-v.available_bytes)*100/v.total_bytes))) : 0;
                return <button key={v.storage_id} className={`hc-storage__volume homecloud-glass ${storageId === v.storage_id ? 'hc-storage__volume--active' : ''}`} type="button" onClick={() => setStorageId(prev => prev === v.storage_id ? '' : v.storage_id)}>
                  <div className="hc-storage__volume-head"><div className="hc-storage__volume-icon"><Icon name="drive"/></div><span className={v.online ? 'hc-storage__pill hc-storage__pill--online':'hc-storage__pill'}>{v.online ? 'Online' : 'Offline'}</span></div>
                  <strong>{v.name}</strong><span className="hc-storage__path" title={v.path}>{v.path}</span>
                  <div className="hc-storage__capacity"><span>{bytes(v.total_bytes-v.available_bytes)} занято</span><span>{percent}%</span></div>
                  <div className="hc-storage__capacity-track"><i style={{ width: `${percent}%` }}/></div>
                  <small>{bytes(v.available_bytes)} свободно · приоритет {v.priority}</small>
                </button>; })}
          </div>
          <div className="hc-storage__section-head hc-storage__section-head--files"><div><h3>Файлы HomeCloud</h3><span>{storageId ? `Том: ${volumes.find(v => v.storage_id === storageId)?.name ?? storageId}` : 'Все тома'}</span></div><button type="button" className="hc-storage__button hc-storage__button--primary" disabled={!online || busy || volumes.length === 0} onClick={() => void upload()}><Icon name="upload"/> Загрузить файл</button></div>
          <div className="hc-storage__toolbar"><label><Icon name="search"/><input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Поиск по имени или типу" /></label><button type="button" className="hc-storage__button" disabled={!storageId} onClick={() => setStorageId('')}>{storageId ? 'Сбросить том' : 'Все тома'}</button></div>
          {loading ? <div className="hc-storage__empty homecloud-glass">Получаем данные с сервера…</div> : visible.length === 0 ? <div className="hc-storage__empty homecloud-glass"><Icon name="file"/><strong>{online ? 'Файлы не найдены' : 'Нет соединения'}</strong><span>{online ? 'Здесь отображаются файлы, зарегистрированные Storage Manager.' : 'Когда сервер вернётся в сеть, обнови список.'}</span></div>
            : <div className="hc-storage__files">{visible.map(f => <motion.button whileHover={reduced?undefined:{x:3}} type="button" key={f.file_id} className="hc-storage__file-row homecloud-glass" onClick={() => { setSelectedId(f.file_id); setScreen('file'); }}><span className="hc-storage__file-icon"><Icon name="file"/></span><span className="hc-storage__file-text"><strong title={f.name}>{f.name}</strong><small>{volumes.find(v=>v.storage_id===f.storage_id)?.name || f.storage_id} · {date(f.created_at)}</small></span><span className="hc-storage__file-size">{bytes(f.size_bytes)}</span><Icon name="arrow" size={17}/></motion.button>)}</div>}
          {files.length >= 500 && <p className="hc-storage__note">Go Backend ограничивает выдачу 500 файлами за запрос. Полноценная пагинация требует расширения серверного API.</p>}
          <p className="hc-storage__note">Список отражает учёт Storage Manager, а не дерево всех каталогов файловой системы. Для произвольных папок нужен отдельный API.</p>
        </div>
      </motion.div>}
    </AnimatePresence>
    {(error || notice) && <div className={`hc-storage__toast ${error?'hc-storage__toast--error':''}`} role={error?'alert':'status'}>{error || notice}<button onClick={() => { setError(null); setNotice(null); }} aria-label="Закрыть сообщение">×</button></div>}
    {busy && api.progress?.server_id === serverId && <div className="hc-storage__transfer" role="status"><span>{api.progress.role === 'upload' ? 'Загрузка файла' : 'Скачивание файла'} · {bytes(api.progress.completed_bytes)} / {bytes(api.progress.total_bytes)}</span><div><i style={{width:`${api.progress.total_bytes ? Math.min(100, Math.round(api.progress.completed_bytes*100/api.progress.total_bytes)) : 100}%`}}/></div></div>}
  </section>;
}
