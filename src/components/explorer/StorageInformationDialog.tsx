import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { type HcssAgent, filesystemVolumes, formatBytes } from '../storage/hcssModel';
import { capacityOf, inventoryTotals } from './storageInventory';
import '../../styles/storage-info.css';

type InventoryReply = { agents: HcssAgent[] };
type Tab = 'overview' | 'volumes' | 'roots' | 'connection';

type Props = {
  serverId: string;
  serverName?: string;
  serverOnline: boolean;
  initialAgents: HcssAgent[];
  initialNodeId: string;
  onClose: () => void;
};

const tabs: { id: Tab; name: string }[] = [
  { id: 'overview', name: 'Обзор' },
  { id: 'volumes', name: 'Диски и разделы' },
  { id: 'roots', name: 'Доступ к файлам' },
  { id: 'connection', name: 'Подключение' },
];

function displayTime(iso?: string): string {
  if (!iso) return 'Нет данных';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? 'Нет данных' : date.toLocaleString('ru-RU');
}

function Status({ good, yes, no }: { good: boolean; yes: string; no: string }) {
  return <span className={`hc-si-status ${good ? 'is-on' : 'is-off'}`}>
    <span aria-hidden="true">{good ? '●' : '○'}</span> {good ? yes : no}
  </span>;
}

function Meter({ size, free }: { size: number; free: number }) {
  const capacity = capacityOf(size, free);
  return <div className="hc-si-meter">
    <div className="hc-si-meter-labels">
      <span>{formatBytes(capacity.used)} занято</span>
      <span>{capacity.percent}%</span>
    </div>
    <div className="hc-si-meter-track" role="progressbar" aria-label="Занятое место"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={capacity.percent}>
      <span style={{ width: `${capacity.percent}%` }} />
    </div>
    <div className="hc-si-meter-foot">
      <span>{formatBytes(Math.max(0, free))} свободно</span>
      <span>Всего {formatBytes(size)}</span>
    </div>
  </div>;
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return <div className="hc-si-stat">
    <span>{label}</span><strong>{value}</strong>
    {sub && <small>{sub}</small>}
  </div>;
}

