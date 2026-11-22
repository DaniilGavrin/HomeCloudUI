import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft, ChevronLeft, ChevronRight, Server } from 'lucide-react';
import { useHomeCloudPool } from '../../hooks/useHomeCloudPool';
import { CpuMonitoringPage } from './CpuMonitoringPage';
import { useHomeCloudCpuMonitoring } from '../../hooks/useHomeCloudCpuMonitoring';
import { useHomeCloudCpuPanel } from '../../hooks/useHomeCloudCpuPanel';
import { useHomeCloudCpuTopology } from '../../hooks/useHomeCloudCpuTopology';
import { CpuGauge } from './CpuGauge';

const MONITORING_SECTIONS = [
  { id: 'overview', label: 'Главная' },
  { id: 'cpu', label: 'CPU' },
  { id: 'ram', label: 'RAM' },
  { id: 'gpu', label: 'GPU' },
  { id: 'disks', label: 'Диски и файловые системы' },
  { id: 'network', label: 'Сеть' },
  { id: 'processes', label: 'Процессы' },
  { id: 'services', label: 'Службы HomeCloud' },
  { id: 'load', label: 'Нагрузка и PSI' },
  { id: 'sensors', label: 'Датчики' },
  { id: 'system', label: 'Системная информация' },
  { id: 'events', label: 'События' },
  { id: 'history', label: 'История' },
  { id: 'nodes', label: 'Сравнение узлов' },
] as const;

type MonitoringSectionId = (typeof MONITORING_SECTIONS)[number]['id'];

function addressLabel(ipv4: string | null, ipv6: string | null): string {
  const addresses = [ipv4, ipv6].filter((value): value is string => Boolean(value));
  return addresses.length ? addresses.join(' · ') : 'Адрес не задан';
}

function ServerStatus({ phase }: { phase: string }) {
  const online = phase === 'ready';
  const pending = phase === 'connecting';

  return (
    <span className={[
      'inline-flex items-center gap-[7px] rounded-full border px-[9px] py-[5px] text-[10px] font-semibold',
      online
        ? 'border-emerald-300/20 bg-emerald-400/[0.06] text-emerald-100'
        : pending
          ? 'border-amber-300/20 bg-amber-400/[0.065] text-amber-100'
          : 'border-rose-300/20 bg-rose-400/[0.065] text-rose-100',
    ].join(' ')}>
      <i className={[
        'block h-[6px] w-[6px] rounded-full',
        online
          ? 'bg-emerald-300 shadow-[0_0_9px_rgba(101,238,185,0.5)]'
          : pending
            ? 'bg-amber-300 shadow-[0_0_9px_rgba(245,190,103,0.45)]'
            : 'bg-rose-300 shadow-[0_0_9px_rgba(255,117,140,0.45)]',
      ].join(' ')} aria-hidden="true" />
      {online ? 'Online' : pending ? 'Connecting' : 'Offline'}
    </span>
  );
}

function MonitoringSectionPage({ section, cpuTelemetry, cpuTopology, refreshCpuTopology, cpuPerfEnabled, onToggleCpuPerf, cpuPerfControlError }: {
  section: MonitoringSectionId;
  cpuTelemetry: ReturnType<typeof useHomeCloudCpuMonitoring>;
  cpuTopology: ReturnType<typeof useHomeCloudCpuTopology>['topology'];
  refreshCpuTopology: () => void;
  cpuPerfEnabled: boolean;
  onToggleCpuPerf: (enabled: boolean) => void;
  cpuPerfControlError: string | null;
}) {
  const definition = MONITORING_SECTIONS.find(item => item.id === section)!;

  if (section === 'cpu') return (
    <CpuMonitoringPage
      telemetry={cpuTelemetry}
      topology={cpuTopology}
      onRefreshTopology={refreshCpuTopology}
      perfEnabled={cpuPerfEnabled}
      onTogglePerf={onToggleCpuPerf}
      perfControlError={cpuPerfControlError}
    />
  );

  return (
    <section
      className="homecloud-glass min-h-0 flex-1 rounded-[22px] border border-sky-200/[0.13]"
      aria-label={`Раздел мониторинга: ${definition.label}`}
      data-monitoring-section={section}
    />
  );
}

