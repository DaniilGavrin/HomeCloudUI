import type { ReactNode } from 'react';
import { Activity, Cpu, Gauge, Timer, Zap, Layers, RefreshCw, Network } from 'lucide-react';
import type { CpuCoreTelemetry, CpuFrequencyTelemetry, CpuTelemetry } from '../../hooks/useHomeCloudCpuMonitoring';
import type { CpuTopology, CpuTopologyCore } from '../../hooks/useHomeCloudCpuTopology';
import { CpuGauge } from './CpuGauge';
import { CpuExtendedSection } from './CpuExtendedSection';
import type { CpuExtendedTelemetry } from '../../hooks/useHomeCloudCpuExtendedMonitoring';

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

function formatFrequency(value: number | null): string {
  return value === null || value <= 0 ? '—' : `${(value / 1_000_000).toFixed(2)} GHz`;
}

function CompactMetric({ title, value, icon, className = 'w-[190px] shrink-0' }: { title: string; value: string; icon: ReactNode; className?: string }) {
  return (
    <article className={`flex min-h-[112px] min-w-0 flex-col ${className} justify-center rounded-[18px] border border-sky-200/[0.10] bg-white/[0.025] px-4 py-3`}>
      <div className="flex items-center gap-2 text-white/50">
        <span className="text-cyan-100/80">{icon}</span>
        <span className="truncate text-[11px] font-medium">{title}</span>
      </div>
      <p className="mt-3 break-words text-[clamp(17px,1.7vw,21px)] font-semibold leading-tight tracking-[-0.035em] text-white tabular-nums">
        {value}
      </p>
    </article>
  );
}

function coreLabel(objectId: string): string {
  const match = objectId.match(/(\d+)/);
  return match ? `CPU ${match[1]}` : objectId;
}

