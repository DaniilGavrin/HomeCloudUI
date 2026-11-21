export function CpuGauge({ value }: { value: number | null }) {
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