export function MonitoringPage() {
  const { snapshot, error } = useHomeCloudPool();
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<MonitoringSectionId>('overview');
  const [cpuPerfEnabled, setCpuPerfEnabled] = useState(false);
  const [cpuPerfControlError, setCpuPerfControlError] = useState<string | null>(null);
  const sectionScroller = useRef<HTMLDivElement>(null);
  const lastTopologySyncKey = useRef<string | null>(null);
  const reduced = Boolean(useReducedMotion());
  const selectedServer = snapshot.servers.find(server => server.id === selectedServerId) ?? null;
  const serverId = selectedServer?.id ?? null;
  const cpuPanelTelemetry = useHomeCloudCpuPanel(serverId, selectedServer?.phase ?? 'offline');
  const cpuTelemetry = useHomeCloudCpuMonitoring(serverId, selectedServer?.phase ?? 'offline', activeSection, cpuPanelTelemetry.readyFor);
  const cpuTopologyState = useHomeCloudCpuTopology(serverId, activeSection === 'cpu', selectedServer?.phase ?? 'offline');

  const liveCoreIDs = cpuTelemetry.perCore.map(core => core.objectId).sort().join('|');
  const topologyCoreIDs = cpuTopologyState.topology.cores
    .filter(core => core.online !== false)
    .map(core => core.objectId)
    .sort()
    .join('|');

  useEffect(() => {
    lastTopologySyncKey.current = null;
  }, [serverId, activeSection]);

  useEffect(() => {
    if (!serverId || activeSection !== 'cpu' || cpuTelemetry.phase !== 'streaming'
      || cpuTopologyState.topology.phase !== 'ready' || !liveCoreIDs) return;
    const syncKey = `${serverId}:${liveCoreIDs}`;
    if (topologyCoreIDs !== liveCoreIDs && lastTopologySyncKey.current !== syncKey) {
      lastTopologySyncKey.current = syncKey;
      void cpuTopologyState.refresh();
    }
  }, [
    serverId,
    activeSection,
    cpuTelemetry.phase,
    liveCoreIDs,
    topologyCoreIDs,
    cpuTopologyState.topology.phase,
    cpuTopologyState.refresh,
  ]);

  useEffect(() => {
    if (!serverId || activeSection !== 'cpu') {
      setCpuPerfEnabled(false);
      setCpuPerfControlError(null);
    }
  }, [serverId, activeSection]);

  const toggleCpuPerf = async (enabled: boolean) => {
    if (!serverId) return;
    setCpuPerfControlError(null);
    try {
      await invoke('homecloud_monitoring_set_perf_enabled', { serverId, enabled });
      setCpuPerfEnabled(enabled);
    } catch (error) {
      setCpuPerfControlError(String(error));
    }
  };

  const changeSection = (section: MonitoringSectionId) => {
    setActiveSection(section);
  };

  const scrollSections = (direction: -1 | 1) => {
    const scroller = sectionScroller.current;
    if (!scroller) return;

    scroller.scrollBy({
      left: direction * Math.max(220, scroller.clientWidth * 0.65),
      behavior: reduced ? 'auto' : 'smooth',
    });
  };

  const openServer = (serverId: string) => {
    setActiveSection('overview');
    setSelectedServerId(serverId);
  };

  const closeServer = () => {
    setSelectedServerId(null);
  };

  return (
    <section
      className="homecloud-glass flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] p-[clamp(16px,1.65vw,23px)]"
      aria-label="Мониторинг серверов"
    >
      <AnimatePresence mode="wait" initial={false}>
        {selectedServer ? (
          <motion.div
            key={`server-detail-${selectedServer.id}`}
            className="flex min-h-0 flex-1 flex-col gap-[12px]"
            initial={{ opacity: 0, x: reduced ? 0 : 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: reduced ? 0 : -12 }}
            transition={{ duration: reduced ? 0.08 : 0.24 }}
          >
            <header className="flex min-h-[36px] items-center justify-between gap-3">
              <button
                type="button"
                onClick={closeServer}
                className="inline-flex min-h-[36px] items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-3 text-[12px] font-medium text-white/75 transition-colors hover:border-sky-200/25 hover:bg-white/[0.075] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/50"
              >
                <ArrowLeft size={15} strokeWidth={1.8} aria-hidden="true" />
                К серверам
              </button>
              <ServerStatus phase={selectedServer.phase} />
            </header>

            <div
              className="homecloud-glass flex min-h-[150px] w-full flex-none items-center gap-5 rounded-[22px] border border-sky-200/[0.13] px-5 py-3"
              aria-label="Постоянная панель мониторинга сервера"
            >
              {cpuPanelTelemetry.totalUsage !== null && (
                <>
                  <div className="flex shrink-0 items-center gap-4">
                    <CpuGauge value={cpuPanelTelemetry.totalUsage} />
                    <div className="flex flex-col gap-1">
                      <span className="text-[12px] font-semibold text-white/85">Загрузка CPU</span>
                      <span className="text-[11px] tabular-nums text-white/45">
                        {cpuPanelTelemetry.phase === 'streaming' ? 'Обновление каждую секунду' : cpuPanelTelemetry.phase === 'error' ? 'Ошибка получения данных' : 'Ожидание телеметрии'}
                      </span>
                    </div>
                  </div>
                  <div className="h-[82px] w-px shrink-0 bg-sky-100/[0.10]" aria-hidden="true" />
                </>
              )}
            </div>

            <nav
              className="homecloud-glass flex min-h-[54px] w-full flex-none items-center gap-2 overflow-hidden rounded-[18px] border border-sky-200/[0.13] px-2 py-[7px]"
              aria-label="Разделы мониторинга"
            >
              <button
                type="button"
                onClick={() => scrollSections(-1)}
                className="grid h-[34px] w-[30px] flex-none place-items-center rounded-[10px] text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/50"
                aria-label="Прокрутить разделы влево"
              >
                <ChevronLeft size={18} aria-hidden="true" />
              </button>

              <div
                ref={sectionScroller}
                className="flex min-w-0 flex-1 items-center gap-[6px] overflow-x-auto overscroll-x-contain scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                style={{ scrollbarWidth: 'none' }}
              >
                {MONITORING_SECTIONS.map(section => {
                  const active = activeSection === section.id;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => changeSection(section.id)}
                      aria-current={active ? 'page' : undefined}
                      className={[
                        'min-h-[34px] flex-none whitespace-nowrap rounded-[10px] border px-[14px] text-[12px] font-medium transition-[color,background,border-color] duration-150',
                        active
                          ? 'border-sky-200/30 bg-sky-300/[0.16] text-white shadow-[inset_0_1px_0_rgba(255,255,255,.08)]'
                          : 'border-transparent bg-white/[0.025] text-white/60 hover:border-white/10 hover:bg-white/[0.065] hover:text-white/90',
                      ].join(' ')}
                    >
                      {section.label}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => scrollSections(1)}
                className="grid h-[34px] w-[30px] flex-none place-items-center rounded-[10px] text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/50"
                aria-label="Прокрутить разделы вправо"
              >
                <ChevronRight size={18} aria-hidden="true" />
              </button>
            </nav>

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={activeSection}
                className="flex min-h-0 flex-1"
                initial={{ opacity: 0, x: reduced ? 0 : 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: reduced ? 0 : -8 }}
                transition={{ duration: reduced ? 0.06 : 0.16 }}
              >
                <MonitoringSectionPage
                  section={activeSection}
                  cpuTelemetry={cpuTelemetry}
                  cpuTopology={cpuTopologyState.topology}
                  refreshCpuTopology={cpuTopologyState.refresh}
                  cpuPerfEnabled={cpuPerfEnabled}
                  onToggleCpuPerf={toggleCpuPerf}
                  cpuPerfControlError={cpuPerfControlError}
                />
              </motion.div>
            </AnimatePresence>
          </motion.div>
        ) : (
          <motion.div
            key="server-list"
            className="flex min-h-0 flex-1 flex-col"
            initial={{ opacity: 0, x: reduced ? 0 : -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: reduced ? 0 : -12 }}
            transition={{ duration: reduced ? 0.08 : 0.24 }}
          >
            <div className="homecloud-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pr-[3px]">
              <header className="mb-[17px] flex flex-col items-start gap-2">
                <p className="text-xs leading-[1.5] text-white/60">
                  Мониторинг узлов и доступности серверов HomeCloud.
                </p>
              </header>

              {error && (
                <p className="mb-4 rounded-[14px] border border-rose-300/20 bg-rose-400/[0.07] px-4 py-3 text-[13px] leading-6 text-rose-100" role="alert">
                  Не удалось получить список серверов: {error}
                </p>
              )}

              {snapshot.servers.length === 0 ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center px-6 py-12 text-center">
                  <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-cyan-200/15 bg-cyan-300/[0.07] text-cyan-100">
                    <Server size={27} strokeWidth={1.6} aria-hidden="true" />
                  </span>
                  <h2 className="text-base font-semibold text-white">Серверы не добавлены</h2>
                  <p className="mt-2 max-w-md text-sm leading-6 text-white/50">
                    Добавленные серверы HomeCloud появятся здесь автоматически.
                  </p>
                </div>
              ) : (
                <div className="grid flex-none grid-cols-[repeat(auto-fill,minmax(min(100%,270px),1fr))] content-start gap-[15px]">
                  {snapshot.servers.map((server, index) => (
                    <motion.button
                      key={server.id}
                      type="button"
                      onClick={() => openServer(server.id)}
                      className="flex min-h-[150px] min-w-0 flex-col rounded-[22px] border border-sky-200/[0.14] bg-[linear-gradient(145deg,rgba(125,189,255,.043),rgba(110,123,222,.025)),rgba(21,42,74,.13)] p-[18px] text-left shadow-[0_12px_32px_rgba(0,0,0,.10),inset_0_1px_0_rgba(255,255,255,.035)] transition-[border-color,background] duration-200 hover:border-sky-200/30 hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/50"
                      initial={reduced ? false : { opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      whileHover={reduced ? undefined : { y: -2 }}
                      whileTap={reduced ? undefined : { scale: 0.99 }}
                      transition={{ duration: reduced ? 0.08 : 0.2, delay: reduced ? 0 : Math.min(index * 0.035, 0.18) }}
                      aria-label={`Открыть мониторинг сервера ${server.name}`}
                    >
                      <span className="flex min-w-0 items-start justify-between gap-3">
                        <span className="grid h-[49px] w-[49px] shrink-0 place-items-center rounded-[14px] border border-cyan-200/20 bg-[linear-gradient(140deg,rgba(35,171,220,.14),rgba(95,73,221,.07))] text-cyan-100">
                          <Server size={25} strokeWidth={1.6} aria-hidden="true" />
                        </span>
                        <ServerStatus phase={server.phase} />
                      </span>

                      <span className="mt-[17px] min-w-0">
                        <span className="block overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-semibold leading-[1.3] text-[#f7faff]" title={server.name}>
                          {server.name}
                        </span>
                        <span className="mt-[5px] block break-all text-[11px] leading-[1.5] text-white/50">
                          {addressLabel(server.ipv4, server.ipv6)}
                        </span>
                      </span>
                    </motion.button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
