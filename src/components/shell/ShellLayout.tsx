import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { SidebarNav } from './SidebarNav';
import { navigationItems } from '../../data/navigation';
import { useHomeCloudConnection } from '../../hooks/useHomeCloudConnection';
import { DevicesPage } from '../devices/DevicesPage';
import { HomePage } from '../home/HomePage';
import { ServersPage } from '../servers/ServersPage';
import { SettingsPage } from '../settings/SettingsPage';
import { StoragePage } from '../storage/StoragePage';
import { MediaPage } from '../media/MediaPage';

type DeviceMode = 'desktop' | 'touch' | 'tv';

function detectDeviceMode(): DeviceMode {
  const width = window.innerWidth;
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  if (width >= 1400 && coarse) {
    return 'tv';
  }

  if (coarse) {
    return 'touch';
  }

  return 'desktop';
}

export function ShellLayout() {
  const [activeId, setActiveId] = useState('home');
  const [mediaActivated, setMediaActivated] = useState(false);
  const [deviceMode, setDeviceMode] = useState<DeviceMode>(detectDeviceMode);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [time, setTime] = useState(() => new Date());
  const connection = useHomeCloudConnection();

  // Mount the media player after first visit, then keep it alive across sections.
  // Audio playback and its in-memory playlist must not disappear on sidebar navigation.
  useEffect(() => { if (activeId === 'media') setMediaActivated(true); }, [activeId]);

  useEffect(() => {
    const onResize = () => {
      setDeviceMode(detectDeviceMode());
      setViewportWidth(window.innerWidth);
    };

    window.addEventListener('resize', onResize);

    const timer = window.setInterval(() => {
      setTime(new Date());
    }, 1000);

    return () => {
      window.removeEventListener('resize', onResize);
      window.clearInterval(timer);
    };
  }, []);

  const activeItem = useMemo(
    () => navigationItems.find((item) => item.id === activeId) ?? navigationItems[0],
    [activeId],
  );

  // The sidebar stays on the left on all devices; narrow screens use an icon rail.
  const compactSidebar = deviceMode === 'tv' || viewportWidth <= 900;
  const timeText = time.toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });

  const dateText = time.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  });

  return (
    <div className="homecloud-shell">
      <div className="homecloud-shell__overlay" />

      <div className="homecloud-shell__content">
        <SidebarNav
          items={navigationItems}
          activeId={activeId}
          onChange={setActiveId}
          compact={compactSidebar}
        />

        <main className="homecloud-main">
          <header className="homecloud-glass homecloud-topbar">
            <div className="min-w-0">
              <div className="text-[13px] uppercase tracking-[0.22em] text-cyan-200/70">
                {deviceMode}
              </div>
              <div className="truncate text-[22px] font-semibold text-white">
                {activeItem.label}
              </div>
            </div>

            <div className="hc-shell-topbar__right flex shrink-0 items-center gap-3 sm:gap-6">
              <div
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-2 backdrop-blur-xl"
                title={connection.phase === 'online'
                  ? `HomeCloudBackend подключён · RTT: ${connection.latency_ms ?? '—'} мс`
                  : connection.phase === 'connecting'
                    ? 'Подключение к HomeCloudBackend'
                    : 'Нет соединения с HomeCloudBackend'}
              >
                <span className={[
                  'h-2 w-2 shrink-0 rounded-full',
                  connection.phase === 'online'
                    ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.65)]'
                    : connection.phase === 'connecting'
                      ? 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)]'
                      : 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.45)]',
                ].join(' ')} />
                <span className="text-[13px] font-medium text-white/85" role="status" aria-live="polite">
                  {connection.phase === 'online' ? 'Online' : connection.phase === 'connecting' ? 'Connecting' : 'Offline'}
                </span>
                {connection.phase === 'online' && (
                  <span className="border-l border-white/15 pl-2 text-[12px] tabular-nums text-white/60" aria-label="Задержка соединения" aria-live="off">
                    {connection.latency_ms === null ? '— ms' : `${connection.latency_ms} ms`}
                  </span>
                )}
              </div>

              <div className="hc-shell-topbar__clock text-right">
                <div className="text-[30px] font-semibold leading-none text-white">
                  {timeText}
                </div>
                <div className="mt-1 text-[13px] capitalize text-white/60">
                  {dateText}
                </div>
              </div>
            </div>
          </header>

          <section className="homecloud-workspace">
            {mediaActivated && (
              <div className={activeId === 'media' ? 'h-full' : 'hidden'}>
                <MediaPage />
              </div>
            )}
            {activeId !== 'media' && (
            <motion.div
              key={activeItem.id}
              initial={{ opacity: 0, y: 18, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.28 }}
              className="h-full"
            >
              {activeId === 'home' ? (
                <HomePage connection={connection} now={time} onNavigate={setActiveId} />
              ) : activeId === 'devices' ? (
                <DevicesPage />
              ) : activeId === 'servers' ? (
                <ServersPage />
              ) : activeId === 'storage' ? (
                <StoragePage />
              ) : activeId === 'settings' ? (
                <SettingsPage />
              ) : (
                <div className="homecloud-glass homecloud-card h-full min-h-[320px]">
                  <div className="homecloud-card__eyebrow">Workspace</div>
                  <div className="homecloud-card__title">{activeItem.label}</div>
                  <div className="homecloud-card__text">
                    Это основная рабочая область раздела «{activeItem.label}».
                    Дальше сюда подключим реальные данные HomeCloudBackend.
                  </div>
                </div>
              )}
            </motion.div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
