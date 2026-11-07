import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
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
function Details({ data, onClose, onRefresh, canRefresh, reduced, phase, name, addresses, startAtDiagnostics }: {
  data: ServerStatusData; onClose: () => void; onRefresh: () => void; canRefresh: boolean;
  reduced: boolean; phase: 'offline' | 'loading' | 'connecting' | 'ready' | 'error'; name: string; addresses: string;
  startAtDiagnostics?: boolean;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const partitions = data.disks?.partitions ?? [];
  const network = data.network?.interfaces ?? [];
  const cpu = data.cpu;
  const backend = data.backend;
  const sys = data.system;
  const sortedIo = Object.entries(data.disks?.io_counters ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const errors = Object.entries(data.collection_errors ?? {}).sort(([a], [b]) => a.localeCompare(b));

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => {
    if (!startAtDiagnostics) return;
    const frame = window.requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      const target = scroller?.querySelector<HTMLElement>('#hc-server-process');
      if (!scroller || !target) return;
      const offset = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      scroller.scrollTo({ top: Math.max(0, offset - 8), behavior: 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [startAtDiagnostics]);
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
    <div className="hc-server-details__scroll" ref={scrollRef}>
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


function statusLabel(phase: DisplayServer['phase']) {
  if (phase === 'ready') return 'Online';
  if (phase === 'offline') return 'Offline';
  if (phase === 'error') return 'Ошибка данных';
  return 'Connecting';
}

function loadWidth(value: number | undefined) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value!)) : 0;
}

function nodeCount(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  const word = mod100 >= 11 && mod100 <= 14 ? 'узлов'
    : mod10 === 1 ? 'узел' : mod10 >= 2 && mod10 <= 4 ? 'узла' : 'узлов';
  return `${value} ${word}`;
}

function coreCount(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  const word = mod100 >= 11 && mod100 <= 14 ? 'ядер'
    : mod10 === 1 ? 'ядро' : mod10 >= 2 && mod10 <= 4 ? 'ядра' : 'ядер';
  return `${value} ${word}`;
}

export function ServersPage() {
  const pool = useHomeCloudPool();
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', ipv4: '', ipv6: '' });
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const focusTo = useRef<string | null>(null);
  const reduced = Boolean(useReducedMotion());

  // All Backend nodes are user-configured and have equivalent Rust WS sessions.
  const servers: DisplayServer[] = pool.snapshot.servers;
  const selected = servers.find(server => server.id === openedId);

  const closeDetails = useCallback(() => {
    focusTo.current = openedId;
    setOpenedId(null);
    setDiagnostics(false);
  }, [openedId]);

  const refresh = useCallback(async (id: string) => {
    await pool.refresh(id);
  }, [pool.refresh]);

  useEffect(() => {
    if (!openedId && !adding) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Backspace') return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]')) return;
      event.preventDefault();
      if (adding && !saving) { setAdding(false); setActionError(null); }
      else if (openedId) closeDetails();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openedId, adding, saving, closeDetails]);

  const showDetails = (id: string, toDiagnostics = false) => {
    setDiagnostics(toDiagnostics);
    setOpenedId(id);
  };

  const submitNewServer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setActionError(null);
    try {
      await pool.add({
        name: form.name.trim(),
        ipv4: form.ipv4.trim() || null,
        ipv6: form.ipv6.trim() || null,
      });
      setAdding(false);
      setForm({ name: '', ipv4: '', ipv6: '' });
    } catch (error) {
      setActionError(String(error));
    } finally {
      setSaving(false);
    }
  };

  // Aggregate live server measurements only. Cached telemetry on Offline nodes
  // remains on their cards but is deliberately excluded from pool-wide KPIs.
  const online = servers.filter(server => server.phase === 'ready' || server.phase === 'loading');
  const onlineCount = online.length;
  const cores = online.reduce((sum, server) => sum + (server.data?.cpu?.logical_cores ?? 0), 0);
  const memoryTotal = online.reduce((sum, server) => sum + (server.data?.memory?.total_bytes ?? 0), 0);
  const memoryUsed = online.reduce((sum, server) => sum + (server.data?.memory?.used_bytes ?? 0), 0);
  const pings = online.map(server => server.latency_ms)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  const averagePing = pings.length
    ? `${numeric(pings.reduce((sum, value) => sum + value, 0) / pings.length)} мс`
    : '—';

  const status = (server: DisplayServer) => (
    <span className={[
      'hc-server-online',
      server.phase === 'offline' ? 'hc-server-online--offline' : '',
      server.phase !== 'ready' && server.phase !== 'offline' ? 'hc-server-online--pending' : '',
    ].filter(Boolean).join(' ')}>
      <i aria-hidden="true" />{statusLabel(server.phase)}
    </span>
  );

  return <section className="hc-servers-page homecloud-glass" aria-label="Серверы HomeCloud">
    <AnimatePresence mode="wait" initial={false}>
      {adding ? (
        <motion.div key="add-server" className="hc-server-add-page"
          initial={{ opacity: 0, x: reduced ? 0 : 16 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: reduced ? 0 : 16 }}
          transition={{ duration: reduced ? .08 : .2 }}>
          <div className="hc-server-add-page__header">
            <button type="button" className="hc-server-action" disabled={saving}
              onClick={() => { setAdding(false); setActionError(null); }}>
              ← Назад к серверам
            </button>
            <div className="hc-servers-eyebrow">HomeCloud · Server Pool</div>
            <h2>Добавить сервер</h2>
            <p>Добавление узла в общий пул по IPv4 или IPv6. Порт HomeCloudBackend — 8080.</p>
          </div>
          <form className="hc-server-add-form homecloud-glass" onSubmit={event => void submitNewServer(event)}>
            <label>Название сервера
              <input autoFocus required maxLength={64} value={form.name} placeholder="Например, HomeCloud Mini"
                onChange={event => setForm(current => ({ ...current, name: event.target.value }))}/>
            </label>
            <div className="hc-server-add-form__pair">
              <label>IPv4-адрес
                <input inputMode="decimal" value={form.ipv4} placeholder="192.168.1.100"
                  onChange={event => setForm(current => ({ ...current, ipv4: event.target.value }))}/>
              </label>
              <label>IPv6-адрес
                <input value={form.ipv6} placeholder="2001:db8::10"
                  onChange={event => setForm(current => ({ ...current, ipv6: event.target.value }))}/>
              </label>
            </div>
            <p className="hc-server-add-form__hint">Укажи хотя бы один сетевой адрес. Узлы в другой сети можно подключать через Tailscale.</p>
            {actionError && <p className="hc-servers-message hc-servers-message--warning" role="alert">{actionError}</p>}
            <div className="hc-server-add-form__actions">
              <button className="hc-server-action" type="button" disabled={saving}
                onClick={() => { setAdding(false); setActionError(null); }}>Отмена</button>
              <button className="hc-server-action hc-server-action--accent" type="submit" disabled={saving || !form.name.trim() || (!form.ipv4.trim() && !form.ipv6.trim())}>
                {saving ? 'Сохранение…' : 'Добавить сервер'}
              </button>
            </div>
          </form>
        </motion.div>
      ) : selected ? (
        selected.data ? (
          <Details key={`details-${selected.id}`} data={selected.data} name={selected.name}
            addresses={addressLabel(selected)} onClose={closeDetails}
            onRefresh={() => void refresh(selected.id).catch(error => setActionError(String(error)))}
            canRefresh={selected.phase !== 'offline' && selected.phase !== 'connecting'}
            reduced={reduced} phase={selected.phase} startAtDiagnostics={diagnostics}/>
        ) : (
          <motion.div key={`empty-${selected.id}`} className="hc-server-details"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="hc-server-details__header">
              <div className="hc-server-details__identity">
                <span className="hc-server-icon"><HostIcon /></span>
                <div>
                  <div className="hc-servers-eyebrow">HomeCloud · Server</div>
                  <h2>{selected.name}</h2>
                  <p>{addressLabel(selected)}</p>
                  {status(selected)}
                </div>
              </div>
              <div className="hc-server-details__actions">
                <button type="button" className="hc-server-action" disabled={selected.phase === 'offline'}
                  onClick={() => void refresh(selected.id).catch(error => setActionError(String(error)))}>
                  <RefreshIcon /> Обновить
                </button>
                <button type="button" className="hc-server-close" onClick={closeDetails} aria-label="Назад к списку серверов">×</button>
              </div>
            </div>
            <p className="hc-servers-message" role="status">
              {selected.error || 'Телеметрия ещё не получена. Сервер останется в списке при отключении.'}
            </p>
            {actionError && <p className="hc-servers-message hc-servers-message--warning" role="alert">{actionError}</p>}
          </motion.div>
        )
      ) : (
        <motion.div key="server-overview" className="hc-servers-overview"
          initial={{ opacity: 0, x: reduced ? 0 : -12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: reduced ? 0 : -12 }}
          transition={{ duration: reduced ? .08 : .2 }}>
          <header className="hc-servers-header">
            <div>
              <div className="hc-servers-eyebrow">Infrastructure / Nodes</div>
              <h2>Серверы HomeCloud</h2>
              <p>Мониторинг узлов, ресурсы и доступность всей распределённой системы.</p>
            </div>
          </header>

          <div className="hc-servers-summary" aria-label="Сводные показатели серверов">
            <div className="hc-server-summary-card homecloud-glass">
              <span>В пуле</span>
              <strong>{nodeCount(servers.length)}</strong>
              <small><b>{onlineCount} Online</b> · {servers.length - onlineCount} Offline / Connecting</small>
            </div>
            <div className="hc-server-summary-card homecloud-glass">
              <span>Общее CPU</span>
              <strong>{cores > 0 ? coreCount(cores) : '—'}</strong>
              <small>По доступным узлам</small>
            </div>
            <div className="hc-server-summary-card homecloud-glass">
              <span>Оперативная память</span>
              <strong>{memoryTotal > 0 ? bytes(memoryTotal) : '—'}</strong>
              <small>{memoryTotal > 0 ? `Используется ${bytes(memoryUsed)}` : 'Нет измерений'}</small>
            </div>
            <div className="hc-server-summary-card homecloud-glass">
              <span>Средний ping</span>
              <strong>{averagePing}</strong>
              <small>{pings.length ? `По ${pings.length} соединениям` : 'Нет измерений'}</small>
            </div>
          </div>

          <div className="hc-servers-subheading">
            <h3>Все серверы</h3>
            <button type="button" className="hc-servers-add-link" onClick={() => { setActionError(null); setAdding(true); }}>
              <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14"/></svg>
              Добавить сервер
            </button>
          </div>
          {(pool.error || actionError) && <p className="hc-servers-message hc-servers-message--warning" role="alert">
            {pool.error || actionError}
          </p>}

          <div className="hc-servers-list">
            {servers.map((server, index) => {
              const isOnline = server.phase === 'ready' || server.phase === 'loading';
              const os = server.data?.system?.platform || server.data?.system?.os_family || server.data?.system?.goos || 'HomeCloudBackend';
              const data = server.data;
              return <motion.article key={server.id}
                className={`hc-server-card homecloud-glass hc-server-card--accent-${index % 3}`}
                initial={{ opacity: 0, y: reduced ? 0 : 10 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={reduced ? undefined : { y: -2 }}
                transition={{ duration: reduced ? .08 : .2 }}>
                <div className="hc-server-card__identity">
                  <span className="hc-server-icon"><HostIcon /></span>
                  <span className="hc-server-card__identity-text">
                    <strong className="hc-server-card__title">{server.name}</strong>
                    <span className="hc-server-card__subtitle">{os}</span>
                  </span>
                </div>
                <div className="hc-server-card__status">{status(server)}</div>
                <div className="hc-server-card__divider"/>
                <div className="hc-server-card__metrics">
                  <div className="hc-server-card__metric">
                    <div className="hc-server-card__metric-label"><span>CPU · {percentage(data?.cpu?.usage_percent)}</span></div>
                    <div className="hc-server-card__metric-track" role="meter" aria-label={`CPU ${server.name}`}
                      aria-valuemin={0} aria-valuemax={100} aria-valuenow={data?.cpu?.usage_percent === undefined ? undefined : loadWidth(data.cpu.usage_percent)}>
                      <span className="hc-server-card__metric-fill" style={{width: `${loadWidth(data?.cpu?.usage_percent)}%`}}/>
                    </div>
                  </div>
                  <div className="hc-server-card__metric">
                    <div className="hc-server-card__metric-label"><span>RAM · {data?.memory?.total_bytes ? `${bytes(data.memory.used_bytes)} / ${bytes(data.memory.total_bytes)}` : '—'}</span></div>
                    <div className="hc-server-card__metric-track" role="meter" aria-label={`RAM ${server.name}`}
                      aria-valuemin={0} aria-valuemax={100} aria-valuenow={data?.memory?.used_percent === undefined ? undefined : loadWidth(data.memory.used_percent)}>
                      <span className="hc-server-card__metric-fill hc-server-card__metric-fill--memory" style={{width: `${loadWidth(data?.memory?.used_percent)}%`}}/>
                    </div>
                  </div>
                </div>
                <div className="hc-server-card__meta">
                  <div><span>Uptime</span><strong>{uptime(data?.system?.uptime_seconds)}</strong></div>
                  <div><span>Задержка</span><strong>{isOnline && server.latency_ms !== null ? `${numeric(server.latency_ms)} мс` : '—'}</strong></div>
                </div>
                <div className="hc-server-card__actions">
                  <button ref={el => { if (el && focusTo.current === server.id) { el.focus(); focusTo.current = null; } }}
                    type="button" className="hc-server-card__button hc-server-card__button--primary"
                    onClick={() => showDetails(server.id)}>Подробнее</button>
                  <button type="button" className="hc-server-card__button hc-server-card__button--secondary"
                    onClick={() => showDetails(server.id, true)}>Диагностика</button>
                </div>
                {!isOnline && <div className="hc-server-card__last-seen">
                  {data?.collected_at ? `Последние данные: ${time(data.collected_at)}` : server.error || 'Ожидание данных'}
                </div>}
              </motion.article>;
            })}
          </div>
          <footer className="hc-servers-footer">Состояние серверов обновляется автоматически · настройки адресов в разделе «Настройки → Пул серверов»</footer>
        </motion.div>
      )}
    </AnimatePresence>
  </section>;
}