function Definition({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="hc-si-detail">
    <dt>{label}</dt><dd>{children}</dd>
  </div>;
}

export function StorageInformationDialog({
  serverId, serverName, serverOnline, initialAgents, initialNodeId, onClose,
}: Props) {
  const [agents, setAgents] = useState<HcssAgent[]>(initialAgents);
  const [nodeId, setNodeId] = useState(initialNodeId);
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState<Date | null>(null);
  const requestId = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const totals = useMemo(() => inventoryTotals(agents), [agents]);
  const selected = agents.find(a => a.storage_node_id === nodeId) ?? agents[0];
  const volumes = filesystemVolumes(selected?.volumes);
  const blocks = (selected?.volumes ?? []).filter(v => v.kind === 'block');
  const roots = selected?.roots ?? [];
  const endpoints = selected?.file_ws?.endpoints?.length
    ? selected.file_ws.endpoints
    : selected?.file_ws?.endpoint ? [selected.file_ws.endpoint] : [];
  const refresh = useCallback(async () => {
    if (!serverId || !serverOnline) {
      setError('Backend недоступен. Показаны последние полученные данные.');
      return;
    }
    const id = ++requestId.current;
    setBusy(true);
    setError('');
    try {
      const result = await invoke<InventoryReply>('homecloud_hcss_sources', { serverId });
      if (id !== requestId.current) return;
      if (!Array.isArray(result?.agents)) throw new Error('Некорректный ответ реестра HC SS');
      setAgents(result.agents);
      setNodeId(prev => result.agents.some(a => a.storage_node_id === prev) ? prev
        : (result.agents.find(a => a.online)?.storage_node_id ?? result.agents[0]?.storage_node_id ?? ''));
      setUpdated(new Date());
    } catch (cause) {
      if (id === requestId.current) setError(`Не удалось обновить данные: ${String(cause)}`);
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  }, [serverId, serverOnline]);

  useEffect(() => {
    void refresh();
    return () => { requestId.current++; };
  }, [refresh]);

  useEffect(() => {
    closeRef.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    // Capture Escape before the Explorer's own key handling.
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [onClose]);

  return <div className="hc-si-backdrop" onPointerDown={e => {
    if (e.target === e.currentTarget) onClose();
  }}>
    <section className="hc-si-dialog" role="dialog" aria-modal="true"
      aria-label="Информация о хранилищах" aria-describedby="hc-si-subtitle">
      <header className="hc-si-header">
        <div className="hc-si-title">
          <span className="hc-si-kicker">HOMECLOUD · STORAGE INVENTORY</span>
          <h2>Информация о хранилищах</h2>
          <p id="hc-si-subtitle">Состояние серверов хранения, дисков, разрешённых каталогов и соединений.</p>
        </div>
        <div className="hc-si-header-actions">
          <button type="button" onClick={() => void refresh()} disabled={busy || !serverOnline}
            title="Повторно запросить состояние у Backend">
            {busy ? 'Обновление…' : '↻ Обновить'}
          </button>
          <button ref={closeRef} type="button" className="hc-si-close"
            aria-label="Закрыть информацию о хранилищах" onClick={onClose}>×</button>
        </div>
      </header>

      <div className="hc-si-summary">
        <Stat label="Узлы HC SS" value={totals.nodes} sub={`${totals.online} онлайн · ${totals.nodes - totals.online} офлайн`} />
        <Stat label="Смонтированные ФС" value={totals.filesystems} sub="Без двойного учёта физических дисков" />
        <Stat label="Разрешённые каталоги" value={totals.roots} sub={`${totals.browsable} доступны для просмотра`} />
        <Stat label="Физические устройства" value={totals.blockDevices} sub="Блочные накопители" />
      </div>
      {error && <p role="alert" className="hc-si-error">{error}</p>}

      <div className="hc-si-body">
        <aside className="hc-si-nodes" aria-label="Узлы HC Storage Service">
          <div className="hc-si-sidebar-head">Узлы хранения <small>{agents.length}</small></div>
          {agents.length === 0 && <div className="hc-si-empty">
            {busy ? 'Получение данных…' : 'Нет зарегистрированных узлов HC SS.'}
          </div>}
          {agents.map(agent => <button type="button" key={agent.storage_node_id}
            className={`hc-si-node ${selected?.storage_node_id === agent.storage_node_id ? 'is-active' : ''}`}
            aria-pressed={selected?.storage_node_id === agent.storage_node_id}
            onClick={() => setNodeId(agent.storage_node_id)}>
            <span className="hc-si-node-icon">▣</span>
            <span className="hc-si-node-text">
              <strong>{agent.storage_node_id}</strong>
              <small>{agent.online ? 'Подключён' : 'Нет соединения'} · {agent.roots?.length ?? 0} root</small>
            </span>
            <i className={agent.online ? 'is-online' : ''} aria-hidden="true" />
          </button>)}
        </aside>

        <div className="hc-si-main">
          {selected ? <>
            <div className="hc-si-node-header">
              <div>
                <strong>{selected.storage_node_id}</strong>
                <span>Обновление состояния: {displayTime(selected.last_seen)}</span>
              </div>
              <Status good={selected.online} yes="Узел онлайн" no="Узел офлайн" />
            </div>
            <div className="hc-si-tabs" role="tablist" aria-label="Разделы информации">
              {tabs.map(item => <button key={item.id} type="button"
                id={`hc-si-tab-${item.id}`}
                role="tab" aria-selected={tab === item.id}
                aria-controls="hc-si-panel" className={tab === item.id ? 'is-active' : ''}
                onClick={() => setTab(item.id)}>{item.name}</button>)}
            </div>
            <div className="hc-si-panel" id="hc-si-panel" role="tabpanel"
              aria-labelledby={`hc-si-tab-${tab}`}>
              {tab === 'overview' && <>
                <div className="hc-si-section-head"><h3>Состояние выбранного узла</h3>
                  <span>Сводная информация</span></div>
                <div className="hc-si-quick">
                  <Stat label="Смонтированные ФС" value={volumes.length} />
                  <Stat label="Накопители" value={blocks.length} />
                  <Stat label="Доступные root" value={roots.filter(r => r.online && r.allow_list).length} />
                </div>
                <div className="hc-si-section-head"><h3>Использование пространства</h3>
                  <span>По файловым системам</span></div>
                {volumes.length === 0 ? <p className="hc-si-hint">Нет данных о смонтированных файловых системах.</p>
                  : <div className="hc-si-cards">
                    {volumes.map(v => <article className="hc-si-volume" key={v.volume_id}>
                      <div className="hc-si-card-head">
                        <div><strong>{v.mount_path || v.volume_id}</strong>
                          <small>{v.fs_type || 'Файловая система'}</small></div>
                        <Status good={!v.read_only} yes="Чтение/запись" no="Только чтение" />
                      </div>
                      <Meter size={v.size_bytes} free={v.free_bytes} />
                    </article>)}
                  </div>}
                <div className="hc-si-advisory">
                  <strong>Файловый доступ ограничен настройками HC SS.</strong>
                  <p>Наличие диска в инвентаризации не даёт клиенту права на его содержимое.
                    Проводник показывает только опубликованные root, а файловые операции
                    выполняет HC Storage Service с назначенными разрешениями.</p>
                </div>
              </>}
              {tab === 'volumes' && <>
                <div className="hc-si-section-head"><h3>Смонтированные файловые системы</h3>
                  <span>{volumes.length} файловых систем</span></div>
                {volumes.length ? <div className="hc-si-cards">
                  {volumes.map(v => <article className="hc-si-volume" key={v.volume_id}>
                    <div className="hc-si-card-head">
                      <div><strong>{v.mount_path || v.volume_id}</strong><small>{v.fs_type || 'Неизвестная ФС'}</small></div>
                      <Status good={!v.read_only} yes="Доступна запись" no="Только чтение" />
                    </div>
                    <Meter size={v.size_bytes} free={v.free_bytes} />
                    <dl className="hc-si-details">
                      <Definition label="Идентификатор">{v.volume_id}</Definition>
                      <Definition label="Устройство">{v.device || 'Не указано'}</Definition>
                      <Definition label="Доступно процессам">{formatBytes(v.available_bytes)}</Definition>
                      <Definition label="Съёмный накопитель">{v.removable ? 'Да' : 'Нет'}</Definition>
                    </dl>
                  </article>)}
                </div> : <p className="hc-si-hint">Нет смонтированных файловых систем с данными об объёме.</p>}
                <div className="hc-si-section-head"><h3>Физические устройства</h3>
                  <span>{blocks.length} устройств</span></div>
                {blocks.length ? <div className="hc-si-device-list">
                  {blocks.map(v => <article key={v.volume_id} className="hc-si-device">
                    <div><strong>{v.model || v.device || v.volume_id}</strong>
                      <small>{v.device || v.volume_id}</small></div>
                    <div className="hc-si-device-meta">
                      <strong>{formatBytes(v.size_bytes)}</strong>
                      <Status good={v.mounted} yes="Смонтирован" no="Не смонтирован" />
                    </div>
                  </article>)}
                </div> : <p className="hc-si-hint">Инвентаризация не сообщает о физических устройствах.</p>}
              </>}
              {tab === 'roots' && <>
                <div className="hc-si-section-head"><h3>Разрешённые каталоги</h3>
                  <span>{roots.length} опубликовано</span></div>
                {roots.length ? <div className="hc-si-cards">
                  {roots.map(root => <article className="hc-si-root" key={JSON.stringify([root.kind,root.id])}>
                    <div className="hc-si-card-head">
                      <div><strong>{root.name || root.id}</strong>
                        <small>{root.kind === 'disk' ? 'Диск' : 'Каталог'} · {root.id}</small></div>
                      <Status good={root.online} yes="Доступен" no="Офлайн" />
                    </div>
                    <div className="hc-si-permissions">
                      {([
                        ['Просмотр', root.allow_list],
                        ['Чтение', root.allow_read],
                        ['Запись', root.allow_write],
                        ['Удаление', root.allow_delete],
                      ] as const).map(([name, allowed]) => <span key={name}
                        className={allowed ? 'is-allowed' : 'is-denied'}>
                        {allowed ? '✓' : '×'} {name}
                      </span>)}
                    </div>
                    <p className="hc-si-hint">Разрешения определяются конфигурацией HC Storage Service.
                      Из этого окна изменять их нельзя.</p>
                  </article>)}
                </div> : <p className="hc-si-hint">Этот узел не публикует разрешённые каталоги.</p>}
              </>}
              {tab === 'connection' && <>
                <div className="hc-si-section-head"><h3>Соединение и идентификация</h3></div>
                <dl className="hc-si-details hc-si-details--large">
                  <Definition label="Backend">{serverName || serverId || 'Не выбран'}</Definition>
                  <Definition label="Backend онлайн"><Status good={serverOnline} yes="Да" no="Нет" /></Definition>
                  <Definition label="Storage Node ID">{selected.storage_node_id}</Definition>
                  <Definition label="Последний контакт">{displayTime(selected.last_seen)}</Definition>
                  <Definition label="Boot ID">{selected.boot_id || 'Не указан'}</Definition>
                  <Definition label="Session Epoch">{selected.session_epoch}</Definition>
                  <Definition label="FileWS">{selected.file_ws?.endpoint || endpoints[0] || 'Не опубликован'}</Definition>
                  <Definition label="FileWS endpoints">
                    {endpoints.length ? <div className="hc-si-addresses">
                      {endpoints.map(url => <code key={url}>{url}</code>)}</div> : 'Нет адресов'}
                  </Definition>
                </dl>
                <div className="hc-si-section-head"><h3>Возможности службы</h3>
                  <span>{selected.capabilities?.length ?? 0}</span></div>
                <div className="hc-si-capabilities">
                  {selected.capabilities?.length
                    ? selected.capabilities.map(cap => <code key={cap}>{cap}</code>)
                    : <span className="hc-si-hint">Список возможностей не опубликован.</span>}
                </div>
              </>}
            </div>
          </> : <div className="hc-si-empty hc-si-empty--main">
            {busy ? 'Обновляем сведения об узлах…' : 'Добавь HomeCloud Backend и зарегистрируй HC Storage Service для просмотра информации.'}
          </div>}
        </div>
      </div>
      <footer className="hc-si-footer">
        <span>{serverName || serverId || 'Backend не выбран'} · {updated
          ? `Обновлено: ${updated.toLocaleTimeString('ru-RU')}`
          : 'Данные инвентаризации'}</span>
        <button type="button" onClick={onClose}>Закрыть</button>
      </footer>
    </section>
  </div>;
}
