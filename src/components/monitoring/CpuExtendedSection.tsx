import type { ReactNode } from 'react';
import { Activity, Clock3, Gauge, RefreshCw, Zap } from 'lucide-react';
import type { CpuExtendedTelemetry, CpuCStateTelemetry, CpuThrottleTelemetry } from '../../hooks/useHomeCloudCpuExtendedMonitoring';

function formatDuration(nsText: string): string {
  try {
    const ns = BigInt(nsText);
    const seconds = ns / 1_000_000_000n;
    const days = seconds / 86_400n;
    const hours = (seconds % 86_400n) / 3_600n;
    const minutes = (seconds % 3_600n) / 60n;
    const rest = seconds % 60n;
    if (days > 0n) return `${days} д ${hours} ч`;
    if (hours > 0n) return `${hours} ч ${minutes} мин`;
    if (minutes > 0n) return `${minutes} мин ${rest} с`;
    return `${rest} с`;
  } catch {
    return '—';
  }
}

function formatCount(value: string): string {
  try {
    return BigInt(value).toLocaleString('ru-RU');
  } catch {
    return '—';
  }
}

function MetricError({ children }: { children: string }) {
  return <p role="status" className="rounded-[10px] border border-amber-200/15 bg-amber-200/[0.04] px-3 py-2 text-[10px] leading-5 text-amber-100/70">{children}</p>;
}

function CounterCard({ title, value, icon }: { title: string; value: string | null; icon: ReactNode }) {
  return (
    <article className="min-w-0 rounded-[15px] border border-sky-200/[0.10] bg-white/[0.025] p-3.5">
      <div className="flex items-center gap-2 text-white/45">
        <span className="text-cyan-100/80">{icon}</span>
        <span className="text-[10px]">{title}</span>
      </div>
      <p className="mt-2 break-all text-[clamp(17px,1.8vw,22px)] font-semibold tabular-nums tracking-[-0.03em] text-white/90">
        {value === null ? '—' : formatCount(value)}
      </p>
      <p className="mt-1 text-[9px] text-white/30">Накопительный счётчик</p>
    </article>
  );
}

function cstateName(metricId: string): string {
  const suffix = metricId.slice('system.cpu.idle.cstate.'.length);
  return suffix.replaceAll('_', ' ').toUpperCase();
}

function CStateCard({ cpu, states }: { cpu: string; states: CpuCStateTelemetry[] }) {
  return (
    <article className="min-w-0 rounded-[15px] border border-sky-200/[0.10] bg-white/[0.025] p-3">
      <div className="mb-2 flex items-center gap-2">
        <CpuLabel value={cpu} />
        <span className="ml-auto text-[9px] text-white/35">{states.length} состояний</span>
      </div>
      <div className="space-y-2">
        {states.map(state => (
          <div key={state.objectId + state.metricId} className="flex items-center justify-between gap-3 border-t border-white/[0.05] pt-2">
            <span className="min-w-0 truncate text-[10px] text-white/55" title={cstateName(state.metricId)}>{cstateName(state.metricId)}</span>
            <span className="shrink-0 text-[11px] font-medium tabular-nums text-white/80">{formatDuration(state.residencyNs)}</span>
          </div>
        ))}
      </div>
    </article>
  );
}

function CpuLabel({ value }: { value: string }) {
  return <span className="text-[11px] font-semibold text-white/85">{value.toUpperCase().replace('/', ' · ')}</span>;
}

const THROTTLE_LABELS: Record<string, string> = {
  'system.cpu.throttling.thermal.core.events': 'Thermal throttle · CPU events',
  'system.cpu.throttling.thermal.core.duration': 'Thermal throttle · CPU duration',
  'system.cpu.throttling.thermal.package.events': 'Thermal throttle · Package events',
  'system.cpu.throttling.thermal.package.duration': 'Thermal throttle · Package duration',
  'system.cpu.throttling.power.core.events': 'Power limit · CPU events',
  'system.cpu.throttling.power.package.events': 'Power limit · Package events',
};

