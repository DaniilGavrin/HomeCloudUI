import { useMemo, useState } from 'react';
import {
  Activity, ArrowLeft, Cpu, HardDrive, Network, RefreshCw, Server,
  Settings2, ScrollText, Component, MemoryStick, Thermometer, Clock3,
} from 'lucide-react';
import { useHomeCloudPool, type PoolServer } from '../../hooks/useHomeCloudPool';
import type { ServerStatusData } from '../../hooks/useHomeCloudServer';
import '../../styles/system.css';

type SectionId = 'overview' | 'hardware' | 'storage' | 'services' | 'network' | 'logs' | 'updates';

const sections: Array<{ id: SectionId; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: 'Обзор', icon: Activity },
  { id: 'hardware', label: 'Оборудование', icon: Cpu },
  { id: 'storage', label: 'Хранилища', icon: HardDrive },
  { id: 'services', label: 'Службы', icon: Component },
  { id: 'network', label: 'Сеть', icon: Network },
  { id: 'logs', label: 'Журнал', icon: ScrollText },
  { id: 'updates', label: 'Обновления', icon: RefreshCw },
];

function number(value: number | undefined, digits = 0): string {
  return value === undefined || !Number.isFinite(value)
    ? '—'
    : value.toLocaleString('ru-RU', { maximumFractionDigits: digits });
}
function bytes(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '—';
  if (value === 0) return '0 Б';
  const unit = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4);
  return `${number(value / 1024 ** unit, unit ? 1 : 0)} ${['Б', 'КиБ', 'МиБ', 'ГиБ', 'ТиБ'][unit]}`;
}
function percent(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '—' : `${number(value, 1)}%`;
}
function uptime(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '—';
  const days = Math.floor(value / 86400);
  const hours = Math.floor((value % 86400) / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  return [days ? `${days} д` : '', `${hours} ч`, `${minutes} мин`].filter(Boolean).join(' ');
}
function address(server: PoolServer): string {
  return [server.ipv4, server.ipv6].filter(Boolean).join(' · ') || 'Адрес не задан';
}
function freshness(server: PoolServer): string {
  if (server.phase === 'ready') return 'Онлайн';
  if (server.phase === 'connecting') return 'Подключение';
  if (server.phase === 'error') return 'Ошибка данных';
  return 'Офлайн';
}
function diskUsage(data: ServerStatusData | null) {
  const partitions = data?.disks?.partitions ?? [];
  const total = partitions.reduce((sum, item) => sum + (item.total_bytes ?? 0), 0);
  const used = partitions.reduce((sum, item) => sum + (item.used_bytes ?? 0), 0);
  return total > 0 ? used / total * 100 : undefined;
}
function Meter({ label, value, detail }: { label: string; value?: number; detail?: string }) {
  const valid = value !== undefined && Number.isFinite(value);
  const width = valid ? Math.max(0, Math.min(100, value)) : 0;
  return <div className="hc-system-meter">
    <div className="hc-system-meter__head"><span>{label}</span><strong>{detail ?? percent(value)}</strong></div>
    <div className="hc-system-meter__track"><span style={{ width: `${width}%` }} /></div>
  </div>;
}
function Stat({ label, value, hint, icon: Icon }: { label: string; value: string; hint: string; icon: typeof Activity }) {
  return <article className="hc-system-stat">
    <div className="hc-system-stat__icon"><Icon size={18} /></div>
    <span>{label}</span><strong>{value}</strong><small>{hint}</small>
  </article>;
}
function EmptySection({ title, description }: { title: string; description: string }) {
  return <div className="hc-system-empty">
    <Settings2 size={25} />
    <h3>{title}</h3>
    <p>{description}</p>
  </div>;
}

function ServerWorkspace({ server, onBack, onRefresh }: {
  server: PoolServer; onBack: () => void; onRefresh: () => void;
}) {
  const [section, setSection] = useState<SectionId>('overview');
  const data = server.data as ServerStatusData | null;
  const cpu = data?.cpu;
  const memory = data?.memory;
  const partitions = data?.disks?.partitions ?? [];
  const interfaces = data?.network?.interfaces ?? [];
  const temperatures = data?.temperatures ?? [];
  const active = sections.find(item => item.id === section) ?? sections[0];

  return <div className="hc-system-workspace">
    <header className="hc-system-server-head">
      <button className="hc-system-back" type="button" onClick={onBack}><ArrowLeft size={17} /> Все серверы</button>
      <div className="hc-system-server-head__main">
        <div className="hc-system-server-icon"><Server size={25} /></div>
        <div className="hc-system-server-title">
          <div className="hc-system-eyebrow">УЗЕЛ HOME CLOUD</div>
          <h2>{server.name}</h2>
          <p>{data?.system?.hostname || 'Имя хоста не получено'} · {address(server)}</p>
          {data?.system?.node_id && <code>ID: {data.system.node_id}</code>}
        </div>
        <span className={`hc-system-status hc-system-status--${server.phase}`}>{freshness(server)}</span>
        <button className="hc-system-icon-button" type="button" onClick={onRefresh} disabled={server.phase !== 'ready'} title="Обновить телеметрию"><RefreshCw size={17} /></button>
      </div>
    </header>

    <div className="hc-system-detail-layout">
      <nav className="hc-system-detail-nav" aria-label="Разделы сервера">
        {sections.map(item => {
          const Icon = item.icon;
          return <button type="button" key={item.id} className={section === item.id ? 'is-active' : ''}
            onClick={() => setSection(item.id)}><Icon size={17} /><span>{item.label}</span></button>;
        })}
      </nav>

      <section className="hc-system-detail-content" aria-live="polite">
        <div className="hc-system-section-heading"><div><div className="hc-system-eyebrow">СЕРВЕР · {server.name}</div><h3>{active.label}</h3></div></div>
        {!data ? <EmptySection title="Телеметрия пока недоступна" description={server.error || 'Ожидаем первое успешное подключение к серверу.'} /> : <>
          {section === 'overview' && <>
            <div className="hc-system-metric-grid">
              <Stat label="Процессор" value={percent(cpu?.usage_percent)} hint={cpu?.model || 'Модель не определена'} icon={Cpu} />
              <Stat label="Оперативная память" value={percent(memory?.used_percent)} hint={`${bytes(memory?.used_bytes)} из ${bytes(memory?.total_bytes)}`} icon={MemoryStick} />
              <Stat label="Хранилище" value={percent(diskUsage(data))} hint={`${partitions.length} точек монтирования`} icon={HardDrive} />
              <Stat label="Время работы" value={uptime(data.system?.uptime_seconds)} hint={data.system?.platform || 'ОС не определена'} icon={Clock3} />
            </div>
            <div className="hc-system-panel-grid">
              <article className="hc-system-panel"><h4>Ресурсы</h4><Meter label="CPU" value={cpu?.usage_percent} /><Meter label="RAM" value={memory?.used_percent} detail={`${bytes(memory?.used_bytes)} / ${bytes(memory?.total_bytes)}`} /><Meter label="Диски" value={diskUsage(data)} /></article>
              <article className="hc-system-panel"><h4>Информация об узле</h4>
                <dl className="hc-system-kv"><div><dt>Операционная система</dt><dd>{data.system?.platform || data.system?.os_family || '—'}</dd></div><div><dt>Архитектура</dt><dd>{data.system?.kernel_arch || data.system?.goarch || '—'}</dd></div><div><dt>Версия ядра</dt><dd>{data.system?.kernel_version || '—'}</dd></div><div><dt>Процессы</dt><dd>{number(data.system?.process_count)}</dd></div><div><dt>Задержка</dt><dd>{server.latency_ms === null ? '—' : `${server.latency_ms} мс`}</dd></div><div><dt>Последний снимок</dt><dd>{data.collected_at ? new Date(data.collected_at).toLocaleString('ru-RU') : '—'}</dd></div></dl>
              </article>
            </div>
            {temperatures.length > 0 && <article className="hc-system-panel"><h4><Thermometer size={16} /> Температуры</h4><div className="hc-system-inline-list">{temperatures.map((item, i) => <span key={`${item.sensor}-${i}`}>{item.sensor || `Датчик ${i + 1}`} <strong>{number(item.celsius, 1)} °C</strong></span>)}</div></article>}
          </>}
          {section === 'hardware' && <div className="hc-system-panel-grid">
            <article className="hc-system-panel"><h4><Cpu size={16} /> Процессор</h4><dl className="hc-system-kv"><div><dt>Модель</dt><dd>{cpu?.model || '—'}</dd></div><div><dt>Производитель</dt><dd>{cpu?.vendor || '—'}</dd></div><div><dt>Физические ядра</dt><dd>{number(cpu?.physical_cores)}</dd></div><div><dt>Логические ядра</dt><dd>{number(cpu?.logical_cores)}</dd></div><div><dt>Частота</dt><dd>{cpu?.frequency_mhz ? `${number(cpu.frequency_mhz)} МГц` : '—'}</dd></div></dl><Meter label="Текущая загрузка" value={cpu?.usage_percent} /></article>
            <article className="hc-system-panel"><h4><MemoryStick size={16} /> Память</h4><Meter label="RAM" value={memory?.used_percent} detail={`${bytes(memory?.used_bytes)} / ${bytes(memory?.total_bytes)}`} /><Meter label="Swap" value={data.swap?.used_percent} detail={`${bytes(data.swap?.used_bytes)} / ${bytes(data.swap?.total_bytes)}`} /><dl className="hc-system-kv"><div><dt>Доступно RAM</dt><dd>{bytes(memory?.available_bytes)}</dd></div><div><dt>Свободно RAM</dt><dd>{bytes(memory?.free_bytes)}</dd></div></dl></article>
            <article className="hc-system-panel"><h4><Thermometer size={16} /> Датчики температуры</h4>{temperatures.length ? <div className="hc-system-inline-list">{temperatures.map((item, i) => <span key={`${item.sensor}-${i}`}>{item.sensor || `Датчик ${i + 1}`} <strong>{number(item.celsius, 1)} °C</strong></span>)}</div> : <p className="hc-system-muted">Система не передала доступные температурные датчики.</p>}</article>
            <article className="hc-system-panel"><h4>Операционная система</h4><dl className="hc-system-kv"><div><dt>Hostname</dt><dd>{data.system?.hostname || '—'}</dd></div><div><dt>Дистрибутив</dt><dd>{data.system?.platform || '—'}</dd></div><div><dt>Версия</dt><dd>{data.system?.platform_version || '—'}</dd></div><div><dt>Ядро</dt><dd>{data.system?.kernel_version || '—'}</dd></div><div><dt>Виртуализация</dt><dd>{data.system?.virtualization?.system || '—'}</dd></div></dl></article>
          </div>}
          {section === 'storage' && <div className="hc-system-panel"><h4>Разделы и точки монтирования</h4>{partitions.length ? <div className="hc-system-table-wrap"><table className="hc-system-table"><thead><tr><th>Точка монтирования</th><th>Устройство</th><th>Файловая система</th><th>Использовано</th><th>Свободно</th></tr></thead><tbody>{partitions.map((item, i) => <tr key={`${item.device}-${item.mountpoint}-${i}`}><td>{item.mountpoint || '—'}</td><td><code>{item.device || '—'}</code></td><td>{item.filesystem || '—'}</td><td>{item.error || `${bytes(item.used_bytes)} / ${bytes(item.total_bytes)} · ${percent(item.used_percent)}`}</td><td>{bytes(item.free_bytes)}</td></tr>)}</tbody></table></div> : <p className="hc-system-muted">Сведения о разделах не получены.</p>}</div>}
          {section === 'services' && <div className="hc-system-panel"><h4>Компоненты узла</h4><div className="hc-system-service-row"><div><strong>HomeCloud Backend</strong><small>Go · PID {number(data.backend?.pid)} · {data.backend?.go_version || 'версия Go неизвестна'}</small></div><span className="hc-system-status hc-system-status--ready">Работает</span></div><p className="hc-system-muted">Состояние Media Gateway и Storage Service пока не входит в контракт system.status. Не показываем их статус предположительно; добавим отдельные данные supervisor и регистрации служб на следующем этапе.</p></div>}
          {section === 'network' && <div className="hc-system-panel"><h4>Сетевые интерфейсы</h4>{interfaces.length ? <div className="hc-system-interface-list">{interfaces.map((item, i) => <article key={`${item.name}-${i}`}><div><strong>{item.name || `Интерфейс ${i + 1}`}</strong><span className={item.up ? 'is-up' : ''}>{item.up ? 'UP' : 'DOWN'}</span></div><p>{(item.addresses || []).join(' · ') || 'IP-адреса не получены'}</p><small>MAC: {item.mac || '—'} · MTU: {number(item.mtu)}</small><div className="hc-system-kv hc-system-kv--two"><div><dt>Отправлено</dt><dd>{bytes(item.traffic?.bytes_sent)}</dd></div><div><dt>Получено</dt><dd>{bytes(item.traffic?.bytes_received)}</dd></div></div></article>)}</div> : <p className="hc-system-muted">Сетевые интерфейсы не получены.</p>}</div>}
          {section === 'logs' && <EmptySection title="Журнал событий ещё не подключён" description="В текущем контракте Backend нет API чтения системного журнала. Для этого нужен отдельный поток событий с фильтрацией по узлу, уровню и времени." />}
          {section === 'updates' && <EmptySection title="Управление обновлениями ещё не подключено" description="Локальный CLI updater уже работает на Linux-узле, но Backend пока не предоставляет безопасный API для получения статуса и запуска обновлений из UI." />}
        </>}
      </section>
    </div>
  </div>;
}

export function SystemPage() {
  const pool = useHomeCloudPool();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const servers = pool.snapshot.servers;
  const selected = servers.find(server => server.id === selectedId) ?? null;
  const online = servers.filter(server => server.phase === 'ready');
  const cpuValues = online.map(server => server.data?.cpu?.usage_percent).filter((v): v is number => v !== undefined && Number.isFinite(v));
  const avgCpu = cpuValues.length ? cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length : undefined;
  const memoryTotal = online.reduce((sum, server) => sum + (server.data?.memory?.total_bytes ?? 0), 0);
  const memoryUsed = online.reduce((sum, server) => sum + (server.data?.memory?.used_bytes ?? 0), 0);
  const memoryPercent = memoryTotal > 0 ? memoryUsed / memoryTotal * 100 : undefined;
  const totalCores = online.reduce((sum, server) => sum + (server.data?.cpu?.logical_cores ?? 0), 0);
  const avgLatency = useMemo(() => {
    const values = online.map(server => server.latency_ms).filter((v): v is number => v !== null);
    return values.length ? `${number(values.reduce((a, b) => a + b, 0) / values.length)} мс` : '—';
  }, [online]);

  if (selected) return <ServerWorkspace server={selected} onBack={() => setSelectedId(null)} onRefresh={() => void pool.refresh(selected.id)} />;

  return <section className="hc-system-page">
    <header className="hc-system-overview-head"><div><div className="hc-system-eyebrow">HOME CLOUD INFRASTRUCTURE</div><h2>Инфраструктура</h2><p>Состояние и ресурсы всех подключённых узлов HomeCloud</p></div><div className="hc-system-overview-actions"><span>{pool.snapshot.revision >= 0 ? 'Автоматическое обновление · 15 сек' : 'Инициализация пула'}</span></div></header>
    {pool.error && <div className="hc-system-alert" role="alert">{pool.error}</div>}
    <div className="hc-system-summary">
      <Stat label="Всего серверов" value={number(servers.length)} hint={`${servers.length - online.length} не в сети`} icon={Server} />
      <Stat label="Доступно" value={number(online.length)} hint="Узлы с актуальной телеметрией" icon={Activity} />
      <Stat label="Средняя загрузка CPU" value={percent(avgCpu)} hint={`${number(totalCores)} логических ядер онлайн`} icon={Cpu} />
      <Stat label="Использование RAM" value={percent(memoryPercent)} hint={`${bytes(memoryUsed)} / ${bytes(memoryTotal)}`} icon={MemoryStick} />
    </div>
    <div className="hc-system-nodes-heading"><div><h3>Серверы и узлы</h3><p>{servers.length} в пуле · средняя задержка {avgLatency}</p></div></div>
    {servers.length === 0 ? <EmptySection title="Серверы ещё не добавлены" description="Добавь адрес Backend в разделе «Настройки → Пул серверов», чтобы узел появился в инфраструктуре." /> :
      <div className="hc-system-node-grid">{servers.map(server => {
        const data = server.data as ServerStatusData | null;
        const cpuValue = data?.cpu?.usage_percent;
        const ramValue = data?.memory?.used_percent;
        const diskValue = diskUsage(data);
        return <button type="button" className="hc-system-node-card" key={server.id} onClick={() => setSelectedId(server.id)}>
          <div className="hc-system-node-card__head"><div className="hc-system-node-icon"><Server size={21} /></div><div className="hc-system-node-card__title"><strong>{server.name}</strong><small>{data?.system?.hostname || address(server)}</small></div><span className={`hc-system-status hc-system-status--${server.phase}`}>{freshness(server)}</span></div>
          <div className="hc-system-node-card__metrics"><Meter label="Процессор" value={cpuValue} /><Meter label="Оперативная память" value={ramValue} detail={data?.memory ? `${bytes(data.memory.used_bytes)} / ${bytes(data.memory.total_bytes)}` : undefined} /><Meter label="Хранилище" value={diskValue} /></div>
          <div className="hc-system-node-card__footer"><span>{data?.system?.platform || 'ОС не определена'}</span><span>Uptime: {uptime(data?.system?.uptime_seconds)}</span></div>
          {server.phase !== 'ready' && <div className="hc-system-node-card__stale">{data?.collected_at ? `Последние данные: ${new Date(data.collected_at).toLocaleString('ru-RU')}` : server.error || 'Ожидание подключения'}</div>}
          <div className="hc-system-node-card__open">Открыть сервер <ArrowLeft size={14} /></div>
        </button>;
      })}</div>}
  </section>;
}
