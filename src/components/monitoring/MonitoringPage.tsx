import { motion, useReducedMotion } from 'motion/react';
import { Server } from 'lucide-react';
import { useHomeCloudPool } from '../../hooks/useHomeCloudPool';

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

export function MonitoringPage() {
  const { snapshot, error } = useHomeCloudPool();
  const reduced = Boolean(useReducedMotion());

  return (
    <section
      className="homecloud-glass flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] p-[clamp(16px,1.65vw,23px)]"
      aria-label="Мониторинг серверов"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain pr-[3px] [scrollbar-color:rgba(155,224,255,.30)_transparent] [scrollbar-width:thin]">
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
              <motion.article
                key={server.id}
                className="flex min-h-[150px] min-w-0 flex-col rounded-[22px] border border-sky-200/[0.14] bg-[linear-gradient(145deg,rgba(125,189,255,.043),rgba(110,123,222,.025)),rgba(21,42,74,.13)] p-[18px] text-left shadow-[0_12px_32px_rgba(0,0,0,.10),inset_0_1px_0_rgba(255,255,255,.035)] transition-[border-color,background] duration-200 hover:border-sky-200/30 hover:bg-white/[0.045]"
                initial={reduced ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={reduced ? undefined : { y: -2 }}
                transition={{ duration: reduced ? 0.08 : 0.2, delay: reduced ? 0 : Math.min(index * 0.035, 0.18) }}
                aria-label={`Сервер ${server.name}: ${server.phase === 'ready' ? 'Online' : server.phase === 'connecting' ? 'Connecting' : 'Offline'}`}
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <span className="grid h-[49px] w-[49px] shrink-0 place-items-center rounded-[14px] border border-cyan-200/20 bg-[linear-gradient(140deg,rgba(35,171,220,.14),rgba(95,73,221,.07))] text-cyan-100">
                    <Server size={25} strokeWidth={1.6} aria-hidden="true" />
                  </span>
                  <ServerStatus phase={server.phase} />
                </div>

                <div className="mt-[17px] min-w-0">
                  <h2 className="overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-semibold leading-[1.3] text-[#f7faff]" title={server.name}>
                    {server.name}
                  </h2>
                  <p className="mt-[5px] break-all text-[11px] leading-[1.5] text-white/50">
                    {addressLabel(server.ipv4, server.ipv6)}
                  </p>
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
