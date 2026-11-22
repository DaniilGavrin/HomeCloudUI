import type { ReactNode } from 'react';
import { Activity, Cpu, Gauge, Timer, Zap, Layers, RefreshCw, Network, GitFork, Play, Pause } from 'lucide-react';
import type {
  CpuAdditionalMetric,
  CpuCoreTelemetry,
  CpuFrequencyTelemetry,
  CpuMetricQuality,
  CpuTelemetry,
} from '../../hooks/useHomeCloudCpuMonitoring';
import type { CpuTopology, CpuTopologyCore } from '../../hooks/useHomeCloudCpuTopology';
import { CpuGauge } from './CpuGauge';

function formatCpuTime(value: string | null): string {
  if (value === null || value.length === 0) return '—';
  try {
    const ns = BigInt(value);
    const totalMs = ns / 1_000_000n;
    const totalSeconds = totalMs / 1_000n;
    const milliseconds = totalMs % 1_000n;
    const days = totalSeconds / 86_400n;
    const hours = (totalSeconds % 86_400n) / 3_600n;
    const minutes = (totalSeconds % 3_600n) / 60n;
    const seconds = totalSeconds % 60n;
    if (days > 0n) return `${days} д ${hours} ч`;
    if (hours > 0n) return `${hours} ч ${minutes} мин`;
    if (minutes > 0n) return `${minutes} мин ${seconds} с`;
    return `${seconds}.${milliseconds.toString().padStart(3, '0')} с`;
  } catch {
    return '—';
  }
}