function ThrottleValue({ item }: { item: CpuThrottleTelemetry }) {
  const duration = item.unit === 'ns';
  return (
    <article className="min-w-0 rounded-[13px] border border-sky-200/[0.09] bg-white/[0.02] px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] text-white/55">{THROTTLE_LABELS[item.metricId] ?? item.metricId}</span>
        <span className="rounded-full border border-white/[0.07] px-2 py-0.5 text-[9px] text-white/40">{item.objectId}</span>
      </div>
      <p className="mt-2 text-[14px] font-semibold tabular-nums text-white/85">
        {duration ? formatDuration(item.value) : formatCount(item.value)}
      </p>
    </article>
  );
}

export function CpuExtendedSection({ telemetry }: { telemetry: CpuExtendedTelemetry }) {
  const grouped = new Map<string, CpuCStateTelemetry[]>();
  for (const item of telemetry.cstates) {
    const cpu = item.objectId.split('/')[0] ?? item.objectId;
    const values = grouped.get(cpu) ?? [];
    values.push(item);
    grouped.set(cpu, values);
  }

  return (
    <section className="homecloud-glass rounded-[20px] border border-sky-200/[0.13] p-3.5" aria-label="Расширенные показатели CPU">
      <div className="mb-3 flex items-center gap-2 px-1">
        <Gauge size={14} className="text-cyan-100/80" aria-hidden="true" />
        <h3 className="text-[12px] font-semibold text-white/85">Энергосбережение и системные счётчики</h3>
        {telemetry.observedAt && <span className="ml-auto text-[9px] text-white/30">{new Date(telemetry.observedAt).toLocaleTimeString()}</span>}
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <CounterCard title="Interrupts" value={telemetry.interrupts} icon={<Zap size={13} />} />
        <CounterCard title="Context switches" value={telemetry.contextSwitches} icon={<Activity size={13} />} />
      </div>
      {(telemetry.interruptsError || telemetry.contextSwitchesError) && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {telemetry.interruptsError && <MetricError>{telemetry.interruptsError}</MetricError>}
          {telemetry.contextSwitchesError && <MetricError>{telemetry.contextSwitchesError}</MetricError>}
        </div>
      )}

      <div className="mt-4">
        <div className="mb-2 flex items-center gap-2 px-1">
          <Clock3 size={13} className="text-cyan-100/70" aria-hidden="true" />
          <h4 className="text-[11px] font-semibold text-white/75">C-states · время пребывания</h4>
        </div>
        {telemetry.cstatesError && <MetricError>{telemetry.cstatesError}</MetricError>}
        {grouped.size > 0 ? (
          <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(min(100%,210px),1fr))] gap-2">
            {[...grouped.entries()].map(([cpu, states]) => <CStateCard key={cpu} cpu={cpu} states={states} />)}
          </div>
        ) : !telemetry.cstatesError ? (
          <p className="px-1 py-2 text-[10px] text-white/35">Ожидание данных cpuidle. Если ядро или процессор не предоставляет C-state residency, метрики будут недоступны.</p>
        ) : null}
      </div>

      <div className="mt-4">
        <div className="mb-2 flex items-center gap-2 px-1">
          <RefreshCw size={13} className="text-cyan-100/70" aria-hidden="true" />
          <h4 className="text-[11px] font-semibold text-white/75">Thermal / Power throttling</h4>
        </div>
        {telemetry.throttlingError && <MetricError>{telemetry.throttlingError}</MetricError>}
        {telemetry.throttling.length > 0 ? (
          <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(min(100%,230px),1fr))] gap-2">
            {telemetry.throttling.map((item, index) => <ThrottleValue key={item.metricId + item.objectId + index} item={item} />)}
          </div>
        ) : !telemetry.throttlingError ? (
          <p className="px-1 py-2 text-[10px] text-white/35">Ожидание счётчиков thermal throttling и power limit. Поддержка зависит от CPU и драйвера ядра.</p>
        ) : null}
      </div>
    </section>
  );
}
