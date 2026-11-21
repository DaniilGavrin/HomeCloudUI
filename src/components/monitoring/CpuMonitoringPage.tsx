import type { ReactNode } from 'react';
import { Activity, Cpu, Gauge, Timer, Zap } from 'lucide-react';
import type { CpuTelemetry } from '../../hooks/useHomeCloudCpuMonitoring';

function formatCpuTime(value: string | null): string {
  if (value === null || !/^\\d+$/.test(value)) return '—';
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

function CpuGauge({ value }: { value: number | null }) {
  const radius = 43;
  const circumference = 2 * Math.PI * radius;
  const progress = value === null ? 0 : Math.max(0, Math.min(100, value));
  const offset = circumference * (1 - progress / 100);

  return (
    <div className="relative grid h-[142px] w-[142px] shrink-0 place-items-center">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(190,220,255,.10)" strokeWidth="7" />
        <circle
          cx="50" cy="50" r={radius} fill="none"
          stroke="rgb(103,211,245)" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-[stroke-dashoffset] duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[31px] font-semibold leading-none tracking-[-0.045em] text-white tabular-nums">
          {value === null ? '—' : value.toFixed(1)}
          <span className="ml-0.5 text-[17px] text-white/65">%</span>
        </span>
        <span className="mt-2 text-[10px] font-medium uppercase tracking-[0.13em] text-white/45">CPU</span>
      </div>
    </div>
  );
}

function CompactMetric({
  title,
  value,
  icon,
}: {
  title: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <article className="flex min-h-[112px] w-[190px] shrink-0 flex-col justify-center rounded-[18px] border border-sky-200/[0.10] bg-white/[0.025] px-4 py-3">
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

export function CpuMonitoringPage({ telemetry }: { telemetry: CpuTelemetry }) {
  const statusLabel = telemetry.phase === 'streaming'
    ? 'Online'
    : telemetry.phase === 'offline'
      ? 'Offline'
      : telemetry.phase === 'error'
        ? 'Ошибка'
        : 'Подключение';

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3" aria-label="Мониторинг CPU">
      <header className="flex items-center justify-between px-1 pt-1">
        <div className="flex items-center gap-2">
          <Cpu size={16} className="text-cyan-200" aria-hidden="true" />
          <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-white">CPU</h2>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.025] px-2.5 py-1.5 text-[10px] text-white/50">
          <i className={`h-[6px] w-[6px] rounded-full ${telemetry.phase === 'streaming' ? 'bg-emerald-300 shadow-[0_0_8px_rgba(110,240,190,.5)]' : telemetry.phase === 'error' || telemetry.phase === 'offline' ? 'bg-rose-300' : 'bg-amber-200'}`} />
          {statusLabel}
        </span>
      </header>

      {telemetry.error && (
        <div role="alert" className="rounded-[12px] border border-rose-300/20 bg-rose-400/[0.06] px-3 py-2 text-[11px] leading-5 text-rose-100/85">
          {telemetry.error}
        </div>
      )}

      <div className="homecloud-glass flex w-full max-w-full flex-wrap items-center justify-start gap-3 rounded-[20px] border border-sky-200/[0.13] p-3.5">
        <div className="flex justify-center sm:justify-start">
          <CpuGauge value={telemetry.totalUsage} />
        </div>
        <CompactMetric title="User Time" value={formatCpuTime(telemetry.userTimeNs)} icon={<Timer size={14} aria-hidden="true" />} />
        <CompactMetric title="System Time" value={formatCpuTime(telemetry.systemTimeNs)} icon={<Activity size={14} aria-hidden="true" />} />
        <CompactMetric title="Nice Time" value={formatCpuTime(telemetry.niceTimeNs)} icon={<Gauge size={14} aria-hidden="true" />} />
        <CompactMetric title="Idle Time" value={formatCpuTime(telemetry.idleTimeNs)} icon={<Timer size={14} aria-hidden="true" />} />
        <CompactMetric title="I/O Wait" value={formatCpuTime(telemetry.ioWaitTimeNs)} icon={<Activity size={14} aria-hidden="true" />} />
        <CompactMetric title="IRQ Time" value={formatCpuTime(telemetry.irqTimeNs)} icon={<Zap size={14} aria-hidden="true" />} />
      </div>

      {telemetry.error && (
        <p className="px-1 text-[10px] text-white/35">
          Последнее успешное измерение: {telemetry.observedAt ? new Date(telemetry.observedAt).toLocaleTimeString() : 'нет данных'}.
        </p>
      )}
    </section>
  );
}
