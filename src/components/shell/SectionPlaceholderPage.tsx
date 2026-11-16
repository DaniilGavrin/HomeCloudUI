import type { LucideIcon } from 'lucide-react';

type SectionPlaceholderPageProps = {
  title: string;
  description: string;
  icon: LucideIcon;
};

export function SectionPlaceholderPage({ title, description, icon: Icon }: SectionPlaceholderPageProps) {
  return (
    <section
      className="homecloud-glass flex h-full min-h-[320px] flex-col items-center justify-center rounded-[28px] px-6 py-12 text-center sm:px-10"
      aria-labelledby="hc-section-placeholder-title"
    >
      <div className="mb-7 flex h-[76px] w-[76px] items-center justify-center rounded-[24px] border border-cyan-200/15 bg-cyan-300/[0.07] text-cyan-100 shadow-[0_10px_35px_rgba(0,0,0,0.16)]">
        <Icon size={34} strokeWidth={1.45} aria-hidden="true" />
      </div>

      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-100/60">
        HomeCloud · Раздел
      </span>
      <h1 id="hc-section-placeholder-title" className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        {title}
      </h1>
      <p className="mt-3 max-w-xl text-sm leading-6 text-white/60 sm:text-base">
        {description}
      </p>

      <div className="mt-8 rounded-full border border-white/10 bg-white/[0.045] px-4 py-2 text-xs font-medium text-white/55">
        Раздел подготовлен к наполнению
      </div>
      <p className="mt-4 max-w-lg text-xs leading-5 text-white/35">
        Страница создана. Функции, данные и интеграции будут добавлены отдельно.
      </p>
    </section>
  );
}
