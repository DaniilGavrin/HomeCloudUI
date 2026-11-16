import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AirVent, Bell, BookOpen, Brush, CalendarDays, Camera, CarFront, CloudSun,
  Droplets, Flame, HeartPulse, KeyRound, Lightbulb, ListTodo, MonitorCog,
  Phone, ShieldCheck, Sprout, Thermometer, Wallet, Workflow, Wind, Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SidebarNav } from './SidebarNav';
import { SectionPlaceholderPage } from './SectionPlaceholderPage';
import { navigationItems } from '../../data/navigation';
import { useSectionPreferences } from '../../hooks/useSectionPreferences';
import { useHomeCloudConnection } from '../../hooks/useHomeCloudConnection';
import { DevicesPage } from '../devices/DevicesPage';
import { HomePage } from '../home/HomePage';
import { ServersPage } from '../servers/ServersPage';
import { SettingsPage } from '../settings/SettingsPage';
import { HcssExplorerPage } from '../explorer/HcssExplorerPage';

const PLACEHOLDER_ICONS: Record<string, LucideIcon> = {
  security: ShieldCheck, cameras: Camera, energy: Zap, heating: Thermometer,
  water: Droplets, gas: Flame, ventilation: Wind, 'air-conditioning': AirVent,
  locks: KeyRound, transport: CarFront, lighting: Lightbulb, irrigation: Sprout,
  cleaning: Brush, communication: Phone, 'fire-system': Flame, calendar: CalendarDays,
  tasks: ListTodo, 'knowledge-base': BookOpen, finances: Wallet, medicine: HeartPulse,
  environment: CloudSun, notifications: Bell, system: MonitorCog, automation: Workflow,
};

export function ShellLayout() {
  const [activeId, setActiveId] = useState('home');
  const [time, setTime] = useState(() => new Date());
  const connection = useHomeCloudConnection();
  const { sections, setEnabled } = useSectionPreferences();
  const visibleNavigationItems = useMemo(
    () => navigationItems.filter((item) => item.id === 'home' || item.id === 'settings' || sections[item.id as keyof typeof sections]),
    [sections],
  );

  useEffect(() => {
    if (activeId !== 'home' && activeId !== 'settings' && !sections[activeId as keyof typeof sections]) setActiveId('home');
  }, [activeId, sections]);

  useEffect(() => {
    const timer = window.setInterval(() => setTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const activeItem = useMemo(
    () => navigationItems.find((item) => item.id === activeId) ?? navigationItems[0],
    [activeId],
  );
  const timeText = time.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const dateText = time.toLocaleDateString('ru-RU', { weekday: 'long', day: '2-digit', month: 'long' });

  return (
    <div className="homecloud-shell">
      <div className="homecloud-shell__overlay" />
      <div className="homecloud-shell__content">
        <SidebarNav items={visibleNavigationItems} activeId={activeId} onChange={setActiveId} />
        <main className="homecloud-main">
          <header className="homecloud-glass homecloud-topbar">
            <div className="min-w-0"><div className="truncate text-[22px] font-semibold text-white">{activeItem.label}</div></div>
            <div className="hc-shell-topbar__right flex shrink-0 items-center gap-3 sm:gap-6">
              <div
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-2 backdrop-blur-xl"
                title={connection.phase === 'online' ? `Сервер подключён · Задержка: ${connection.latency_ms ?? '—'} мс` : connection.phase === 'connecting' ? 'Подключение к серверу' : 'Нет соединения с сервером'}
              >
                <span className={['h-2 w-2 shrink-0 rounded-full', connection.phase === 'online' ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.65)]' : connection.phase === 'connecting' ? 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)]' : 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.45)]'].join(' ')} />
                <span className="text-[13px] font-medium text-white/85" role="status" aria-live="polite">{connection.phase === 'online' ? 'Online' : connection.phase === 'connecting' ? 'Connecting' : 'Offline'}</span>
                {connection.phase === 'online' && <span className="border-l border-white/15 pl-2 text-[12px] tabular-nums text-white/60" aria-label="Задержка соединения" aria-live="off">{connection.latency_ms === null ? '— ms' : `${connection.latency_ms} ms`}</span>}
              </div>
              <div className="hc-shell-topbar__clock text-right">
                <div className="text-[30px] font-semibold leading-none text-white">{timeText}</div>
                <div className="mt-1 text-[13px] capitalize text-white/60">{dateText}</div>
              </div>
            </div>
          </header>
          <section className="homecloud-workspace">
            <motion.div key={activeItem.id} initial={{ opacity: 0, y: 18, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.28 }} className="h-full">
              {activeId === 'home' ? (
                <HomePage connection={connection} now={time} onNavigate={setActiveId} enabledSections={sections} />
              ) : activeId === 'devices' ? (
                <DevicesPage onOpenExplorer={() => setActiveId('explorer')} canOpenExplorer={sections.explorer} />
              ) : activeId === 'explorer' ? (
                <HcssExplorerPage />
              ) : activeId === 'servers' ? (
                <ServersPage />
              ) : activeId === 'settings' ? (
                <SettingsPage sections={sections} onSetSectionEnabled={setEnabled} />
              ) : (
                <SectionPlaceholderPage title={activeItem.label} description={activeItem.description} icon={PLACEHOLDER_ICONS[activeId] ?? Workflow} />
              )}
            </motion.div>
          </section>
        </main>
      </div>
    </div>
  );
}