function formatPercent(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

function formatCounter(value: string | null): string {
  if (value === null) return '—';
  try {
    return BigInt(value).toLocaleString('ru-RU');
  } catch {
    return '—';
  }
}

function formatFrequency(value: number | null): string {
  return value === null || value <= 0 ? '—' : `${(value / 1_000_000_000).toFixed(2)} GHz`;
}

function statusLabel(status: string): string {
  switch (status) {
    case 'valid': return 'Доступно';
    case 'partial': return 'Частично';
    case 'stale': return 'Устарело';
    case 'unsupported': return 'Не поддерживается';
    case 'unavailable': return 'Недоступно';
    case 'permission_denied': return 'Нет разрешения';
    case 'invalid': return 'Некорректные данные';
    case 'source_error': return 'Ошибка источника';
    case 'timeout': return 'Тайм-аут';
    case 'cancelled': return 'Отменено';
    default: return 'Нет подтверждённых данных';
  }
}

function qualityFor(telemetry: CpuTelemetry, metricId: string, objectId: string | null = null): CpuMetricQuality | undefined {
  return telemetry.quality[`${metricId}|${objectId ?? ''}|`];
}

function CompactMetric({
  title,
  value,
  icon,
  className = 'w-[190px] shrink-0',
  status,
  detail,
}: {
  title: string;
  value: string;
  icon: ReactNode;
  className?: string;
  status?: string;
  detail?: string;
}) {
  return (
    <article className={`flex min-h-[112px] min-w-0 flex-col ${className} justify-center rounded-[18px] border border-sky-200/[0.10] bg-white/[0.025] px-4 py-3`}>
      <div className="flex items-center gap-2 text-white/50">
        <span className="text-cyan-100/80">{icon}</span>
        <span className="truncate text-[11px] font-medium">{title}</span>
      </div>
      <p className="mt-3 break-words text-[clamp(17px,1.7vw,21px)] font-semibold leading-tight tracking-[-0.035em] text-white tabular-nums">
        {value}
      </p>
      {status && status !== 'valid' && (
        <span className="mt-1 text-[9px] text-amber-100/65">{statusLabel(status)}</span>
      )}
      {detail && status !== 'valid' && (
        <span className="mt-0.5 line-clamp-2 text-[8px] leading-3 text-white/30" title={detail}>{detail.replace(/_/g, ' ')}</span>
      )}
    </article>
  );
}

function coreLabel(objectId: string): string {
  const match = objectId.match(/(\d+)/);
  return match ? `Logical CPU ${match[1]}` : objectId;
}

function CoreMetricCard({ core, quality }: { core: CpuCoreTelemetry; quality?: CpuMetricQuality }) {
  const usage = core.totalUsage;
  return (
    <article className="min-w-0 rounded-[16px] border border-sky-200/[0.10] bg-white/[0.025] p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-[12px] font-semibold text-white/85">{coreLabel(core.objectId)}</span>
        {usage !== null && <span className="shrink-0 text-[13px] font-semibold tabular-nums text-cyan-100">{formatPercent(usage)}</span>}
      </div>
      {usage !== null && (
        <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-white/[0.08]" role="meter"
          aria-label={`Загрузка ${coreLabel(core.objectId)}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={usage}>
          <div className="h-full rounded-full bg-cyan-300 transition-[width] duration-500" style={{ width: `${usage}%` }} />
        </div>
      )}
      {quality && quality.status !== 'valid' && (
        <p className="mt-1 text-[9px] text-amber-100/65">
          {statusLabel(quality.status)}{quality.reason ? ` · ${quality.reason.replace(/_/g, ' ')}` : ''}
        </p>
      )}
      {core.frequencyHz !== null && (
        <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-white/45">
          <span>Частота</span>
          <span className="font-medium tabular-nums text-white/75">{formatFrequency(core.frequencyHz)}</span>
        </div>
      )}
      {core.userTimeNs !== null && (
        <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-white/45">
          <span>User Time</span>
          <span className="text-right font-medium tabular-nums text-white/75">{formatCpuTime(core.userTimeNs)}</span>
        </div>
      )}
    </article>
  );
}

function FrequencyCard({ policy, quality }: { policy: CpuFrequencyTelemetry; quality?: CpuMetricQuality }) {
  const rows = [
    ['Текущая', formatFrequency(policy.currentHz)],
    ['Минимальная', formatFrequency(policy.minHz)],
    ['Максимальная', formatFrequency(policy.maxHz)],
    ['Базовая', formatFrequency(policy.baseHz)],
  ].filter(([, value]) => value !== '—');
  return (
    <article className="min-w-0 rounded-[16px] border border-sky-200/[0.10] bg-white/[0.025] p-3.5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-[12px] font-semibold text-white/85">{policy.objectId}</span>
        {policy.governor && <span className="rounded-full border border-cyan-200/15 bg-cyan-300/[0.07] px-2 py-1 text-[10px] text-cyan-100/80">{policy.governor}</span>}
      </div>
      {quality && quality.status !== 'valid' && (
        <p className="mb-2 text-[9px] text-amber-100/65">
          {statusLabel(quality.status)}{quality.reason ? ` · ${quality.reason.replace(/_/g, ' ')}` : ''}
        </p>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <p className="text-[10px] text-white/40">{label}</p>
            <p className="mt-1 text-[14px] font-semibold tabular-nums text-white/85">{value}</p>
          </div>
        ))}
      </div>
    </article>
  );
}

function TopologyCoreCard({ core }: { core: CpuTopologyCore }) {
  const fields = [
    ['Core', core.coreId],
    ['Package', core.packageId],
    ['Die', core.dieId],
    ['NUMA', core.numaNodeId],
  ].filter(([, value]) => value !== null);
  return (
    <article className="min-w-0 rounded-[15px] border border-sky-200/[0.10] bg-white/[0.025] p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-white/85">{coreLabel(core.objectId)}</span>
        {core.online !== null && (
          <span className={`rounded-full px-2 py-0.5 text-[9px] ${core.online ? 'bg-emerald-300/10 text-emerald-100/75' : 'bg-amber-300/10 text-amber-100/75'}`}>
            {core.online ? 'Online' : 'Offline'}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {fields.map(([label, value]) => (
          <div key={label}>
            <p className="text-[9px] text-white/35">{label}</p>
            <p className="mt-0.5 text-[12px] font-medium tabular-nums text-white/75">{value ?? '—'}</p>
          </div>
        ))}
      </div>
      {(core.model || core.vendor) && (
        <p className="mt-3 truncate border-t border-white/[0.06] pt-2 text-[9px] text-white/40" title={[core.vendor, core.model].filter(Boolean).join(' · ')}>
          {[core.vendor, core.model].filter(Boolean).join(' · ')}
        </p>
      )}
      {core.features.length > 0 && (
        <p className="mt-2 line-clamp-2 text-[9px] leading-4 text-white/35" title={core.features.join(', ')}>
          {core.features.slice(0, 8).join(' · ')}{core.features.length > 8 ? ` · +${core.features.length - 8}` : ''}
        </p>
      )}
    </article>
  );
}

function TopologySection({ topology, onRefresh }: { topology: CpuTopology; onRefresh: () => void }) {
  const firstCpu = topology.cores[0];
  const hasTopology = topology.cores.length > 0 || topology.logicalCount !== null
    || topology.onlineCount !== null || topology.offlineCount !== null
    || topology.physicalCoreCount !== null || topology.packageCount !== null
    || topology.dieCount !== null || topology.numaNodeCount !== null
    || topology.architecture !== null;
  if (!hasTopology && topology.phase !== 'loading' && topology.phase !== 'error') return null;
  const summary = [
    ['Логических CPU', topology.logicalCount, <Cpu size={13} />],
    ['Online CPU', topology.onlineCount, <Activity size={13} />],
    ['Offline CPU', topology.offlineCount, <Activity size={13} />],
    ['Физических ядер', topology.physicalCoreCount, <Layers size={13} />],
    ['Packages', topology.packageCount, <Layers size={13} />],
    ['Dies', topology.dieCount, <Layers size={13} />],
    ['NUMA Nodes', topology.numaNodeCount, <Network size={13} />],
  ] as const;
  const available = summary.filter(([, value]) => value !== null);
  return (
    <section className="homecloud-glass rounded-[20px] border border-sky-200/[0.13] p-3.5" aria-label="Топология CPU">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex items-center gap-2">
          <Network size={14} className="text-cyan-100/80" aria-hidden="true" />
          <h3 className="text-[12px] font-semibold text-white/85">Топология процессора</h3>
          {topology.architecture && <span className="text-[10px] text-white/35">{topology.architecture}</span>}
        </div>
        <button type="button" onClick={onRefresh}
          className="inline-flex min-h-[30px] items-center gap-1.5 rounded-[9px] border border-white/[0.08] bg-white/[0.025] px-2.5 text-[10px] text-white/55 transition-colors hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/50">
          <RefreshCw size={11} aria-hidden="true" /> Обновить
        </button>
      </div>
      {topology.phase === 'error' && (
        <p role="alert" className="mb-3 rounded-[10px] border border-rose-300/20 bg-rose-400/[0.06] px-3 py-2 text-[10px] leading-5 text-rose-100/80">{topology.error}</p>
      )}
      {available.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {available.map(([title, value, icon]) => (
            <CompactMetric key={title} className="w-full" title={title} value={String(value)} icon={icon} />
          ))}
        </div>
      )}
      {firstCpu?.model && (
        <p className="mt-3 px-1 text-[10px] text-white/45">
          {firstCpu.vendor ? `${firstCpu.vendor} · ` : ''}{firstCpu.model}
          {firstCpu.family ? ` · Family ${firstCpu.family}` : ''}
          {firstCpu.modelId ? ` · Model ${firstCpu.modelId}` : ''}
          {firstCpu.stepping !== null ? ` · Stepping ${firstCpu.stepping}` : ''}
        </p>
      )}
      {topology.cores.length > 0 ? (
        <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(100%,175px),1fr))] gap-2">
          {topology.cores.map(core => <TopologyCoreCard key={core.objectId} core={core} />)}
        </div>
      ) : (
        <p className="px-1 py-3 text-[10px] text-white/40">
          {topology.phase === 'loading' ? 'Получение топологии CPU…' : topology.phase === 'offline' ? 'Сервер недоступен' : topology.phase === 'error' ? 'Топология не получена' : 'Топологические сведения недоступны'}
        </p>
      )}
      {topology.observedAt && <p className="mt-3 px-1 text-[9px] text-white/30">Снимок: {new Date(topology.observedAt).toLocaleString()}</p>}
    </section>
  );
}

function metricValue(metric: CpuAdditionalMetric): string {
  if (metric.value === null || metric.value === undefined) return '—';
  if (metric.unit === 'ns') return formatCpuTime(String(metric.value));
  if (metric.unit === 'count') return formatCounter(String(metric.value));
  if (metric.unit === 'percent') {
    const value = finiteNumber(metric.value);
    return value === null ? '—' : `${value.toFixed(2)}%`;
  }
  if (typeof metric.value === 'boolean') return metric.value ? 'Да' : 'Нет';
  return metric.unit ? `${String(metric.value)} ${metric.unit}` : String(metric.value);
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim().length > 0
      ? Number(value)
      : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function metricTitle(metricId: string): string {
  return metricId.startsWith('system.cpu.')
    ? metricId.slice('system.cpu.'.length).split('.').join(' · ')
    : metricId;
}

function MetricFamilySection({
  title,
  metrics,
}: {
  title: string;
  metrics: CpuAdditionalMetric[];
}) {
  if (metrics.length === 0) return null;
  const available = metrics.filter(metric => metric.value !== null && metric.value !== undefined);
  if (available.length === 0) return null;
  return (
    <section className="homecloud-glass rounded-[20px] border border-sky-200/[0.13] p-3.5">
      <div className="mb-3 flex items-center gap-2 px-1">
        <Activity size={14} className="text-cyan-100/80" aria-hidden="true" />
        <h3 className="text-[12px] font-semibold text-white/85">{title}</h3>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,190px),1fr))] gap-2">
        {available.map(metric => (
          <CompactMetric
            key={`${metric.metricId}|${metric.objectId ?? ''}|${metric.windowMS ?? ''}`}
            className="w-full"
            title={`${metricTitle(metric.metricId)}${metric.objectId ? ` · ${metric.objectId}` : ''}${metric.windowMS ? ` · ${metric.windowMS / 1000}s` : ''}`}
            value={metricValue(metric)}
            icon={<Activity size={13} />}
            status={metric.status}
          />
        ))}
      </div>
    </section>
  );
}

export function CpuMonitoringPage({
  telemetry,
  topology,
  onRefreshTopology,
  perfEnabled,
  onTogglePerf,
  perfControlError,
}: {
  telemetry: CpuTelemetry;
  topology: CpuTopology;
  onRefreshTopology: () => void;
  perfEnabled: boolean;
  onTogglePerf: (enabled: boolean) => void;
  perfControlError: string | null;
}) {
  const timeMetrics = [
    ['system.cpu.user', 'User Time', telemetry.userTimeNs, <Timer size={14} />],
    ['system.cpu.system', 'System Time', telemetry.systemTimeNs, <Activity size={14} />],
    ['system.cpu.nice', 'Nice Time', telemetry.niceTimeNs, <Gauge size={14} />],
    ['system.cpu.idle', 'Idle Time', telemetry.idleTimeNs, <Timer size={14} />],
    ['system.cpu.iowait', 'I/O Wait', telemetry.ioWaitTimeNs, <Activity size={14} />],
    ['system.cpu.irq', 'IRQ Time', telemetry.irqTimeNs, <Zap size={14} />],
    ['system.cpu.softirq', 'SoftIRQ Time', telemetry.softIrqTimeNs, <Zap size={14} />],
    ['system.cpu.steal', 'Steal Time', telemetry.stealTimeNs, <Activity size={14} />],
    ['system.cpu.guest', 'Guest Time', telemetry.guestTimeNs, <Layers size={14} />],
    ['system.cpu.guest_nice', 'Guest Nice Time', telemetry.guestNiceTimeNs, <Layers size={14} />],
  ] as const;
  const availableTimeMetrics = timeMetrics.filter(([, , value]) => value !== null);
  const extra = telemetry.additionalMetrics;
  const cstates = extra.filter(metric => metric.metricId === 'system.cpu.idle.cstate' || metric.metricId.startsWith('system.cpu.idle.cstate.'));
  const throttling = extra.filter(metric => metric.metricId === 'system.cpu.throttling' || metric.metricId.startsWith('system.cpu.throttling.'));
  const pressure = extra.filter(metric => metric.metricId.startsWith('system.cpu.pressure.'));
  const perfMetrics = extra.filter(metric => metric.metricId.startsWith('system.cpu.perf.'));
  const perfStatus = perfMetrics.find(metric => metric.status !== 'valid' && metric.status !== 'partial');
  const scheduler = extra.filter(metric => [
    'system.cpu.runqueue',
    'system.cpu.interrupts',
    'system.cpu.context_switches',
  ].includes(metric.metricId));
  const cpuTemperature = extra.filter(metric => metric.metricId === 'system.cpu.temperature');

  const frequencyQuality = Object.values(telemetry.quality).filter(item =>
    item.metricId === 'system.cpu.frequency' || item.metricId.startsWith('system.cpu.frequency.') || item.metricId === 'system.cpu.core.frequency',
  );
  const visibleCores = telemetry.perCore.filter(core =>
    core.totalUsage !== null || core.userTimeNs !== null || core.frequencyHz !== null,
  );
  const topologyByCPU = new Map<string, CpuTopologyCore>(
    topology.cores.map(core => [core.objectId, core] as const),
  );
  const coreGroups = new Map<string, { title: string | null; cores: CpuCoreTelemetry[] }>();
  for (const core of visibleCores) {
    const topologyCore = topologyByCPU.get(core.objectId);
    const groupKey = topologyCore?.coreId !== null && topologyCore?.coreId !== undefined
      ? `package:${topologyCore.packageId ?? 'unknown'}:core:${topologyCore.coreId}`
      : `logical:${core.objectId}`;
    const title = topologyCore?.coreId !== null && topologyCore?.coreId !== undefined
      ? `Package ${topologyCore.packageId ?? '—'} · Core ${topologyCore.coreId}`
      : null;
    const group = coreGroups.get(groupKey) ?? { title, cores: [] };
    group.cores.push(core);
    coreGroups.set(groupKey, group);
  }

  return (
    <section className="homecloud-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1" aria-label="Мониторинг CPU">
      <header className="flex items-center justify-between px-1 pt-1">
        <div className="flex items-center gap-2">
          <Cpu size={16} className="text-cyan-200" aria-hidden="true" />
          <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-white">CPU</h2>
        </div>
        <span className="text-[10px] text-white/35">
          {telemetry.phase === 'streaming' ? 'Поток активен' : telemetry.phase === 'connecting' ? 'Подключение…' : telemetry.phase === 'offline' ? 'Сервер недоступен' : 'Ошибка мониторинга'}
        </span>
      </header>

      {telemetry.error && (
        <div role="alert" className="rounded-[12px] border border-rose-300/20 bg-rose-400/[0.06] px-3 py-2 text-[11px] leading-5 text-rose-100/85">{telemetry.error}</div>
      )}

      {(telemetry.totalUsage !== null || availableTimeMetrics.length > 0) && (
      <div className="homecloud-glass flex w-full max-w-full flex-wrap items-center justify-start gap-3 rounded-[20px] border border-sky-200/[0.13] p-3.5">
        {telemetry.totalUsage !== null && <div className="flex justify-center sm:justify-start"><CpuGauge value={telemetry.totalUsage} statusLabel={(() => {
          const quality = qualityFor(telemetry, 'system.cpu.totalusage');
          return quality && quality.status !== 'valid'
            ? `${statusLabel(quality.status)}${quality.reason ? ` · ${quality.reason.replace(/_/g, ' ')}` : ''}`
            : undefined;
        })()} /></div>}
        {availableTimeMetrics.map(([metricId, title, value, icon]) => {
          const quality = qualityFor(telemetry, metricId);
          return (
            <CompactMetric
              key={metricId}
              title={title}
              value={formatCpuTime(value)}
              icon={icon}
              status={quality?.status}
              detail={quality?.reason ?? quality?.errorCode ?? undefined}
            />
          );
        })}
        {availableTimeMetrics.length > 0 && <p className="w-full px-1 text-[9px] text-white/30">Накопительное CPU time с момента запуска системы</p>}
      </div>
      )}

      {(telemetry.forks !== null || telemetry.processesRunning !== null || telemetry.processesBlocked !== null) && (
        <section className="homecloud-glass rounded-[20px] border border-sky-200/[0.13] p-3.5" aria-label="Процессы и планировщик CPU">
          <div className="mb-3 flex items-center gap-2 px-1">
            <GitFork size={14} className="text-cyan-100/80" aria-hidden="true" />
            <h3 className="text-[12px] font-semibold text-white/85">Процессы и планировщик</h3>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,190px),1fr))] gap-2">
            {telemetry.forks !== null && <CompactMetric className="w-full" title="Создано задач с загрузки" value={formatCounter(telemetry.forks)} icon={<GitFork size={13} />} status={qualityFor(telemetry, 'system.cpu.forks')?.status} detail={qualityFor(telemetry, 'system.cpu.forks')?.reason ?? undefined} />}
            {telemetry.processesRunning !== null && <CompactMetric className="w-full" title="Выполняются / готовы" value={formatCounter(telemetry.processesRunning)} icon={<Play size={13} />} status={qualityFor(telemetry, 'system.cpu.processes.running')?.status} detail={qualityFor(telemetry, 'system.cpu.processes.running')?.reason ?? undefined} />}
            {telemetry.processesBlocked !== null && <CompactMetric className="w-full" title="Заблокированы" value={formatCounter(telemetry.processesBlocked)} icon={<Pause size={13} />} status={qualityFor(telemetry, 'system.cpu.processes.blocked')?.status} detail={qualityFor(telemetry, 'system.cpu.processes.blocked')?.reason ?? undefined} />}
          </div>
        </section>
      )}

      {telemetry.frequency.length > 0 ? (
        <section className="homecloud-glass rounded-[20px] border border-sky-200/[0.13] p-3.5" aria-label="Частоты CPU">
          <div className="mb-3 flex items-center gap-2 px-1">
            <Gauge size={14} className="text-cyan-100/80" aria-hidden="true" />
            <h3 className="text-[12px] font-semibold text-white/85">Частоты и режим управления</h3>
            <span className="ml-auto text-[10px] text-white/35">Hz → GHz</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-2">
            {telemetry.frequency.map(policy => {
              const quality = frequencyQuality.find(item => item.objectId === policy.objectId && item.status !== 'valid');
              return <FrequencyCard key={policy.objectId} policy={policy} quality={quality} />;
            })}
          </div>
        </section>
      ) : null}

      {telemetry.perCore.some(core => core.totalUsage !== null || core.userTimeNs !== null || core.frequencyHz !== null) && (
        <section className="homecloud-glass rounded-[20px] border border-sky-200/[0.13] p-3.5" aria-label="Мониторинг отдельных ядер CPU">
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <div className="flex items-center gap-2">
              <Cpu size={14} className="text-cyan-100/80" aria-hidden="true" />
              <h3 className="text-[12px] font-semibold text-white/85">Загрузка логических CPU</h3>
            </div>
            <span className="text-[10px] tabular-nums text-white/40">{telemetry.perCore.length} CPU</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))] gap-2">
            {[...coreGroups.entries()].map(([groupKey, group]) => {
              const cards = group.cores.map(core => {
                const quality = qualityFor(telemetry, 'system.cpu.core.totalusage', core.objectId);
                return <CoreMetricCard key={core.objectId} core={core} quality={quality} />;
              });
              return group.title ? (
                <section key={groupKey} className="min-w-0 rounded-[16px] border border-cyan-200/[0.10] bg-cyan-300/[0.025] p-2.5">
                  <h4 className="mb-2 px-1 text-[10px] font-semibold text-cyan-100/70">{group.title}</h4>
                  <div className="grid grid-cols-1 gap-2">{cards}</div>
                </section>
              ) : <div key={groupKey}>{cards}</div>;
            })}
          </div>
        </section>
      )}

      <MetricFamilySection title="C-states и энергосбережение" metrics={cstates} />
      <MetricFamilySection title="Throttling и ограничения CPU" metrics={throttling} />
      <MetricFamilySection title="Scheduler и системные счётчики" metrics={scheduler} />
      <MetricFamilySection title="Температура CPU" metrics={cpuTemperature} />
      <MetricFamilySection title="CPU Pressure" metrics={pressure} />

      <section className="homecloud-glass rounded-[20px] border border-sky-200/[0.13] p-3.5" aria-label="Аппаратные счётчики CPU">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-cyan-100/80" aria-hidden="true" />
            <h3 className="text-[12px] font-semibold text-white/85">Аппаратные счётчики PMU</h3>
          </div>
          <button
            type="button"
            aria-pressed={perfEnabled}
            disabled={!perfEnabled && telemetry.phase !== 'streaming'}
            onClick={() => onTogglePerf(!perfEnabled)}
            className={`min-h-[30px] rounded-[9px] border px-3 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/50 disabled:cursor-not-allowed disabled:opacity-40 ${perfEnabled ? 'border-amber-200/20 bg-amber-200/[0.07] text-amber-100/80 hover:bg-amber-200/[0.12]' : 'border-cyan-200/20 bg-cyan-300/[0.07] text-cyan-100/85 hover:bg-cyan-300/[0.12]'}`}
          >
            {perfEnabled ? 'Отключить PMU' : 'Включить PMU'}
          </button>
        </div>
        {perfControlError && <p role="alert" className="mb-2 text-[10px] text-rose-100/80">{perfControlError}</p>}
        {perfEnabled && telemetry.perfError && <p role="alert" className="mb-2 text-[10px] text-rose-100/80">{telemetry.perfError}</p>}
        {perfEnabled ? (
          perfMetrics.some(metric => metric.value !== null && metric.value !== undefined) ? (
            <MetricFamilySection title="PMU metrics" metrics={perfMetrics} />
          ) : (
            <p className="px-1 py-2 text-[10px] text-white/40">
              {perfStatus
                ? `${statusLabel(perfStatus.status)}${perfStatus.reason ? ` · ${perfStatus.reason.replace(/_/g, ' ')}` : ''}`
                : 'Ожидание аппаратных счётчиков. Доступность зависит от CPU, ядра и разрешений perf_event.'}
            </p>
          )
        ) : (
          <p className="px-1 py-2 text-[10px] text-white/40">
            PMU выключен. Счётчики открываются только после явного включения.
          </p>
        )}
      </section>

      <section className="rounded-[14px] border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
        <p className="text-[10px] leading-5 text-white/40">
          Исторические точки для CPU пока не предоставляются узлом. Здесь отображаются текущие измерения и накопительные счётчики; графики появятся после подключения хранения истории Monitoring.
        </p>
      </section>

      <TopologySection topology={topology} onRefresh={onRefreshTopology} />

      {telemetry.observedAt && (
        <p className="px-1 text-[9px] text-white/30">
          Последнее обновление: {new Date(telemetry.observedAt).toLocaleString()}
        </p>
      )}
    </section>
  );
}
