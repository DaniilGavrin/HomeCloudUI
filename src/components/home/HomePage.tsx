import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useHomeCloudDeviceRegistry, type RegisteredDevice } from '../../hooks/useHomeCloudDeviceRegistry';
import { useHomeCloudPool } from '../../hooks/useHomeCloudPool';
import type { ConnectionStatus } from '../../hooks/useHomeCloudConnection';
import '../../styles/home.css';

type HomeIconName = 'cloud' | 'devices' | 'activity' | 'arrow' | 'refresh' | 'storage' | 'media' | 'server' | 'monitor' | 'phone' | 'tv' | 'other' | 'check';

type Props = {
  connection: ConnectionStatus;
  now: Date;
  onNavigate: (section: string) => void;
};

function HomeIcon({ name, size = 22 }: { name: HomeIconName; size?: number }) {
  const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<HomeIconName, ReactNode> = {
    cloud: <path d="M7 19h10a5 5 0 0 0 .5-10A7 7 0 0 0 4 11a4 4 0 0 0 3 8Z" />,
    devices: <><rect x="2.5" y="4" width="15" height="12" rx="2"/><path d="M7 20h6m-3-4v4"/><rect x="16" y="10" width="5.5" height="11" rx="1.5"/></>,
    activity: <path d="M2 12h4l3-7 5 14 3-7h5" />,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    refresh: <><path d="M20 11a8 8 0 0 0-14-5L3 9m0-5v5h5"/><path d="M4 13a8 8 0 0 0 14 5l3-3m0 5v-5h-5"/></>,
    storage: <><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/></>,
    media: <><rect x="3" y="4" width="18" height="15" rx="2"/><path d="m10 8 5 3.5-5 3.5zM9 22h6"/></>,
    server: <><rect x="3" y="3" width="18" height="8" rx="2"/><rect x="3" y="13" width="18" height="8" rx="2"/><path d="M7 7h.01M7 17h.01M11 7h6M11 17h6"/></>,
    monitor: <><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 22h8m-4-4v4"/></>,
    phone: <><rect x="6.5" y="2" width="11" height="20" rx="2"/><path d="M11 18h2"/></>,
    tv: <><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M9 22h6m-3-3v3"/></>,
    other: <><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M9 12h6m-3-3v6"/></>,
    check: <path d="m5 12 4 4L19 6" />,
  };
  return <svg {...base} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 17) return 'Добрый день';
  if (hour >= 17 && hour < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}

function clientIcon(type: string): HomeIconName {
  const kind = type.toLowerCase();
  if (/(tv|television|android-tv|tizen|webos)/.test(kind)) return 'tv';
  if (/(phone|mobile|android|ios|tablet|touch)/.test(kind)) return 'phone';
  if (/(server|agent|backend|node|hub)/.test(kind)) return 'server';
  if (/(desktop|pc|computer|laptop|windows|linux|mac)/.test(kind)) return 'monitor';
  return 'other';
}

function clientLabel(device: RegisteredDevice): string {
  // Display convenience only: the original server-provided ID remains visible.
  return device.device_id.startsWith('homecloud-ui-') ? 'HomeCloud UI' : device.device_id;
}

const SHORTCUTS: { id: string; icon: HomeIconName; title: string; description: string }[] = [
  { id: 'devices', icon: 'devices', title: 'Устройства', description: 'Активные подключения' },
  { id: 'storage', icon: 'storage', title: 'Хранилища', description: 'Диски и файлы' },
  { id: 'explorer', icon: 'storage', title: 'Проводник', description: 'Файлы HC Storage Service' },
  { id: 'servers', icon: 'server', title: 'Серверы', description: 'Сервисы HomeCloud' },
];

