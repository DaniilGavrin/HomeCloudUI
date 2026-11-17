import { useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Cpu, Monitor, Server, Smartphone, Tv } from 'lucide-react';
import { useHomeCloudPool } from '../../hooks/useHomeCloudPool';
import { useHomeCloudDeviceRegistry, type RegisteredDevice } from '../../hooks/useHomeCloudDeviceRegistry';
import { kindOf, type DeviceKind } from './deviceKind';
import { TvDevicePanel } from './TvDevicePanel';
import '../../styles/devices.css';

type TypeFilter = 'all' | DeviceKind;
type StatusFilter = 'all' | 'online' | 'offline';

const TYPE_LABEL: Record<DeviceKind, string> = {
  desktop: 'Компьютер', mobile: 'Телефон / планшет', tv: 'Телевизор',
  server: 'Сервер / агент', other: 'Другое устройство',
};
const TYPES: { id: TypeFilter; label: string }[] = [
  { id: 'all', label: 'Все типы' }, { id: 'desktop', label: 'Компьютеры' },
  { id: 'mobile', label: 'Мобильные' }, { id: 'tv', label: 'Телевизоры' },
  { id: 'server', label: 'Агенты' }, { id: 'other', label: 'Остальные' },
];

function DeviceIcon({ kind }: { kind: DeviceKind }) {
  const icons = {
    desktop: Monitor,
    mobile: Smartphone,
    tv: Tv,
    server: Server,
    other: Cpu,
  };
  const Icon = icons[kind];
  return <Icon size={26} strokeWidth={1.7} aria-hidden="true" />;
}

const labelFor = (id: string) => id.startsWith('homecloud-ui-') || id.startsWith('hc-ui-') ? 'HomeCloud UI' : id;
const lastSeen = (seconds: number | null) => seconds === null ? 'Нет данных' : new Date(seconds * 1000).toLocaleString('ru-RU');
const keyFor = (device: RegisteredDevice) => JSON.stringify([device.server_id, device.device_id]);

