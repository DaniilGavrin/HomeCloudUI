import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Activity, Cpu, HardDrive, MemoryStick, Network, RefreshCw, Server, ShieldCheck, Workflow } from 'lucide-react';
import { useHomeCloudPool, type MetricSample, type MetricsSnapshot } from '../../hooks/useHomeCloudPool';
import '../../styles/system.css';

type Tab = 'overview' | 'cpu' | 'memory' | 'disks' | 'network' | 'processes' | 'services' | 'diagnostics';
type Point = { timestamp?: string | number; value?: number; labels?: Record<string, string> };
type History = { points?: Point[] };
const tabs: Array<{ id: Tab; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: 'Обзор', icon: Activity }, { id: 'cpu', label: 'Процессор', icon: Cpu },
  { id: 'memory', label: 'Память', icon: MemoryStick }, { id: 'disks', label: 'Диски', icon: HardDrive },
  { id: 'network', label: 'Сеть', icon: Network }, { id: 'processes', label: 'Процессы', icon: Workflow },
  { id: 'services', label: 'Службы', icon: Server }, { id: 'diagnostics', label: 'Диагностика', icon: ShieldCheck },
];
const ranges = [
  { id: '1h', label: '1 час', ms: 3600000, resolution: 1000 },
  { id: '6h', label: '6 часов', ms: 21600000, resolution: 10000 },
  { id: '24h', label: '24 часа', ms: 86400000, resolution: 10000 },
  { id: '7d', label: '7 дней', ms: 604800000, resolution: 60000 },
] as const;
function fmt(value?: number, digits = 1) { return value === undefined || !Number.isFinite(value) ? '—' : value.toLocaleString('ru-RU', { maximumFractionDigits: digits }); }
function bytes(value?: number) {
  if (value === undefined || !Number.isFinite(value) || value < 0) return '—';
  if (!value) return '0 Б';
  const units = ['Б', 'КиБ', 'МиБ', 'ГиБ', 'ТиБ'];
  const i = Math.min(Math.floor(Math.log(value) / Math.log(1024)), 4);
  return fmt(value / 1024 ** i, i ? 2 : 0) + ' ' + units[i];
}
function uptime(value?: number) {
  if (value === undefined) return '—';
  const d = Math.floor(value / 86400), h = Math.floor(value % 86400 / 3600), m = Math.floor(value % 3600 / 60);
  return (d ? d + ' д ' : '') + h + ' ч ' + m + ' мин';
}
function mergeMetrics(previous: MetricsSnapshot | null, incoming: MetricsSnapshot): MetricsSnapshot {
  const merged = new Map<string, MetricSample>();
  for (const item of previous?.samples ?? []) {
    const labels = Object.entries(item.labels ?? {}).sort(([a], [b]) => a.localeCompare(b));
    merged.set(item.node_id + '|' + item.name + '|' + JSON.stringify(labels), item);
  }
  for (const item of incoming.samples ?? []) {
    const labels = Object.entries(item.labels ?? {}).sort(([a], [b]) => a.localeCompare(b));
    merged.set(item.node_id + '|' + item.name + '|' + JSON.stringify(labels), item);
  }
  return {
    ...previous,
    ...incoming,
    samples: [...merged.values()],
    stats: { ...(previous?.stats ?? {}), ...(incoming.stats ?? {}) },
  };
}
function sample(samples: MetricSample[], name: string) { return [...samples].reverse().find(s => s.name === name); }
function prefixSample(samples: MetricSample[], prefix: string) { return [...samples].reverse().find(s => s.name.startsWith(prefix)); }
function Card({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return <section className="hc-system-card homecloud-glass"><header><h3>{title}</h3>{hint && <span>{hint}</span>}</header>{children}</section>;
}
function Kpi({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return <article className="hc-system-kpi homecloud-glass"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</article>;
}
function Bar({ label, value, detail }: { label: string; value?: number; detail?: string }) {
  const valid = value !== undefined && Number.isFinite(value);
  return <div className="hc-system-bar"><div><span>{label}</span><b>{valid ? fmt(value) + '%' : 'Нет данных'}</b></div><div className="hc-system-bar__track"><i style={{ width: (valid ? Math.max(0, Math.min(100, value)) : 0) + '%' }} /></div>{detail && <small>{detail}</small>}</div>;
}
function Chart({ points, unit }: { points: Point[]; unit?: string }) {
  const groups = new Map<string, { label: string; points: Point[] }>();
  for (const point of points) {
    if (typeof point.value !== 'number' || !Number.isFinite(point.value)) continue;
    const label = point.labels && Object.keys(point.labels).length
      ? Object.entries(point.labels).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => key + '=' + value).join(' · ')
      : 'Общее';
    const group = groups.get(label) ?? { label, points: [] };
    group.points.push(point);
    groups.set(label, group);
  }
  const series = [...groups.values()]
    .map(group => ({ ...group, points: group.points.sort((a, b) => {
      const ta = typeof a.timestamp === 'number' ? a.timestamp : Date.parse(a.timestamp || '');
      const tb = typeof b.timestamp === 'number' ? b.timestamp : Date.parse(b.timestamp || '');
      return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
    }) }))
    .filter(group => group.points.length >= 2)
    .slice(0, 8);
  const values = series.flatMap(group => group.points.map(point => point.value as number));
  if (values.length < 2) return <p className="hc-system-muted">Недостаточно исторических точек для графика.</p>;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const timestamps = series.flatMap(group => group.points.map((point, index) => {
    const raw = point.timestamp;
    const parsed = typeof raw === 'number' ? raw : Date.parse(raw || '');
    return Number.isFinite(parsed) ? parsed : index;
  }));
  const minTime = Math.min(...timestamps), timeSpan = Math.max(...timestamps) - minTime || 1;
  const colors = ['#5bd8ed', '#a99bff', '#74dfa8', '#f3bf72', '#ef91b1', '#8cb9ff', '#c5d879', '#d0a4ef'];
  const paths = series.map((group, index) => {
    const path = group.points.map((point, pointIndex) => {
      const raw = point.timestamp;
      const parsed = typeof raw === 'number' ? raw : Date.parse(raw || '');
      const time = Number.isFinite(parsed) ? parsed : pointIndex;
      const x = 8 + (time - minTime) / timeSpan * 984;
      const y = 12 + (1 - ((point.value as number) - min) / span) * 176;
      return (pointIndex ? 'L' : 'M') + ' ' + x.toFixed(1) + ' ' + y.toFixed(1);
    }).join(' ');
    return { label: group.label, path, color: colors[index] };
  });
  const latest = series[0].points[series[0].points.length - 1].value;
  return <div className="hc-system-chart">
    <div><strong>{fmt(latest)}{unit || ''}</strong><span>Последнее значение · минимум {fmt(min)} · максимум {fmt(max)}</span></div>
    <div className="hc-system-chart__legend">{paths.map((item, index) => <span key={index}><i style={{ background: item.color }}/>{item.label}</span>)}</div>
    <svg viewBox="0 0 1000 200" preserveAspectRatio="none" role="img" aria-label="История метрики">
      <path d="M8 56 H992 M8 100 H992 M8 144 H992" className="hc-system-chart__grid"/>
      {paths.map((item, index) => <path key={index} d={item.path} className="hc-system-chart__line" style={{ stroke: item.color }}/>)}
    </svg>
  </div>;
}

function MetricGroup({ title, prefix, samples }: { title: string; prefix: string; samples: MetricSample[] }) {
  const items = samples.filter(item => item.name.startsWith(prefix)).slice(0, 12);
  return <section className="hc-system-metric-group"><h4>{title}</h4>
    {items.length ? items.map((item, index) => <div className="hc-system-row" key={index}>
      <span>{item.name}{item.labels ? ' · ' + Object.entries(item.labels).map(([key, value]) => key + '=' + value).join(', ') : ''}</span>
      <b>{fmt(item.value)} {item.unit || ''}</b>
    </div>) : <p className="hc-system-muted">Нет данных</p>}
  </section>;
}

export function SystemPage() {
  const pool = useHomeCloudPool();
  const servers = pool.snapshot.servers;
  const [serverId, setServerId] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [rangeId, setRangeId] = useState<(typeof ranges)[number]['id']>('1h');
  const [points, setPoints] = useState<Point[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [metrics, setMetrics] = useState<MetricsSnapshot | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  useEffect(() => {
    if (!servers.length) { setServerId(''); return; }
    if (!servers.some(s => s.id === serverId)) setServerId(servers.find(s => s.phase === 'ready')?.id ?? servers[0].id);
  }, [servers, serverId]);

  const selected = servers.find(s => s.id === serverId) ?? null;
  useEffect(() => {
    let live = true;
    let eventReceived = false;
    let unlisten: (() => void) | undefined;
    setMetrics(null);
    setMetricsError(null);
    if (!serverId) return;
    void (async () => {
      try {
        unlisten = await listen<{ server_id: string; metrics: MetricsSnapshot }>('homecloud:server-metrics', event => {
          if (live && event.payload.server_id === serverId) {
            eventReceived = true;
            setMetrics(previous => mergeMetrics(previous, event.payload.metrics));
          }
        });
        if (!live) { unlisten(); return; }
        const initial = await invoke<MetricsSnapshot | null>('homecloud_metrics_status', { serverId });
        if (live && !eventReceived) setMetrics(initial);
      } catch (error) {
        if (live) setMetricsError(String(error));
      }
    })();
    return () => { live = false; unlisten?.(); };
  }, [serverId]);
  useEffect(() => {
    if (!serverId) return;
    setMetrics(null);
    setMetricsError(null);
    void invoke('homecloud_metrics_set_group', { serverId, group: tab })
      .catch(error => setMetricsError(String(error)));
  }, [serverId, tab]);

  const data = selected?.data ?? null;
  const samples = metrics?.samples ?? [];
  const activeMetric = useMemo(() => {
    if (tab === 'overview' || tab === 'cpu') return sample(samples, 'cpu.usage_percent');
    if (tab === 'memory') return sample(samples, 'memory.used_percent');
    if (tab === 'disks') return prefixSample(samples, 'disk.');
    if (tab === 'network') return prefixSample(samples, 'network.');
    if (tab === 'processes') return prefixSample(samples, 'process.');
    if (tab === 'services') return prefixSample(samples, 'services.');
    return undefined;
  }, [samples, tab]);

  useEffect(() => {
    let live = true;
    if (!selected || !activeMetric?.node_id) { setPoints([]); setHistoryError(null); setHistoryLoading(false); return; }
    const range = ranges.find(r => r.id === rangeId) ?? ranges[0];
    const to = new Date(), from = new Date(to.getTime() - range.ms);
    setHistoryLoading(true); setHistoryError(null);
    void invoke<History>('homecloud_metrics_query', {
      serverId: selected.id, nodeId: activeMetric.node_id, metric: activeMetric.name,
      from: from.toISOString(), to: to.toISOString(), resolutionMs: range.resolution, limit: 2000,
    }).then(result => { if (live) setPoints(Array.isArray(result.points) ? result.points : []); })
      .catch(error => { if (live) { setPoints([]); setHistoryError(String(error)); } })
      .finally(() => { if (live) setHistoryLoading(false); });
    return () => { live = false; };
  }, [selected?.id, activeMetric?.node_id, activeMetric?.name, rangeId]);

  const refresh = async () => {
    if (!selected || refreshing) return;
    setRefreshing(true);
    try { await pool.refresh(selected.id); } catch (error) { setHistoryError(String(error)); }
    finally { setRefreshing(false); }
  };

  const cpu = data?.cpu, memory = data?.memory, swap = data?.swap;
  const disks = data?.disks?.partitions ?? [], interfaces = data?.network?.interfaces ?? [];
  const temperatures = data?.temperatures ?? [], errors = data?.collection_errors ?? {};
  const backend = data?.backend, stats = metrics?.stats ?? {};
  const rangeControls = <div className="hc-system-ranges">{ranges.map(r => <button key={r.id} className={rangeId === r.id ? 'is-active' : ''} onClick={() => setRangeId(r.id)} type="button">{r.label}</button>)}</div>;
  const historyPanel = <Card title="История метрики" hint={activeMetric?.name || 'Метрика не получена'}>
    <div className="hc-system-history-head">{rangeControls}</div>
    {historyLoading ? <p className="hc-system-muted">Загрузка истории…</p> : historyError ? <p className="hc-system-error">{historyError}</p> : <Chart points={points} unit={activeMetric?.unit}/>}
  </Card>;

  return <section className="hc-system-page" aria-label="Мониторинг системы">
    <header className="hc-system-header"><div><p className="hc-system-eyebrow">HOME CLOUD / MONITORING</p><h2>Мониторинг системы</h2><p>Ресурсы, производительность и состояние выбранного узла</p></div>
      <div className="hc-system-controls"><label><Server size={17}/><select aria-label="Выбрать сервер" value={serverId} disabled={!servers.length} onChange={e => setServerId(e.target.value)}>{servers.length ? servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>) : <option value="">Нет серверов в пуле</option>}</select></label>
        <button type="button" onClick={() => void refresh()} disabled={!selected || refreshing}><RefreshCw size={16}/>Обновить</button></div>
    </header>
    {!selected ? <div className="hc-system-empty homecloud-glass"><Server size={32}/><h3>Нет серверов для мониторинга</h3><p>Добавь Backend в разделе «Серверы».</p></div> : <>
      <div className="hc-system-nodebar homecloud-glass"><i className={selected.phase === 'ready' ? 'is-online' : ''}/><strong>{selected.name}</strong><span>{selected.phase === 'ready' ? 'Online' : selected.phase === 'connecting' ? 'Подключение' : selected.phase === 'error' ? 'Ошибка' : 'Offline'}</span><small>{data?.system?.hostname || 'Узел'} · {data?.system?.platform || data?.system?.os_family || 'ОС не определена'}</small><small>{data?.collected_at ? 'Обновлено ' + new Date(data.collected_at).toLocaleTimeString('ru-RU') : 'Ожидание телеметрии'}</small></div>
      <nav className="hc-system-tabs" aria-label="Вкладки мониторинга">{tabs.map(t => { const Icon = t.icon; return <button key={t.id} type="button" className={tab === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)}><Icon size={17}/><span>{t.label}</span></button>; })}</nav>
      {selected.phase !== 'ready' && <p className="hc-system-notice">Узел не в состоянии Online. Отображаются последние полученные данные, если они есть.</p>}
      {metricsError && <p className="hc-system-notice" role="alert">Не удалось получить телеметрию: {metricsError}</p>}

      {tab === 'overview' && <>
        <div className="hc-system-kpis"><Kpi label="CPU" value={cpu?.usage_percent === undefined ? '—' : fmt(cpu.usage_percent) + '%'} detail={cpu?.model || 'Модель не определена'}/><Kpi label="RAM" value={memory?.used_percent === undefined ? '—' : fmt(memory.used_percent) + '%'} detail={bytes(memory?.used_bytes) + ' / ' + bytes(memory?.total_bytes)}/><Kpi label="Разделы дисков" value={String(disks.length)} detail="Обнаружено"/><Kpi label="Uptime" value={uptime(data?.system?.uptime_seconds)} detail={data?.system?.hostname || 'Время работы узла'}/></div>
        {historyPanel}
        <div className="hc-system-grid"><Card title="Использование ресурсов"><Bar label="CPU" value={cpu?.usage_percent}/><Bar label="RAM" value={memory?.used_percent} detail={bytes(memory?.available_bytes) + ' доступно'}/><Bar label="Swap" value={swap?.used_percent} detail={bytes(swap?.used_bytes) + ' / ' + bytes(swap?.total_bytes)}/></Card>
          <Card title="Температурные датчики">{temperatures.length ? temperatures.map((t,i) => <div className="hc-system-row" key={i}><span>{t.sensor || 'Датчик ' + (i+1)}</span><b>{t.celsius === undefined ? '—' : fmt(t.celsius) + ' °C'}</b></div>) : <p className="hc-system-muted">Нет данных о температурных датчиках.</p>}</Card></div>
      </>}

      {tab === 'cpu' && <><div className="hc-system-grid"><Card title="Процессор" hint={cpu?.model}><div className="hc-system-facts"><div><span>Производитель</span><b>{cpu?.vendor || '—'}</b></div><div><span>Физические ядра</span><b>{fmt(cpu?.physical_cores,0)}</b></div><div><span>Логические ядра</span><b>{fmt(cpu?.logical_cores,0)}</b></div><div><span>Частота</span><b>{cpu?.frequency_mhz === undefined ? '—' : fmt(cpu.frequency_mhz,0) + ' МГц'}</b></div><div><span>Load average</span><b>{data?.load_average ? [data.load_average.one_minute,data.load_average.five_minutes,data.load_average.fifteen_minutes].map(v=>fmt(v,2)).join(' / ') : '—'}</b></div></div><Bar label="Общая загрузка" value={cpu?.usage_percent}/>{cpu?.usage_per_core_percent?.map((v,i)=><Bar key={i} label={'Ядро ' + (i+1)} value={v}/>)}</Card><Card title="Температуры">{temperatures.length ? temperatures.map((t,i)=><div className="hc-system-row" key={i}><span>{t.sensor || 'Датчик '+(i+1)}</span><b>{t.celsius === undefined ? '—' : fmt(t.celsius)+' °C'}</b></div>) : <p className="hc-system-muted">Нет доступных датчиков.</p>}</Card></div>{historyPanel}</>}

      {tab === 'memory' && <><div className="hc-system-grid"><Card title="Оперативная память"><Bar label="RAM" value={memory?.used_percent} detail={bytes(memory?.used_bytes)+' из '+bytes(memory?.total_bytes)}/><div className="hc-system-facts"><div><span>Доступно</span><b>{bytes(memory?.available_bytes)}</b></div><div><span>Свободно</span><b>{bytes(memory?.free_bytes)}</b></div></div></Card><Card title="Swap"><Bar label="Подкачка" value={swap?.used_percent} detail={bytes(swap?.used_bytes)+' из '+bytes(swap?.total_bytes)}/><div className="hc-system-facts"><div><span>Свободно</span><b>{bytes(swap?.free_bytes)}</b></div><div><span>Всего</span><b>{bytes(swap?.total_bytes)}</b></div></div></Card></div>{historyPanel}</>}

      {tab === 'disks' && <Card title="Накопители и файловые системы" hint="Разделы, точки монтирования и заполнение">{disks.length ? <div className="hc-system-table-wrap"><table><thead><tr><th>Устройство</th><th>Монтирование</th><th>ФС</th><th>Использовано</th><th>Свободно</th></tr></thead><tbody>{disks.map((d,i)=><tr key={i}><td>{d.device || '—'}</td><td>{d.mountpoint || '—'}</td><td>{d.filesystem || '—'}</td><td><b>{d.used_percent === undefined ? '—' : fmt(d.used_percent)+'%'}</b><small>{bytes(d.used_bytes)} / {bytes(d.total_bytes)}</small></td><td>{bytes(d.free_bytes)}</td></tr>)}</tbody></table></div> : <p className="hc-system-muted">Разделы дисков не получены.</p>}<h4>Счётчики I/O</h4>{Object.entries(data?.disks?.io_counters ?? {}).map(([name,io])=><div className="hc-system-row" key={name}><span>{name}</span><b>Чтение {bytes(io.read_bytes)} · Запись {bytes(io.write_bytes)}</b></div>)}</Card>}{historyPanel}

      {tab === 'network' && <Card title="Сетевые интерфейсы" hint="Адреса и сетевые счётчики">{interfaces.length ? interfaces.map((n,i)=><article className="hc-system-network" key={i}><div><strong>{n.name || 'Интерфейс '+(i+1)}</strong><b className={n.up ? 'is-online' : 'is-offline'}>{n.up ? 'UP' : 'DOWN'}</b></div><p>{n.addresses?.join(' · ') || 'IP-адреса не получены'}</p><div className="hc-system-facts"><div><span>Получено</span><b>{bytes(n.traffic?.bytes_received)}</b></div><div><span>Отправлено</span><b>{bytes(n.traffic?.bytes_sent)}</b></div><div><span>MTU</span><b>{fmt(n.mtu,0)}</b></div><div><span>MAC</span><b>{n.mac || '—'}</b></div></div></article>) : <p className="hc-system-muted">Сетевые интерфейсы не получены.</p>}</Card>}{historyPanel}

      {tab === 'processes' && <div className="hc-system-grid"><Card title="Процессы узла"><Kpi label="Всего процессов" value={fmt(data?.system?.process_count,0)}/>{samples.filter(s=>s.name.startsWith('process.')).slice(0,40).map((s,i)=><div className="hc-system-row" key={i}><span>{s.name}{s.labels ? ' · '+Object.entries(s.labels).map(([k,v])=>k+'='+v).join(', ') : ''}</span><b>{fmt(s.value)} {s.unit || ''}</b></div>)}{!samples.some(s=>s.name.startsWith('process.')) && <p className="hc-system-muted">Backend пока не предоставил детальные process.* метрики.</p>}</Card><Card title="Процесс Backend" hint="Go runtime"><div className="hc-system-facts"><div><span>PID</span><b>{fmt(backend?.pid,0)}</b></div><div><span>Goroutines</span><b>{fmt(backend?.goroutines,0)}</b></div><div><span>Threads</span><b>{fmt(backend?.threads,0)}</b></div><div><span>Go heap</span><b>{bytes(backend?.go_heap?.allocated_bytes)}</b></div><div><span>RSS</span><b>{bytes(backend?.process_memory?.rss_bytes)}</b></div><div><span>GC cycles</span><b>{fmt(backend?.go_heap?.gc_cycles,0)}</b></div></div></Card></div>}{historyPanel}

      {tab === 'services' && <Card title="Метрики служб" hint="Доступность, опубликованная Backend">{samples.filter(s=>s.name.startsWith('services.')).length ? samples.filter(s=>s.name.startsWith('services.')).map((s,i)=>{ const isBoolean = s.unit === 'boolean'; const available = s.value !== 0; return <div className="hc-system-row" key={i}><span>{s.labels?.service || s.name}</span><b>{isBoolean ? (available ? 'Доступна' : 'Недоступна') : fmt(s.value) + (s.unit ? ' ' + s.unit : '')}</b></div>; }) : <p className="hc-system-muted">Метрики служб ещё не получены.</p>}</Card>}{historyPanel}

      {tab === 'diagnostics' && <>
        <div className="hc-system-grid"><Card title="Ошибки сборщиков" hint="Последний system.status">{Object.keys(errors).length ? Object.entries(errors).map(([name,error])=><div className="hc-system-row is-warning" key={name}><span>{name}</span><b>{error}</b></div>) : <p className="hc-system-success"><ShieldCheck size={17}/> Ошибок сборщиков не сообщено.</p>}</Card><Card title="Metrics History" hint="Счётчики подсистемы">{Object.entries(stats).length ? Object.entries(stats).map(([name,value])=><div className="hc-system-row" key={name}><span>{name.replace(/_/g, ' ')}</span><b>{fmt(value,0)}</b></div>) : <p className="hc-system-muted">Статистика истории ещё не получена.</p>}</Card></div>
        <Card title="Аппаратные и системные метрики" hint="SMART, GPU, вентиляторы, pressure и kernel">
          <div className="hc-system-metric-groups">
            <MetricGroup title="SMART" prefix="smart." samples={samples}/>
            <MetricGroup title="CPU frequency" prefix="cpu_frequency." samples={samples}/>
            <MetricGroup title="Disk inventory" prefix="disk_inventory." samples={samples}/>
            <MetricGroup title="Host" prefix="host." samples={samples}/>
            <MetricGroup title="System" prefix="system." samples={samples}/>
            <MetricGroup title="GPU" prefix="gpu." samples={samples}/>
            <MetricGroup title="Вентиляторы" prefix="fans." samples={samples}/>
            <MetricGroup title="Датчики" prefix="sensors." samples={samples}/>
            <MetricGroup title="Pressure" prefix="pressure." samples={samples}/>
            <MetricGroup title="Kernel / disk" prefix="disk_kernel." samples={samples}/>
            <MetricGroup title="Kernel / network" prefix="network_kernel." samples={samples}/>
            <MetricGroup title="Сетевые соединения" prefix="network_connections." samples={samples}/>
            <MetricGroup title="Linux kernel" prefix="linux_kernel." samples={samples}/>
          </div>
        </Card>
      </>}
    </>}
  </section>;
}
