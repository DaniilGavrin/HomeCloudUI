import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowRight, Check, Cloud, Cpu, HardDrive, Monitor,
  Music2, Plus, RefreshCw, Server, Smartphone, Tv,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useHomeCloudDeviceRegistry, type RegisteredDevice } from '../../hooks/useHomeCloudDeviceRegistry';
import { useHomeCloudPool } from '../../hooks/useHomeCloudPool';
import type { SectionPreferences } from '../../hooks/useSectionPreferences';
import type { ConnectionStatus } from '../../hooks/useHomeCloudConnection';
import '../../styles/home.css';

type HomeIconName = 'cloud' | 'devices' | 'activity' | 'arrow' | 'refresh' | 'storage' | 'media' | 'server' | 'monitor' | 'phone' | 'tv' | 'other' | 'check';

type Props = {
  connection: ConnectionStatus;
  onNavigate: (section: string) => void;
  enabledSections: SectionPreferences;
};

const HOME_ICONS: Record<HomeIconName, LucideIcon> = {
  cloud: Cloud,
  devices: Cpu,
  activity: Activity,
  arrow: ArrowRight,
  refresh: RefreshCw,
  storage: HardDrive,
  media: Music2,
  server: Server,
  monitor: Monitor,
  phone: Smartphone,
  tv: Tv,
  other: Plus,
  check: Check,
};

function HomeIcon({ name, size = 22 }: { name: HomeIconName; size?: number }) {
  const Icon = HOME_ICONS[name];
  return <Icon size={size} strokeWidth={1.7} aria-hidden="true" />;
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
  { id: 'explorer', icon: 'storage', title: 'Проводник', description: 'Файлы и папки' },
  { id: 'servers', icon: 'server', title: 'Серверы', description: 'Состояние серверов' },
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

export function HomePage({ connection, onNavigate, enabledSections }: Props) {
  const { snapshot, refresh, error: refreshError } = useHomeCloudDeviceRegistry();
  const { snapshot: pool } = useHomeCloudPool();
  const reduced = Boolean(useReducedMotion());
  const visibleShortcuts = SHORTCUTS.filter((shortcut) => enabledSections[shortcut.id as keyof SectionPreferences]);
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
    ? 'Соединение с сервером установлено'
    : connection.phase === 'connecting'
      ? 'Ожидаем ответа сервера'
      : 'Ожидаем восстановления связи с сервером';

  const enter = (delay: number) => ({
    initial: { opacity: 0, y: reduced ? 0 : 13 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: reduced ? 0.1 : 0.38, delay: reduced ? 0 : delay, ease: 'easeOut' as const },
  });

  return (
    <div className="hc-home-page" aria-label="Главная HomeCloud">
      <div className="hc-home-inner">
        <motion.div className="hc-home-section-label" {...enter(0.06)}>
          <div><span className="hc-home-section-index">01</span><h2>Прямо сейчас</h2></div>
          <span className="hc-home-caption">Актуальные показатели</span>
        </motion.div>

        <div className="hc-home-stats">
          <motion.article className="hc-home-stat homecloud-glass" {...enter(0.1)}>
            <div className="hc-home-stat__top"><span className="hc-home-stat__icon"><HomeIcon name="cloud" /></span><span className={`hc-home-state hc-home-state--${connection.phase}`}><i />{connection.phase === 'online' ? 'ONLINE' : connection.phase === 'connecting' ? 'CONNECTING' : 'OFFLINE'}</span></div>
            <span className="hc-home-stat__label">Сервер HomeCloud</span>
            <strong className="hc-home-stat__value hc-home-stat__value--text">{phaseLabel}</strong>
            <span className="hc-home-stat__detail">{phaseDescription}</span>
          </motion.article>

          <motion.article className="hc-home-stat homecloud-glass" {...enter(0.15)}>
            <div className="hc-home-stat__top"><span className="hc-home-stat__icon hc-home-stat__icon--violet"><HomeIcon name="devices" /></span><span className="hc-home-stat__side">{count !== null ? 'LIVE' : '—'}</span></div>
            <span className="hc-home-stat__label">Активные устройства</span>
            <strong className="hc-home-stat__value hc-home-number" aria-live="polite">{count ?? '—'}<span>{count === null ? '' : 'в сети'}</span></strong>
            <span className="hc-home-stat__detail">Устройства, подключённые к системе</span>
          </motion.article>

          <motion.article className="hc-home-stat homecloud-glass" {...enter(0.2)}>
            <div className="hc-home-stat__top"><span className="hc-home-stat__icon hc-home-stat__icon--green"><HomeIcon name="activity" /></span><span className="hc-home-stat__side">ЗАДЕРЖКА</span></div>
            <span className="hc-home-stat__label">Задержка соединения</span>
            <strong className="hc-home-stat__value hc-home-number" aria-live="off">{connected && connection.latency_ms !== null ? connection.latency_ms : '—'}<span>{connected && connection.latency_ms !== null ? 'мс' : ''}</span></strong>
            <span className="hc-home-stat__detail">Время отклика сервера</span>
          </motion.article>
        </div>

        <motion.div className="hc-home-section-label hc-home-section-label--second" {...enter(0.23)}>
          <div><span className="hc-home-section-index">02</span><h2>Обзор системы</h2></div>
          <span className="hc-home-caption">Актуальное состояние</span>
        </motion.div>

        <div className="hc-home-details-grid">
          <motion.section className="hc-home-panel hc-home-device-panel homecloud-glass" {...enter(0.27)} aria-label="Подключённые устройства">
            <div className="hc-home-panel__heading">
              <div><span className="hc-home-overline">УСТРОЙСТВА</span><h3>Подключённые устройства</h3></div>
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
            {enabledSections.devices && <button type="button" className="hc-home-text-link" onClick={() => onNavigate('devices')}>
              {count !== null && count > 4 ? `Все устройства · ${count}` : 'Перейти к устройствам'} <HomeIcon name="arrow" size={17} />
            </button>}
          </motion.section>

          <motion.section className="hc-home-panel hc-home-network-panel homecloud-glass" {...enter(0.3)} aria-label="Мониторинг соединения">
            <div className="hc-home-panel__heading"><div><span className="hc-home-overline">СЕТЬ</span><h3>Качество соединения</h3></div><span className={`hc-home-live-indicator ${connected ? '' : 'hc-home-live-indicator--offline'}`}><i />{connected ? 'LIVE' : 'OFFLINE'}</span></div>
            <div className="hc-home-network-value"><strong>{connected && averagePing !== null ? averagePing : '—'}</strong><span>{connected && averagePing !== null ? 'мс в среднем' : 'Нет измерений'}</span></div>
            <LatencyGraph values={latencySamples} />
            <div className="hc-home-network-footer"><span>История задержки</span><span>{latencySamples.length} из 40 измерений</span></div>
          </motion.section>
        </div>

        {visibleShortcuts.length > 0 && <>
          <motion.div className="hc-home-section-label hc-home-section-label--second" {...enter(0.32)}>
            <div><span className="hc-home-section-index">03</span><h2>Быстрый доступ</h2></div>
            <span className="hc-home-caption">Разделы HomeCloud</span>
          </motion.div>
          <div className="hc-home-shortcuts">
          {visibleShortcuts.map((shortcut, index) => (
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
        </>}
      </div>
    </div>
  );
}