function LatencyGraph({ values }: { values: number[] }) {
  const polyline = useMemo(() => {
    if (values.length < 2) return '';
    const low = Math.max(0, Math.min(...values) - 5);
    const high = Math.max(...values) + 5;
    const range = Math.max(1, high - low);
    return values.map((value, index) => {
      const x = 4 + (index / (values.length - 1)) * 292;
      const y = 58 - ((value - low) / range) * 48;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');
  }, [values]);

  return (
    <div className="hc-home-latency-graph" aria-label={`История задержки: ${values.length} измерений`} role="img">
      {values.length < 2 ? (
        <div className="hc-home-graph-empty">График появится после нескольких измерений</div>
      ) : (
        <svg viewBox="0 0 300 68" preserveAspectRatio="none" focusable="false" aria-hidden="true">
          <path d="M0 58H300M0 34H300M0 10H300" className="hc-home-graph-grid" />
          <polyline points={polyline} className="hc-home-graph-line" />
        </svg>
      )}
    </div>
  );
}

export function HomePage({ connection, now, onNavigate }: Props) {
  const { snapshot, refresh, error: refreshError } = useHomeCloudDeviceRegistry();
  const { snapshot: pool } = useHomeCloudPool();
  const reduced = Boolean(useReducedMotion());
  const [latencySamples, setLatencySamples] = useState<number[]>([]);
  const lastMeasuredRevision = useRef(-1);
  const connected = connection.phase === 'online';
  const onlineDevices = snapshot.devices.filter(device => device.online);
  const count = snapshot.revision >= 0 ? onlineDevices.length : null;
  const shownDevices = onlineDevices.slice(0, 4);
  const serverName = (id: string) => pool.servers.find(server => server.id === id)?.name ?? id;
  const refreshAll = async () => {
    await Promise.allSettled(pool.servers.map(server => refresh(server.id)));
  };
  const averagePing = latencySamples.length
    ? Math.round(latencySamples.reduce((sum, value) => sum + value, 0) / latencySamples.length)
    : null;

  // Connection revisions advance on each Rust ping/pong. Store only actual measurements.
  useEffect(() => {
    if (connection.phase !== 'online') {
      lastMeasuredRevision.current = -1;
      setLatencySamples([]);
    } else if (connection.latency_ms !== null && lastMeasuredRevision.current !== connection.revision) {
      // Avoid duplicating the same pong during React StrictMode effect replay.
      lastMeasuredRevision.current = connection.revision;
      setLatencySamples((previous) => [...previous.slice(-39), connection.latency_ms!]);
    }
  }, [connection.phase, connection.latency_ms, connection.revision]);

  const phaseLabel = connection.phase === 'online' ? 'Подключён'
    : connection.phase === 'connecting' ? 'Подключение…' : 'Нет соединения';
  const phaseDescription = connection.phase === 'online'
    ? 'Соединение с HomeCloudBackend установлено'
    : connection.phase === 'connecting'
      ? 'Ожидаем ответа HomeCloudBackend'
      : 'Ожидаем восстановления связи с сервером';

  const enter = (delay: number) => ({
    initial: { opacity: 0, y: reduced ? 0 : 13 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduced ? 0.1 : 0.38, delay: reduced ? 0 : delay, ease: 'easeOut' as const },
  });

  return (
    <div className="hc-home-page" aria-label="Главная HomeCloud">
      <div className="hc-home-inner">
        <motion.section className="hc-home-hero homecloud-glass" {...enter(0)}>
          <div className="hc-home-hero__content">
            <span className="hc-home-eyebrow"><span className="hc-home-eyebrow__line" /> HOMECLOUD · ОБЗОР</span>
            <h1>{greeting(now.getHours())}<span className="hc-home-title-dot">.</span></h1>
            <p>Устройства, сервисы и состояние домашней системы — в одном пространстве.</p>
            <button className="hc-home-primary-action" type="button" onClick={() => onNavigate('devices')}>
              Открыть устройства <HomeIcon name="arrow" size={17} />
            </button>
          </div>
          <div className={`hc-home-hero__emblem ${connected ? 'hc-home-hero__emblem--online' : ''}`} aria-hidden="true">
            <div className="hc-home-orbit hc-home-orbit--outer" />
            <div className="hc-home-orbit hc-home-orbit--inner" />
            <div className="hc-home-orb"><HomeIcon name="cloud" size={54} /></div>
          </div>
        </motion.section>

        <motion.div className="hc-home-section-label" {...enter(0.06)}>
          <div><span className="hc-home-section-index">01</span><h2>Прямо сейчас</h2></div>
          <span className="hc-home-caption">Данные из HomeCloudBackend</span>
        </motion.div>

        <div className="hc-home-stats">
          <motion.article className="hc-home-stat homecloud-glass" {...enter(0.1)}>
            <div className="hc-home-stat__top"><span className="hc-home-stat__icon"><HomeIcon name="cloud" /></span><span className={`hc-home-state hc-home-state--${connection.phase}`}><i />{connection.phase === 'online' ? 'ONLINE' : connection.phase === 'connecting' ? 'CONNECTING' : 'OFFLINE'}</span></div>
            <span className="hc-home-stat__label">HomeCloudBackend</span>
            <strong className="hc-home-stat__value hc-home-stat__value--text">{phaseLabel}</strong>
            <span className="hc-home-stat__detail">{phaseDescription}</span>
          </motion.article>

          <motion.article className="hc-home-stat homecloud-glass" {...enter(0.15)}>
            <div className="hc-home-stat__top"><span className="hc-home-stat__icon hc-home-stat__icon--violet"><HomeIcon name="devices" /></span><span className="hc-home-stat__side">{count !== null ? 'LIVE' : '—'}</span></div>
            <span className="hc-home-stat__label">Активные устройства</span>
            <strong className="hc-home-stat__value hc-home-number" aria-live="polite">{count ?? '—'}<span>{count === null ? '' : 'в сети'}</span></strong>
            <span className="hc-home-stat__detail">Активные клиенты всех серверов</span>
          </motion.article>

          <motion.article className="hc-home-stat homecloud-glass" {...enter(0.2)}>
            <div className="hc-home-stat__top"><span className="hc-home-stat__icon hc-home-stat__icon--green"><HomeIcon name="activity" /></span><span className="hc-home-stat__side">PING / PONG · 1 С</span></div>
            <span className="hc-home-stat__label">Задержка соединения</span>
            <strong className="hc-home-stat__value hc-home-number" aria-live="off">{connected && connection.latency_ms !== null ? connection.latency_ms : '—'}<span>{connected && connection.latency_ms !== null ? 'мс' : ''}</span></strong>
            <span className="hc-home-stat__detail">Измерение по ответам Go Backend</span>
          </motion.article>
        </div>

        <motion.div className="hc-home-section-label hc-home-section-label--second" {...enter(0.23)}>
          <div><span className="hc-home-section-index">02</span><h2>Обзор системы</h2></div>
          <span className="hc-home-caption">Актуальное состояние</span>
        </motion.div>

        <div className="hc-home-details-grid">
          <motion.section className="hc-home-panel hc-home-device-panel homecloud-glass" {...enter(0.27)} aria-label="Подключённые устройства">
            <div className="hc-home-panel__heading">
              <div><span className="hc-home-overline">CONNECTION MANAGER</span><h3>Подключённые устройства</h3></div>
              <button className="hc-home-icon-action" type="button" aria-label="Обновить список устройств" title="Обновить список устройств" onClick={() => void refreshAll()} disabled={pool.servers.length === 0}><HomeIcon name="refresh" size={18} /></button>
            </div>
            <div className="hc-home-devices-list" aria-live="polite">
              {snapshot.revision < 0 ? <p className="hc-home-list-placeholder">Загружаем данные об устройствах…</p>
                : onlineDevices.length === 0 ? <p className="hc-home-list-placeholder">Сейчас нет активных устройств ни на одном сервере.</p>
                : <AnimatePresence initial={false}>
                  {shownDevices.map((device) => (
                    <motion.div key={`${device.server_id}:${device.device_id}`} className="hc-home-device-row" initial={{ opacity: 0, x: reduced ? 0 : -7 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduced ? 0 : 8 }} transition={{ duration: reduced ? 0.08 : 0.22 }} title={device.device_id}>
                      <span className="hc-home-device-row__icon"><HomeIcon name={clientIcon(device.client_type)} size={19} /></span>
                      <span className="hc-home-device-row__identity"><strong>{clientLabel(device)}</strong><small>{serverName(device.server_id)} · {device.client_type}</small></span>
                      <span className="hc-home-device-row__online" aria-label="В сети" />
                    </motion.div>
                  ))}
                </AnimatePresence>}
            </div>
            {refreshError && <p role="alert" className="hc-home-list-error">{refreshError}</p>}
            <button type="button" className="hc-home-text-link" onClick={() => onNavigate('devices')}>
              {count !== null && count > 4 ? `Все устройства · ${count}` : 'Перейти к устройствам'} <HomeIcon name="arrow" size={17} />
            </button>
          </motion.section>

          <motion.section className="hc-home-panel hc-home-network-panel homecloud-glass" {...enter(0.3)} aria-label="Мониторинг соединения">
            <div className="hc-home-panel__heading"><div><span className="hc-home-overline">NETWORK HEALTH</span><h3>Качество соединения</h3></div><span className={`hc-home-live-indicator ${connected ? '' : 'hc-home-live-indicator--offline'}`}><i />{connected ? 'LIVE' : 'OFFLINE'}</span></div>
            <div className="hc-home-network-value"><strong>{connected && averagePing !== null ? averagePing : '—'}</strong><span>{connected && averagePing !== null ? 'мс в среднем' : 'Нет измерений'}</span></div>
            <LatencyGraph values={latencySamples} />
            <div className="hc-home-network-footer"><span>История Ping / Pong</span><span>{latencySamples.length} из 40 измерений</span></div>
            <div className="hc-home-network-footnote">Измеряется Rust Connection Manager. График обновляется без повторного подключения к WebSocket.</div>
          </motion.section>
        </div>

        <motion.div className="hc-home-section-label hc-home-section-label--second" {...enter(0.32)}>
          <div><span className="hc-home-section-index">03</span><h2>Быстрый доступ</h2></div>
          <span className="hc-home-caption">Разделы HomeCloud</span>
        </motion.div>
        <div className="hc-home-shortcuts">
          {SHORTCUTS.map((shortcut, index) => (
            <motion.button
              key={shortcut.id}
              type="button"
              className="hc-home-shortcut homecloud-glass"
              onClick={() => onNavigate(shortcut.id)}
              initial={{ opacity: 0, y: reduced ? 0 : 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: reduced ? 0.1 : 0.34, delay: reduced ? 0 : 0.36 + index * 0.04 }}
              whileHover={reduced ? undefined : { y: -3 }} whileTap={reduced ? undefined : { scale: 0.985 }}
            >
              <span className="hc-home-shortcut__icon"><HomeIcon name={shortcut.icon} size={24} /></span>
              <span className="hc-home-shortcut__label"><strong>{shortcut.title}</strong><small>{shortcut.description}</small></span>
              <span className="hc-home-shortcut__arrow"><HomeIcon name="arrow" size={18} /></span>
            </motion.button>
          ))}
        </div>
        <p className="hc-home-endnote"><HomeIcon name="check" size={15} /> Показатели берутся из реального соединения; неподключённые устройства не сохраняются в списке.</p>
      </div>
    </div>
  );
}
