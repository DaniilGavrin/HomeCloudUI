import { Server } from 'lucide-react';
import { useHomeCloudPool } from '../../hooks/useHomeCloudPool';

function addressLabel(ipv4: string | null, ipv6: string | null): string {
  const addresses = [ipv4, ipv6].filter((value): value is string => Boolean(value));
  return addresses.length ? addresses.join(' · ') : 'IP-адрес не указан';
}

export function MonitoringPage() {
  const { snapshot, error } = useHomeCloudPool();

  return (
    <section className="h-full min-h-0 overflow-y-auto rounded-[28px] p-4 sm:p-5" aria-label="Мониторинг серверов">
      {error && (
        <p className="mb-4 rounded-2xl border border-rose-300/20 bg-rose-400/[0.07] px-4 py-3 text-sm text-rose-200" role="alert">
          Не удалось получить список серверов: {error}
        </p>
      )}

      {snapshot.servers.length === 0 ? (
        <div className="homecloud-glass flex min-h-[260px] flex-col items-center justify-center rounded-[26px] px-6 py-12 text-center">
          <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-200/15 bg-cyan-300/[0.07] text-cyan-100">
            <Server size={27} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <h2 className="text-lg font-semibold text-white">Серверы не добавлены</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-white/55">
            Добавленные серверы HomeCloud появятся здесь автоматически.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] gap-4">
          {snapshot.servers.map((server) => {
            const online = server.phase === 'ready';
            const connecting = server.phase === 'connecting';
            const statusLabel = online ? 'ONLINE' : connecting ? 'CONNECTING' : 'OFFLINE';
            const statusClass = online
              ? 'border-emerald-300/25 bg-emerald-400/10 text-emerald-300'
              : connecting
                ? 'border-amber-300/25 bg-amber-400/10 text-amber-200'
                : 'border-rose-300/25 bg-rose-400/10 text-rose-300';

            return (
              <article
                key={server.id}
                className="homecloud-glass flex min-h-[190px] flex-col rounded-[26px] p-5"
                aria-label={`Сервер ${server.name}: ${statusLabel}`}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-200/15 bg-cyan-300/[0.07] text-cyan-100">
                    <Server size={21} strokeWidth={1.7} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <h2 className="break-words text-base font-semibold leading-6 text-white">{server.name}</h2>
                    <p className="mt-1 break-all text-xs leading-5 text-white/50">
                      {addressLabel(server.ipv4, server.ipv6)}
                    </p>
                  </div>
                </div>

                <div className="mt-auto pt-5">
                  <div className={`flex min-h-11 items-center justify-center rounded-xl border px-4 py-2 text-sm font-bold tracking-[0.16em] ${statusClass}`} role="status">
                    {statusLabel}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