export function DevicesPage({ onOpenExplorer, canOpenExplorer = true }: { onOpenExplorer: () => void; canOpenExplorer?: boolean }) {
  const { snapshot, error, forget, refresh } = useHomeCloudDeviceRegistry();
  const { snapshot: pool } = useHomeCloudPool();
  const [serverId, setServerId] = useState('all');
  const [search, setSearch] = useState('');
  const [type, setType] = useState<TypeFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeError, setNoticeError] = useState(false);
  const reduced = Boolean(useReducedMotion());

  const serverNames = useMemo(() => new Map(pool.servers.map(s => [s.id, s.name])), [pool.servers]);
  const serverLabel = (id: string) => serverNames.get(id) ?? (id === 'primary' ? 'Основной сервер' : id);
  const activeCount = snapshot.devices.filter(d => d.online).length;
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return snapshot.devices.filter(d =>
      (serverId === 'all' || serverId === d.server_id)
      && (type === 'all' || kindOf(d.client_type) === type)
      && (status === 'all' || (status === 'online' ? d.online : !d.online))
      && (!q || `${d.device_id} ${d.client_type} ${serverNames.get(d.server_id) ?? d.server_id}`.toLowerCase().includes(q))
    ).sort((a, b) => Number(b.online) - Number(a.online) || a.server_id.localeCompare(b.server_id) || a.device_id.localeCompare(b.device_id));
  }, [snapshot.devices, serverId, search, type, status, serverNames]);
  const selected = snapshot.devices.find(d => keyFor(d) === selectedKey) ?? null;
  const selectedIsTv = selected !== null && kindOf(selected.client_type) === 'tv';

  const onRefresh = async () => {
    setNotice(null);
    setBusy(true);
    try {
      const servers = serverId === 'all' ? pool.servers : pool.servers.filter(s => s.id === serverId);
      const results = await Promise.allSettled(servers.map(s => refresh(s.id)));
      const failed = results.filter(result => result.status === 'rejected');
      if (failed.length) {
        setNoticeError(true);
        setNotice(`Не удалось опросить ${failed.length} из ${servers.length} серверов. Недоступные серверы останутся Offline.`);
      } else {
        setNoticeError(false); setNotice('Запрос обновления отправлен.');
      }
    } catch (cause) { setNoticeError(true); setNotice(String(cause)); }
    finally { setBusy(false); }
  };

  const onRefreshTv = async (device: RegisteredDevice) => {
    setBusy(true); setNotice(null);
    try {
      await refresh(device.server_id);
      setNoticeError(false);
      setNotice(`Запрос списка устройств отправлен на «${serverLabel(device.server_id)}». Статус обновится автоматически.`);
    } catch (cause) {
      setNoticeError(true);
      setNotice(`Не удалось обновить устройства: ${String(cause)}`);
    } finally {
      setBusy(false);
    }
  };

  const onForget = async (device: RegisteredDevice) => {
    setBusy(true); setNotice(null);
    try {
      await forget(device);
      setSelectedKey(null);
      setConfirmKey(null);
      setNoticeError(false);
      setNotice(`Офлайн-устройство «${device.device_id}» удалено из локального списка.`);
    } catch (cause) { setNoticeError(true); setNotice(String(cause)); }
    finally { setBusy(false); }
  };



  return (
    <section className="hc-devices-page homecloud-glass" aria-label="Устройства HomeCloud">
      <AnimatePresence mode="wait" initial={false}>
        {selected ? (
          <motion.div key={`detail-${selectedKey}`} className="hc-devices-detail" initial={{opacity:0,x:reduced?0:16}} animate={{opacity:1,x:0}} exit={{opacity:0,x:reduced?0:-12}} transition={{duration:reduced ? 0.08 : 0.25}}>
            <div className="hc-devices-detail__header">
              <button type="button" className="hc-devices-refresh" onClick={() => { setSelectedKey(null); setConfirmKey(null); setNotice(null); }}>← К устройствам</button>
              <span className={selected.online ? 'hc-device-online' : 'hc-device-online hc-device-online--offline'}><i />{selected.online ? 'Online' : 'Offline'}</span>
            </div>
            <div className="hc-devices-detail__scroll">
              <div className="hc-devices-eyebrow">Устройства / {serverLabel(selected.server_id)}</div>
              <h2 className="hc-devices-detail__title">{labelFor(selected.device_id)}</h2>
              <p className="hc-devices-subtitle">{TYPE_LABEL[kindOf(selected.client_type)]}</p>
              <div className="hc-devices-meta">
                <div><span>Сервер</span><strong>{serverLabel(selected.server_id)}</strong></div>
                <div><span>Идентификатор</span><strong>{selected.device_id}</strong></div>
                <div><span>Тип устройства</span><strong>{selected.client_type}</strong></div>
                <div><span>Последний раз в сети</span><strong>{lastSeen(selected.last_seen_at)}</strong></div>
              </div>
              {selectedIsTv && (
                <TvDevicePanel
                  device={selected}
                  backendName={serverLabel(selected.server_id)}
                  busy={busy}
                  onRefresh={() => void onRefreshTv(selected)}
                  onOpenExplorer={onOpenExplorer}
                  canOpenExplorer={canOpenExplorer}
                />
              )}
              {!selected.online ? (
                <div className="hc-devices-command homecloud-glass">
                  <h3>Устройство отключено</h3>
                  <p>Последняя известная информация сохранена локально. Команды недоступны до переподключения.</p>
                  {confirmKey === selectedKey ? (
                    <div className="hc-devices-confirm">
                      <p>Удалить запись об устройстве? Это не отключает и не удаляет устройство на сервере. При новом подключении оно появится снова.</p>
                      <button type="button" className="hc-devices-danger" disabled={busy} onClick={() => void onForget(selected)}>Да, удалить запись</button>
                      <button type="button" className="hc-devices-refresh" onClick={() => setConfirmKey(null)}>Отмена</button>
                    </div>
                  ) : <button type="button" className="hc-devices-danger" onClick={() => setConfirmKey(selectedKey)}>Удалить офлайн-устройство</button>}
                </div>
              ) : null}
              {notice && <div className={`hc-devices-notice ${noticeError?'hc-devices-notice--error':''}`} role="status">{notice}</div>}
            </div>
          </motion.div>
        ) : (
          <motion.div key="list" className="hc-devices-list" initial={{opacity:0,x:reduced?0:-12}} animate={{opacity:1,x:0}} exit={{opacity:0,x:reduced?0:-12}} transition={{duration:reduced ? 0.08 : 0.25}}>
            <div className="hc-devices-header">
              <p>Активные и ранее подключавшиеся устройства</p>
              <div className="hc-devices-header__actions">
                <span className="hc-devices-count" aria-live="polite"><span className="hc-devices-count__number">{activeCount}</span><span>в сети · {snapshot.devices.length} всего</span></span>
                <motion.button className="hc-devices-refresh" type="button" onClick={() => void onRefresh()} disabled={busy} whileTap={reduced?undefined:{scale:.96}}>↻ Обновить</motion.button>
              </div>
            </div>
            <div className="hc-devices-controls">
              <div className="hc-devices-controls__row">
                <label className="hc-devices-search"><span className="sr-only">Поиск устройств</span><input value={search} onChange={e=>setSearch(e.target.value)} type="search" placeholder="Поиск по устройству или серверу..."/></label>
                <label className="hc-devices-server"><span className="sr-only">Сервер</span>
                  <select value={serverId} onChange={e=>setServerId(e.target.value)}><option value="all">Все серверы</option>{pool.servers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
                </label>
              </div>
              <div className="hc-devices-filters" role="group" aria-label="Статус подключения">
                {([{id:'all',label:'Все статусы'},{id:'online',label:'Online'},{id:'offline',label:'Offline'}] as const).map(f=><button key={f.id} type="button" className={status===f.id?'hc-devices-filter hc-devices-filter--active':'hc-devices-filter'} aria-pressed={status===f.id} onClick={()=>setStatus(f.id)}>{f.label}</button>)}
              </div>
              <div className="hc-devices-filters" role="group" aria-label="Тип устройства">
                {TYPES.map(f=><button key={f.id} type="button" className={type===f.id?'hc-devices-filter hc-devices-filter--active':'hc-devices-filter'} aria-pressed={type===f.id} onClick={()=>setType(f.id)}>{f.label}</button>)}
              </div>
            </div>
            {(error || notice) && <div className={`hc-devices-notice ${error || noticeError ? 'hc-devices-notice--error' : ''}`} role="status">{error || notice}</div>}
            <div className="hc-devices-scroll">
              {visible.length === 0 ? <div className="hc-devices-empty"><DeviceIcon kind="other"/><strong>{snapshot.devices.length===0?'Устройства ещё не обнаружены':'Ничего не найдено'}</strong><span>{snapshot.devices.length===0?'Подключи устройство к серверу HomeCloud — оно появится автоматически.':'Попробуй другой сервер или фильтр.'}</span></div> :
                <div className="hc-devices-grid"><AnimatePresence initial={false} mode="popLayout">
                  {visible.map(device=><motion.button type="button" key={keyFor(device)} layout={!reduced} className={`hc-device-card homecloud-glass ${device.online?'':'hc-device-card--offline'} ${kindOf(device.client_type)==='tv'?'hc-device-card--tv':''}`} title={`${device.device_id} · ${serverLabel(device.server_id)}`} initial={{opacity:0,y:reduced?0:12}} animate={{opacity:1,y:0}} exit={{opacity:0,scale:reduced?1:.96}} transition={{duration:reduced ? 0.08 : 0.22}} whileHover={reduced?undefined:{y:-3}} onClick={()=>{setSelectedKey(keyFor(device));setConfirmKey(null);setNotice(null);}}>
                    <span className="hc-device-card__top"><span className={`hc-device-icon hc-device-icon--${kindOf(device.client_type)}`}><DeviceIcon kind={kindOf(device.client_type)}/></span><span className={device.online?'hc-device-online':'hc-device-online hc-device-online--offline'}><i/>{device.online?'Online':'Offline'}</span></span>
                    <span className="hc-device-name">{labelFor(device.device_id)}</span>
                    <span className="hc-device-kind">{TYPE_LABEL[kindOf(device.client_type)]} <span>· {device.client_type}</span></span>
                    {kindOf(device.client_type) === 'tv' && <span className="hc-device-card__tv-tag">Управление TV Player</span>}
                    <span className="hc-device-card__server">⌂ {serverLabel(device.server_id)}</span>
                    <span className="hc-device-card__footer"><span>{device.online?'Подключён':'Последний раз в сети'}</span><span>{lastSeen(device.last_seen_at)}</span></span>
                  </motion.button>)}
                </AnimatePresence></div>}
            </div>
            <footer className="hc-devices-footer">Показаны активные и ранее подключавшиеся устройства. Удалить можно только отключённые устройства.</footer>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