function CoreMetricCard({ core }: { core: CpuCoreTelemetry }) {
  const usage = core.totalUsage;
  const progress = usage === null ? 0 : Math.max(0, Math.min(100, usage));

  return (
    <article className="min-w-0 rounded-[16px] border border-sky-200/[0.10] bg-white/[0.025] p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="truncate text-[12px] font-semibold text-white/85">{coreLabel(core.objectId)}</span>
        <span className="shrink-0 text-[13px] font-semibold tabular-nums text-cyan-100">{formatPercent(usage)}</span>
      </div>
      <div className="mt-2 h-[5px] overflow-hidden rounded-full bg-white/[0.08]" role="meter"
        aria-label={`Загрузка ${coreLabel(core.objectId)}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={usage ?? 0}>
        <div className="h-full rounded-full bg-cyan-300 transition-[width] duration-500" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 text-[10px] text-white/45">
        <span>User Time</span>
        <span className="text-right font-medium tabular-nums text-white/75">{formatCpuTime(core.userTimeNs)}</span>
      </div>
    </article>
  );
}

function FrequencyCard({ policy }: { policy: CpuFrequencyTelemetry }) {
  const rows = [
    ['Текущая', formatFrequency(policy.currentKHz)],
    ['Минимальная', formatFrequency(policy.minKHz)],
    ['Максимальная', formatFrequency(policy.maxKHz)],
    ['Базовая', formatFrequency(policy.baseKHz)],
  ] as const;
  return (
    <article className="min-w-0 rounded-[16px] border border-sky-200/[0.10] bg-white/[0.025] p-3.5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-[12px] font-semibold text-white/85">{policy.objectId}</span>
        <span className="rounded-full border border-cyan-200/15 bg-cyan-300/[0.07] px-2 py-1 text-[10px] text-cyan-100/80">
          {policy.governor ?? 'Governor —'}
        </span>
      </div>
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
  ] as const;
  return (
    <article className="min-w-0 rounded-[15px] border border-sky-200/[0.10] bg-white/[0.025] p-3">
      <div className="mb-3 flex items-center">
        <span className="text-[12px] font-semibold text-white/85">{coreLabel(core.objectId)}</span>
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <CompactMetric className="w-full" title="Логических CPU" value={topology.logicalCount?.toString() ?? '—'} icon={<Cpu size={13} />} />
        <CompactMetric className="w-full" title="Физических ядер" value={topology.physicalCoreCount?.toString() ?? '—'} icon={<Layers size={13} />} />
        <CompactMetric className="w-full" title="Packages" value={topology.packageCount?.toString() ?? '—'} icon={<Layers size={13} />} />
        <CompactMetric className="w-full" title="Dies" value={topology.dieCount?.toString() ?? '—'} icon={<Layers size={13} />} />
        <CompactMetric className="w-full" title="NUMA Nodes" value={topology.numaNodeCount?.toString() ?? '—'} icon={<Network size={13} />} />
      </div>
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
          {topology.phase === 'loading' ? 'Получение топологии CPU…' : topology.phase === 'offline' ? 'Сервер недоступен' : 'Данные о топологии пока не получены'}
        </p>
      )}
      {topology.observedAt && <p className="mt-3 px-1 text-[9px] text-white/30">Снимок: {new Date(topology.observedAt).toLocaleString()}</p>}
    </section>
  );
}

export function CpuMonitoringPage({
  telemetry,
  topology,
  onRefreshTopology,
  extendedTelemetry,
}: {
  telemetry: CpuTelemetry;
  topology: CpuTopology;
  onRefreshTopology: () => void;
  extendedTelemetry: CpuExtendedTelemetry;
}) {
  return (
    <section className="homecloud-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1" aria-label="Мониторинг CPU">
      <header className="flex items-center justify-between px-1 pt-1">
        <div className="flex items-center gap-2">
          <Cpu size={16} className="text-cyan-200" aria-hidden="true" />
          <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-white">CPU</h2>
        </div>
      </header>

      {telemetry.error && (
        <div role="alert" className="rounded-[12px] border border-rose-300/20 bg-rose-400/[0.06] px-3 py-2 text-[11px] leading-5 text-rose-100/85">{telemetry.error}</div>
      )}

      <div className="homecloud-glass flex w-full max-w-full flex-wrap items-center justify-start gap-3 rounded-[20px] border border-sky-200/[0.13] p-3.5">
        <div className="flex justify-center sm:justify-start"><CpuGauge value={telemetry.totalUsage} /></div>
        <CompactMetric title="User Time" value={formatCpuTime(telemetry.userTimeNs)} icon={<Timer size={14} />} />
        <CompactMetric title="System Time" value={formatCpuTime(telemetry.systemTimeNs)} icon={<Activity size={14} />} />
        <CompactMetric title="Nice Time" value={formatCpuTime(telemetry.niceTimeNs)} icon={<Gauge size={14} />} />
        <CompactMetric title="Idle Time" value={formatCpuTime(telemetry.idleTimeNs)} icon={<Timer size={14} />} />
        <CompactMetric title="I/O Wait" value={formatCpuTime(telemetry.ioWaitTimeNs)} icon={<Activity size={14} />} />
        <CompactMetric title="IRQ Time" value={formatCpuTime(telemetry.irqTimeNs)} icon={<Zap size={14} />} />
        <CompactMetric title="SoftIRQ Time" value={formatCpuTime(telemetry.softIrqTimeNs)} icon={<Zap size={14} />} />
        <CompactMetric title="Steal Time" value={formatCpuTime(telemetry.stealTimeNs)} icon={<Activity size={14} />} />
        <CompactMetric title="Guest Time" value={formatCpuTime(telemetry.guestTimeNs)} icon={<Layers size={14} />} />
        <CompactMetric title="Guest Nice Time" value={formatCpuTime(telemetry.guestNiceTimeNs)} icon={<Layers size={14} />} />
      </div>

      <section className="homecloud-glass rounded-[20px] border border-sky-200/[0.13] p-3.5" aria-label="Частоты CPU">
        <div className="mb-3 flex items-center gap-2 px-1">
          <Gauge size={14} className="text-cyan-100/80" aria-hidden="true" />
          <h3 className="text-[12px] font-semibold text-white/85">Частоты и режим управления</h3>
          <span className="ml-auto text-[10px] text-white/35">kHz → GHz</span>
        </div>
        {telemetry.frequencyError && (
          <p role="status" className="mb-3 rounded-[10px] border border-amber-200/15 bg-amber-200/[0.04] px-3 py-2 text-[10px] leading-5 text-amber-100/70">{telemetry.frequencyError}</p>
        )}
        {telemetry.frequency.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-2">
            {telemetry.frequency.map(policy => <FrequencyCard key={policy.objectId} policy={policy} />)}
          </div>
        ) : (
          <p className="px-1 py-3 text-[10px] text-white/40">Ожидание данных cpufreq. Если драйвер не предоставляет частоты, показатели останутся недоступны.</p>
        )}
      </section>

      <section className="homecloud-glass rounded-[20px] border border-sky-200/[0.13] p-3.5" aria-label="Мониторинг отдельных ядер CPU">
        <div className="mb-3 flex items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2">
            <Cpu size={14} className="text-cyan-100/80" aria-hidden="true" />
            <h3 className="text-[12px] font-semibold text-white/85">Загрузка логических CPU</h3>
          </div>
          <span className="text-[10px] tabular-nums text-white/40">{telemetry.perCore.length} CPU</span>
        </div>
        {telemetry.perCore.length > 0 ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,190px),1fr))] gap-2">
            {telemetry.perCore.map(core => <CoreMetricCard key={core.objectId} core={core} />)}
          </div>
        ) : (
          <p className="px-1 py-3 text-[11px] text-white/40">Ожидание данных по логическим CPU…</p>
        )}
      </section>

      <TopologySection topology={topology} onRefresh={onRefreshTopology} />

      <CpuExtendedSection telemetry={extendedTelemetry} />

      {telemetry.error && (
        <p className="px-1 text-[10px] text-white/35">
          Последнее успешное измерение: {telemetry.observedAt ? new Date(telemetry.observedAt).toLocaleTimeString() : 'нет данных'}.
        </p>
      )}
    </section>
  );
}
