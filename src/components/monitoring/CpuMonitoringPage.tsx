import { Activity, Cpu, Gauge, Timer } from 'lucide-react';
import type { PoolServer } from '../../hooks/useHomeCloudPool';
import { useHomeCloudCpuMonitoring } from '../../hooks/useHomeCloudCpuMonitoring';

function formatCpuTime(value: string | null): string {
  if (value === null || !/^\d+$/.test(value)) return '—';
  try {
    const ns = BigInt(value);
    const totalMs = ns / 1_000_000n;
    const totalSeconds = totalMs / 1_000n;
    const milliseconds = totalMs % 1_000n;
    const days = totalSeconds / 86_400n;
    const hours = (totalSeconds % 86_400n) / 3_600n;
    const minutes = (totalSeconds % 3_600n) / 60n;
    const seconds = totalSeconds % 60n;

    if (days > 0n) return `${days} д ${hours} ч ${minutes} мин`;
    if (hours > 0n) return `${hours} ч ${minutes} мин ${seconds} с`;
    if (minutes > 0n) return `${minutes} мин ${seconds}.${milliseconds.toString().padStart(3, '0')} с`;
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
        <span className="mt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-white/45">CPU usage</span>
      </div>
    </div>
  );
}

function MetricCard({
  title,
  value,
  description,
  icon,
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ReactNode;
}) {
  return (
    <article className="homecloud-glass min-w-0 rounded-[20px] border border-sky-200/[0.12] p-[18px]">
      <div className="flex items-center gap-2 text-white/55">
        <span className="grid h-8 w-8 place-items-center rounded-[10px] border border-sky-200/10 bg-sky-200/[0.055] text-cyan-100">
          {icon}
        </span>
        <span className="text-[12px] font-medium">{title}</span>
      </div>
      <p className="mt-5 break-words text-[clamp(18px,2vw,24px)] font-semibold leading-tight tracking-[-0.035em] text-white tabular-nums">
        {value}
      </p>
      <p className="mt-2 text-[11px] leading-5 text-white/40">{description}</p>
    </article>
  );
}

export function CpuMonitoringPage({ server }: { server: PoolServer }) {
  const telemetry = useHomeCloudCpuMonitoring(server.id, server.phase);
  const cpu = server.data?.cpu;
  const coreLabel = cpu?.logical_cores
    ? `${cpu.logical_cores} логических ядер${cpu.physical_cores ? ` · ${cpu.physical_cores} физических` : ''}`
    : 'Количество ядер не определено';

  const statusLabel = telemetry.phase === 'streaming'
    ? 'Получение данных · 1 сек'
    : telemetry.phase === 'offline'
      ? 'Сервер недоступен'
      : telemetry.phase === 'error'
        ? 'Ошибка телеметрии'
        : 'Подключение к телеметрии';

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-[14px]" aria-label="Мониторинг CPU">
      <header className="flex flex-wrap items-start justify-between gap-3 px-1 pt-1">
        <div>
          <div className="flex items-center gap-2">
            <Cpu size={17} className="text-cyan-200" aria-hidden="true" />
            <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-white">Процессор</h2>
          </div>
          <p className="mt-1 text-[11px] text-white/45">{cpu?.model || coreLabel}</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.035] px-3 py-[7px] text-[10px] text-white/55">
          <i className={`h-[6px] w-[6px] rounded-full ${telemetry.phase === 'streaming' ? 'bg-emerald-300 shadow-[0_0_8px_rgba(110,240,190,.5)]' : telemetry.phase === 'error' ? 'bg-rose-300' : 'bg-amber-200'}`} />
          {statusLabel}
        </span>
      </header>

      {telemetry.error && (
        <div role="alert" className="rounded-[14px] border border-rose-300/20 bg-rose-400/[0.06] px-4 py-3 text-[12px] leading-5 text-rose-100/85">
          {telemetry.error}
        </div>
      )}

      <div className="homecloud-glass flex flex-wrap items-center gap-6 rounded-[22px] border border-sky-200/[0.14] p-[clamp(18px,2.2vw,28px)]">
        <CpuGauge value={telemetry.totalUsage} />
        <div className="min-w-[180px] flex-1">
          <div className="flex items-center gap-2 text-cyan-100/80">
            <Gauge size={15} aria-hidden="true" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.13em]">Текущая загрузка</span>
          </div>
          <p className="mt-3 max-w-xl text-[13px] leading-6 text-white/60">
            Доля времени процессора, занятого выполнением задач за последний интервал измерения.
            Значение обновляется один раз в секунду.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-[6px] text-[10px] text-white/50">{coreLabel}</span>
            {cpu?.vendor && <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-3 py-[6px] text-[10px] text-white/50">{cpu.vendor}</span>}
          </div>
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-[14px] sm:grid-cols-2">
        <MetricCard
          title="User Time"
          value={formatCpuTime(telemetry.userTimeNs)}
          description="Накопленное CPU-время пользовательских процессов"
          icon={<Timer size={15} aria-hidden="true" />}
        />
        <MetricCard
          title="System Time"
          value={formatCpuTime(telemetry.systemTimeNs)}
          description="Накопленное CPU-время выполнения кода ядра"
          icon={<Activity size={15} aria-hidden="true" />}
        />
      </div>

      <p className="px-1 text-[10px] leading-5 text-white/35">
        Счётчики User/System накопительные и не сбрасываются между обновлениями. Последнее измерение: {telemetry.observedAt ? new Date(telemetry.observedAt).toLocaleTimeString() : 'ожидание данных'}.
      </p>
    </section>
  );
}
