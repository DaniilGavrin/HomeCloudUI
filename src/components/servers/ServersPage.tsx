import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useHomeCloudServer, type ServerStatusData } from '../../hooks/useHomeCloudServer';
import { useHomeCloudPool, type PoolServer } from '../../hooks/useHomeCloudPool';
import '../../styles/servers.css';

function asText(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}
function numeric(value: number | undefined, digits = 0): string {
  return value === undefined || !Number.isFinite(value) ? '—' : value.toLocaleString('ru-RU', { maximumFractionDigits: digits });
}
function bytes(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '—';
  if (value === 0) return '0 Б';
  const i = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4);
  return `${numeric(value / Math.pow(1024, i), i ? 2 : 0)} ${['Б', 'КиБ', 'МиБ', 'ГиБ', 'ТиБ'][i]}`;
}
function percentage(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '—' : `${numeric(value, 1)}%`;
}
function uptime(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '—';
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return `${days ? `${days} д ` : ''}${hours} ч ${minutes} мин`;
}
function time(value: string | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ru-RU');
}
function HostIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3.5" y="3" width="17" height="8" rx="2"/><rect x="3.5" y="13" width="17" height="8" rx="2"/>
    <circle cx="7.5" cy="7" r=".7" fill="currentColor"/><circle cx="7.5" cy="17" r=".7" fill="currentColor"/>
    <path d="M12 7h5M12 17h5"/>
  </svg>;
}
function RefreshIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14-5L3 9m0-5v5h5M4 13a8 8 0 0 0 14 5l3-3m0 5v-5h-5"/></svg>;
}
function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <div className="hc-server-field"><span>{label}</span><strong>{asText(value)}</strong></div>;
}
function Section({ title, description, children, id }: { title: string; description?: string; children: ReactNode; id?: string }) {
  return <section className="hc-server-section homecloud-glass" id={id}>
    <header className="hc-server-section__head"><h3>{title}</h3>{description && <span>{description}</span>}</header>
    {children}
  </section>;
}
function Progress({ label, value, caption }: { label: string; value?: number; caption?: string }) {
  const valid = value !== undefined && Number.isFinite(value);
  const width = valid ? Math.max(0, Math.min(100, value)) : 0;
  return <div className="hc-server-progress">
    <div className="hc-server-progress__labels"><span>{label}</span><strong>{caption ?? percentage(value)}</strong></div>
    <div className="hc-server-progress__rail" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={valid ? width : undefined}>
      <div className="hc-server-progress__bar" style={{ width: `${width}%` }} />
    </div>
  </div>;
}
function Details({ data, onClose, onRefresh, canRefresh, reduced, phase, name, addresses }: {
  data: ServerStatusData; onClose: () => void; onRefresh: () => void; canRefresh: boolean;
  reduced: boolean; phase: 'offline' | 'loading' | 'connecting' | 'ready' | 'error'; name: string; addresses: string;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const partitions = data.disks?.partitions ?? [];
  const network = data.network?.interfaces ?? [];
  const cpu = data.cpu;
  const backend = data.backend;
  const sys = data.system;
  const sortedIo = Object.entries(data.disks?.io_counters ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const errors = Object.entries(data.collection_errors ?? {}).sort(([a], [b]) => a.localeCompare(b));

  useEffect(() => { closeRef.current?.focus(); }, []);
  return <motion.div className="hc-server-details"
    initial={{ opacity: 0, x: reduced ? 0 : 22 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduced ? 0 : 15 }}
    transition={{ duration: reduced ? .1 : .25, ease: 'easeOut' }} role="region" aria-label="Подробная информация о сервере">
    <div className="hc-server-details__header">
      <div className="hc-server-details__identity">
        <div className="hc-server-icon"><HostIcon /></div>
        <div><div className="hc-servers-eyebrow">HomeCloudBackend · System Status</div><h2>{name}</h2>
          <p>{sys?.hostname || 'Сервер'} · {addresses} · Данные на {time(data.collected_at)}</p>
          <span className={['hc-server-online', phase === 'offline' ? 'hc-server-online--offline' : phase === 'loading' || phase === 'connecting' || phase === 'error' ? 'hc-server-online--pending' : ''].filter(Boolean).join(' ')} role="status">
            <i /> {phase === 'offline' ? 'Offline' : phase === 'loading' || phase === 'connecting' ? 'Подключение' : phase === 'error' ? 'Ошибка телеметрии' : 'Online'}
          </span>
        </div>
      </div>
      <div className="hc-server-details__actions">
        <button type="button" className="hc-server-action" disabled={!canRefresh} onClick={onRefresh}><RefreshIcon /> Обновить</button>
        <button ref={closeRef} type="button" className="hc-server-close" onClick={onClose} aria-label="Назад к списку серверов" title="Назад к списку серверов (Esc)">×</button>
      </div>
    </div>
    {phase !== 'ready' && <p className="hc-servers-message hc-servers-message--warning" role="status">
      {phase === 'offline'
        ? 'Сервер Offline. Показана последняя полученная телеметрия, показатели не обновляются.'
        : phase === 'loading' || phase === 'connecting'
          ? 'Соединение восстановлено. Ожидаем новую телеметрию; пока показаны сохранённые данные.'
          : 'Не удалось обновить телеметрию. Показаны последние полученные показатели.'}
    </p>}
    <div className="hc-server-details__scroll">
      <div className="hc-server-detail-grid">
        <Section title="Процессор" description="CPU" id="hc-server-cpu">
          <div className="hc-server-fields">
            <Field label="Модель" value={cpu?.model}/><Field label="Производитель" value={cpu?.vendor}/>
            <Field label="Физические ядра" value={cpu?.physical_cores}/><Field label="Логические ядра" value={cpu?.logical_cores}/>
            <Field label="Частота" value={cpu?.frequency_mhz === undefined ? '—' : `${numeric(cpu.frequency_mhz)} МГц`}/>
            <Field label="Кэш" value={cpu?.cache_kb === undefined ? '—' : `${numeric(cpu.cache_kb)} КиБ`}/>
          </div>
          <Progress label="Загрузка CPU" value={cpu?.usage_percent}/>
          {(cpu?.usage_per_core_percent?.length ?? 0) > 0 && <details className="hc-server-expand"><summary>Загрузка каждого логического ядра ({cpu?.usage_per_core_percent?.length})</summary><div className="hc-server-core-grid">
            {cpu?.usage_per_core_percent?.map((v, i) => <Progress key={i} label={`CPU ${i}`} value={v} />)}
          </div></details>}
          {(cpu?.features?.length ?? 0) > 0 && <details className="hc-server-expand"><summary>Поддерживаемые инструкции ({cpu?.features?.length})</summary><p className="hc-server-mono">{cpu?.features?.join(', ')}</p></details>}
        </Section>
        <Section title="Оперативная память" description="RAM / Swap" id="hc-server-memory">
          <Progress label="RAM используется" value={data.memory?.used_percent} caption={`${bytes(data.memory?.used_bytes)} / ${bytes(data.memory?.total_bytes)} · ${percentage(data.memory?.used_percent)}`}/>
          <div className="hc-server-fields"><Field label="Доступно RAM" value={bytes(data.memory?.available_bytes)}/><Field label="Свободно RAM" value={bytes(data.memory?.free_bytes)}/></div>
          <Progress label="Swap используется" value={data.swap?.used_percent} caption={`${bytes(data.swap?.used_bytes)} / ${bytes(data.swap?.total_bytes)} · ${percentage(data.swap?.used_percent)}`}/>
          <div className="hc-server-fields"><Field label="Свободно Swap" value={bytes(data.swap?.free_bytes)}/></div>
        </Section>
        <Section title="Операционная система" description="Host / OS" id="hc-server-os">
          <dl className="hc-server-fields"><Field label="Hostname" value={sys?.hostname}/><Field label="Система" value={sys?.os_family}/>
            <Field label="Дистрибутив" value={sys?.platform}/><Field label="Версия платформы" value={sys?.platform_version}/>
            <Field label="Семейство" value={sys?.platform_family}/><Field label="Архитектура" value={sys?.kernel_arch ?? sys?.goarch}/>
            <Field label="Версия ядра" value={sys?.kernel_version}/><Field label="Go OS / ARCH" value={sys?.goos && sys?.goarch ? `${sys.goos}/${sys.goarch}` : '—'}/>
            <Field label="Uptime системы" value={uptime(sys?.uptime_seconds)}/><Field label="Загрузка ОС" value={sys?.boot_time_unix ? new Date(sys.boot_time_unix * 1000).toLocaleString('ru-RU') : '—'}/>
            <Field label="Процессы" value={sys?.process_count}/><Field label="Часовой пояс" value={sys?.timezone}/>
            <Field label="UTC-смещение" value={sys?.timezone_offset_seconds === undefined ? '—' : `${numeric(sys.timezone_offset_seconds / 3600, 2)} ч`}/>
            <Field label="Виртуализация" value={[sys?.virtualization?.system, sys?.virtualization?.role].filter(Boolean).join(' / ') || '—'}/>
          </dl>
          {data.load_average && <div className="hc-server-submetrics"><span>Load average</span><strong>{numeric(data.load_average.one_minute, 2)} / {numeric(data.load_average.five_minutes, 2)} / {numeric(data.load_average.fifteen_minutes, 2)}</strong><small>1 / 5 / 15 мин</small></div>}
        </Section>
        <Section title="Процесс HomeCloudBackend" description="Go Runtime" id="hc-server-process">
          <dl className="hc-server-fields">
            <Field label="Состояние" value={data.status}/><Field label="Версия Go" value={backend?.go_version}/>
            <Field label="PID" value={backend?.pid}/><Field label="WebSocket-клиенты" value={backend?.connections}/>
            <Field label="Горутины" value={backend?.goroutines}/><Field label="Потоки" value={backend?.threads}/>
            <Field label="GOMAXPROCS" value={backend?.gomaxprocs}/><Field label="Доступные CPU" value={backend?.logical_cpus_visible_to_go}/>
            <Field label="CGO-вызовы" value={backend?.cgo_calls}/><Field label="Время работы" value={uptime(backend?.uptime_seconds)}/>
            <Field label="Запуск процесса" value={time(backend?.started_at)}/><Field label="RSS" value={bytes(backend?.process_memory?.rss_bytes)}/>
            <Field label="VMS" value={bytes(backend?.process_memory?.vms_bytes)}/>
            <Field label="Heap Alloc" value={bytes(backend?.go_heap?.allocated_bytes)}/>
            <Field label="Heap In Use" value={bytes(backend?.go_heap?.heap_in_use_bytes)}/>
            <Field label="Объектов Heap" value={backend?.go_heap?.heap_objects}/>
            <Field label="GC циклов" value={backend?.go_heap?.gc_cycles}/>
            <Field label="Всего выделено" value={bytes(backend?.go_heap?.total_allocated_bytes)}/>
          </dl>
        </Section>
        <Section title="Диски и разделы" description={`${partitions.length} томов`} id="hc-server-disks">
          {partitions.length === 0 ? <p className="hc-server-muted">Данные о разделах недоступны</p> : <div className="hc-server-sublist">
            {partitions.map((disk, i) => <article className="hc-server-subitem" key={`${disk.mountpoint}-${i}`}>
              <div className="hc-server-subitem__head"><strong>{disk.mountpoint || disk.device || 'Диск'}</strong><span>{disk.filesystem || '—'}</span></div>
              <div className="hc-server-muted hc-server-mono">{disk.device || '—'}</div>
              {disk.error ? <p className="hc-server-warning">{disk.error}</p> : <><Progress label="Занято" value={disk.used_percent} caption={`${bytes(disk.used_bytes)} / ${bytes(disk.total_bytes)} · ${percentage(disk.used_percent)}`}/>
                <div className="hc-server-fields"><Field label="Свободно" value={bytes(disk.free_bytes)}/>
                  {disk.inodes_total !== undefined && <Field label="Inodes" value={`${numeric(disk.inodes_used)} / ${numeric(disk.inodes_total)}`}/>}</div></>}
            </article>)}
          </div>}
          {sortedIo.length > 0 && <details className="hc-server-expand"><summary>Дисковые операции и I/O ({sortedIo.length})</summary><div className="hc-server-sublist">
            {sortedIo.map(([name, stats]) => <div className="hc-server-subitem" key={name}><strong className="hc-server-mono">{name}</strong><dl className="hc-server-fields">
              <Field label="Прочитано" value={bytes(stats.read_bytes)}/><Field label="Записано" value={bytes(stats.write_bytes)}/>
              <Field label="Операции чтения" value={stats.read_operations}/><Field label="Операции записи" value={stats.write_operations}/>
            </dl></div>)}
          </div></details>}
        </Section>
        <Section title="Сеть" description={`${network.length} интерфейсов`} id="hc-server-network">
          {network.length === 0 ? <p className="hc-server-muted">Данные об интерфейсах недоступны</p> : <div className="hc-server-sublist">
            {network.map((net, i) => <article key={`${net.name}-${i}`} className="hc-server-subitem">
              <div className="hc-server-subitem__head"><strong>{net.name || `Интерфейс ${i + 1}`}</strong><span className={net.up ? 'hc-server-net--up' : 'hc-server-muted'}>{net.up ? 'UP' : 'DOWN'}</span></div>
              <dl className="hc-server-fields"><Field label="Индекс" value={net.index}/><Field label="MTU" value={net.mtu}/>
                <Field label="MAC" value={net.mac}/><Field label="Loopback" value={net.loopback ? 'Да' : 'Нет'}/>
                <Field label="Отправлено" value={bytes(net.traffic?.bytes_sent)}/><Field label="Принято" value={bytes(net.traffic?.bytes_received)}/>
                <Field label="Пакетов TX" value={net.traffic?.packets_sent}/><Field label="Пакетов RX" value={net.traffic?.packets_received}/>
              </dl>
              {(net.addresses?.length ?? 0) > 0 && <div className="hc-server-addresses">{net.addresses?.map((addr, j) => <code key={`${addr}-${j}`}>{addr}</code>)}</div>}
              {net.address_error && <p className="hc-server-warning">{net.address_error}</p>}
            </article>)}
          </div>}
        </Section>
        <Section title="Датчики температуры" description="Если доступны в ОС" id="hc-server-temps">
          {(data.temperatures?.length ?? 0) === 0 ? <p className="hc-server-muted">Температурные датчики не переданы сервером</p> : <div className="hc-server-fields">
            {data.temperatures?.map((sensor, i) => <Field key={`${sensor.sensor}-${i}`} label={sensor.sensor || `Датчик ${i + 1}`}
              value={`${numeric(sensor.celsius, 1)} °C${sensor.high_celsius ? ` · высокий: ${numeric(sensor.high_celsius, 1)} °C` : ''}${sensor.critical_celsius ? ` · критический: ${numeric(sensor.critical_celsius, 1)} °C` : ''}`} />)}
          </div>}
        </Section>
        <Section title="Ошибки сбора телеметрии" description={`${errors.length} ошибок`} id="hc-server-errors">
          {errors.length === 0 ? <p className="hc-server-muted">Ошибки сбора не сообщались</p> : <div className="hc-server-sublist">{errors.map(([key, message]) => <div className="hc-server-subitem" key={key}><strong>{key}</strong><p className="hc-server-warning">{message}</p></div>)}</div>}
        </Section>
      </div>
      <details className="hc-server-expand hc-server-raw"><summary>Полный исходный JSON от system.status</summary><pre>{JSON.stringify(data, null, 2)}</pre></details>
      <div className="hc-server-details__footer">Данные непосредственно с узла HomeCloudBackend · обновление каждые 15 секунд</div>
    </div>
  </motion.div>;
}

type DisplayServer = Omit<PoolServer, 'phase'> & { phase: 'offline' | 'loading' | 'connecting' | 'ready' | 'error' };

function addressLabel(server: DisplayServer): string {
  return [server.ipv4, server.ipv6].filter(Boolean).join(' · ') || 'Адрес не задан';
}

export function ServersPage() {
  const primary = useHomeCloudServer();
  const pool = useHomeCloudPool();
  const [openedId, setOpenedId] = useState<string | null>(null);
  const focusTo = useRef<string | null>(null);
  const reduced = Boolean(useReducedMotion());

  // The builtin node uses its existing single connection and system.status.
  // Other nodes are separately monitored by Rust, not by React WebSockets.
  const fallback: PoolServer = {
    id: 'primary', name: 'HomeCloudBackend', ipv4: '127.0.0.1', ipv6: null,
    builtin: true, phase: 'offline', latency_ms: null, data: null, error: null,
  };
  const entries = pool.snapshot.servers.length ? pool.snapshot.servers : [fallback];
  const servers: DisplayServer[] = entries.map(server => server.builtin ? {
    ...server, phase: primary.snapshot.phase, data: primary.snapshot.data, error: primary.snapshot.error,
  } : server);
  const selected = servers.find(server => server.id === openedId);
  const close = useCallback(() => {
    focusTo.current = openedId;
    setOpenedId(null);
  }, [openedId]);
  const refresh = useCallback(async (id: string) => {
    if (id === 'primary') await primary.refresh();
    else await pool.refresh(id);
  }, [primary.refresh, pool.refresh]);

  useEffect(() => {
    if (!openedId) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Backspace') return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault();
      close();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openedId, close]);

  const onlineCount = servers.filter(s => s.phase === 'ready' || s.phase === 'loading').length;
  return <section className="hc-servers-page homecloud-glass" aria-label="Серверы HomeCloud">
    <AnimatePresence mode="wait" initial={false}>
      {selected ? (
        selected.data ? (
          <Details key={`details-${selected.id}`} data={selected.data} name={selected.name} addresses={addressLabel(selected)}
            onClose={close} onRefresh={() => void refresh(selected.id)} canRefresh={selected.phase !== 'offline' && selected.phase !== 'connecting'}
            reduced={reduced} phase={selected.phase} />
        ) : (
          <motion.div key={`empty-${selected.id}`} className="hc-server-details" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
            <div className="hc-server-details__header">
              <div className="hc-server-details__identity"><span className="hc-server-icon"><HostIcon /></span><div>
                <div className="hc-servers-eyebrow">HomeCloud · Server</div><h2>{selected.name}</h2><p>{addressLabel(selected)}</p>
                <span className="hc-server-online hc-server-online--offline"><i />{selected.phase === 'offline' ? 'Offline' : 'Ожидание данных'}</span>
              </div></div>
              <div className="hc-server-details__actions"><button type="button" className="hc-server-action" disabled={selected.phase === 'offline'} onClick={() => void refresh(selected.id)}><RefreshIcon /> Обновить</button>
                <button type="button" className="hc-server-close" onClick={close} aria-label="Назад к списку серверов">×</button></div>
            </div>
            <p className="hc-servers-message" role="status">{selected.error || 'Телеметрия этого сервера ещё не получена. Карточка остаётся в списке даже при отсутствии соединения.'}</p>
          </motion.div>
        )
      ) : (
        <motion.div key="server-overview" className="hc-servers-overview"
          initial={{ opacity: 0, x: reduced ? 0 : -14 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: reduced ? 0 : -14 }}
          transition={{ duration: reduced ? 0.1 : 0.2, ease: 'easeOut' }}>
          <div className="hc-servers-header">
            <div><div className="hc-servers-eyebrow">HomeCloud · Infrastructure</div><h2>Серверы</h2><p>Настроенные узлы HomeCloudBackend · мониторинг system.status</p></div>
            <div className="hc-servers-header__actions">
              <span className="hc-servers-count"><strong>{onlineCount}</strong> в сети из {servers.length}</span>
              <motion.button type="button" className="hc-server-action" onClick={() => { servers.filter(s => s.phase !== 'offline' && s.phase !== 'connecting').forEach(s => void refresh(s.id)); }} whileTap={reduced ? undefined : { scale: .96 }}><RefreshIcon /> Обновить</motion.button>
            </div>
          </div>
          {(pool.error || primary.refreshError) && <div role="alert" className="hc-servers-message hc-servers-message--warning">{pool.error || primary.refreshError}</div>}
          <div className="hc-servers-list">
            {servers.map(server => {
              const isOnline = server.phase === 'ready';
              const label = server.phase === 'offline' ? 'Offline' : server.phase === 'error' ? 'Ошибка данных' : server.phase === 'ready' ? 'Online' : 'Connecting';
              return <motion.button key={server.id} type="button" className="hc-server-card homecloud-glass"
                ref={element => { if (element && focusTo.current === server.id) { element.focus(); focusTo.current = null; } }}
                onClick={() => setOpenedId(server.id)} initial={{ opacity: 0, y: reduced ? 0 : 12 }} animate={{ opacity: 1, y: 0 }}
                whileHover={reduced ? undefined : { y: -3 }} whileTap={reduced ? undefined : { scale: .99 }}
                aria-label={`Информация о сервере ${server.name}, ${label}`}>
                <span className="hc-server-card__top"><span className="hc-server-icon"><HostIcon /></span>
                  <span className={['hc-server-online', server.phase === 'offline' ? 'hc-server-online--offline' : !isOnline ? 'hc-server-online--pending' : ''].filter(Boolean).join(' ')} role="status"><i />{label}</span></span>
                <span className="hc-server-card__title">{server.name}</span>
                <span className="hc-server-card__subtitle">{addressLabel(server)} · {server.data?.system?.os_family || server.data?.system?.goos || 'HomeCloudBackend'}</span>
                <span className="hc-server-card__stats"><span><small>CPU</small><strong>{percentage(server.data?.cpu?.usage_percent)}</strong></span><span><small>RAM</small><strong>{percentage(server.data?.memory?.used_percent)}</strong></span><span><small>Клиенты</small><strong>{asText(server.data?.backend?.connections)}</strong></span></span>
                {server.phase !== 'ready' && <span className="hc-server-card__last-seen">{server.data?.collected_at ? `Последние данные: ${time(server.data.collected_at)}` : server.error || 'Ожидаем телеметрию'}</span>}
                <span className="hc-server-card__footer"><span>Подробнее о сервере</span><span aria-hidden="true">↗</span></span>
              </motion.button>;
            })}
          </div>
          <footer className="hc-servers-footer">Адреса и названия редактируются в Настройки → Пул серверов · автообновление 15 с</footer>
        </motion.div>
      )}
    </AnimatePresence>
  </section>;
}
