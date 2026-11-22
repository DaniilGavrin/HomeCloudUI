import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

type MetricItem = {
  metric_id: string;
  object_id?: string;
  value?: unknown;
  unit?: string;
  observed_at?: string;
  status?: string;
  reason?: string;
  error_code?: string;
  source_id?: string;
  window_ms?: number;
};

type MonitoringEvent = {
  server_id: string;
  kind: 'created' | 'update' | 'error' | 'state';
  node_id: string | null;
  payload: Record<string, unknown>;
  target: string;
};

export type CpuCoreTelemetry = {
  objectId: string;
  totalUsage: number | null;
  userTimeNs: string | null;
  frequencyHz: number | null;
};

export type CpuFrequencyTelemetry = {
  objectId: string;
  currentHz: number | null;
  minHz: number | null;
  maxHz: number | null;
  baseHz: number | null;
  governor: string | null;
};

export type CpuMetricQuality = {
  metricId: string;
  objectId: string | null;
  status: string;
  reason: string | null;
  errorCode: string | null;
  sourceId: string | null;
  observedAt: string | null;
  windowMS: number | null;
};

export type CpuAdditionalMetric = CpuMetricQuality & {
  value: unknown;
  unit: string | null;
};

export type CpuTelemetry = {
  phase: 'connecting' | 'streaming' | 'offline' | 'error';
  totalUsage: number | null;
  userTimeNs: string | null;
  systemTimeNs: string | null;
  niceTimeNs: string | null;
  idleTimeNs: string | null;
  ioWaitTimeNs: string | null;
  irqTimeNs: string | null;
  softIrqTimeNs: string | null;
  stealTimeNs: string | null;
  guestTimeNs: string | null;
  guestNiceTimeNs: string | null;
  forks: string | null;
  processesRunning: string | null;
  processesBlocked: string | null;
  perCore: CpuCoreTelemetry[];
  frequency: CpuFrequencyTelemetry[];
  additionalMetrics: CpuAdditionalMetric[];
  quality: Record<string, CpuMetricQuality>;
  observedAt: string | null;
  subscriptionId: string | null;
  perfSubscriptionId: string | null;
  perfError: string | null;
  error: string | null;
};

const INITIAL: CpuTelemetry = {
  phase: 'connecting',
  totalUsage: null,
  userTimeNs: null,
  systemTimeNs: null,
  niceTimeNs: null,
  idleTimeNs: null,
  ioWaitTimeNs: null,
  irqTimeNs: null,
  softIrqTimeNs: null,
  stealTimeNs: null,
  guestTimeNs: null,
  guestNiceTimeNs: null,
  forks: null,
  processesRunning: null,
  processesBlocked: null,
  perCore: [],
  frequency: [],
  additionalMetrics: [],
  quality: {},
  observedAt: null,
  subscriptionId: null,
  perfSubscriptionId: null,
  perfError: null,
  error: null,
};

const EVENT = 'homecloud:monitoring';
const KNOWN_METRICS = new Set([
  'system.cpu.totalusage',
  'system.cpu.user',
  'system.cpu.system',
  'system.cpu.nice',
  'system.cpu.idle',
  'system.cpu.iowait',
  'system.cpu.irq',
  'system.cpu.softirq',
  'system.cpu.steal',
  'system.cpu.guest',
  'system.cpu.guest_nice',
  'system.cpu.forks',
  'system.cpu.processes.running',
  'system.cpu.processes.blocked',
  'system.cpu.core.totalusage',
  'system.cpu.core.usage',
  'system.cpu.core.user',
]);

function finitePercent(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim().length > 0
      ? Number(value)
      : NaN;
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function exactCounter(value: unknown): string | null {
  if (typeof value === 'string') return /^\d+$/.test(value) ? value : null;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}

function metricKey(item: MetricItem): string {
  const windowedMetric = item.metric_id === 'system.cpu.pressure.some'
    || item.metric_id === 'system.cpu.pressure.full';
  return [item.metric_id, item.object_id ?? '', windowedMetric ? item.window_ms ?? '' : ''].join('|');
}

function qualityOf(item: MetricItem): CpuMetricQuality {
  return {
    metricId: item.metric_id,
    objectId: item.object_id ?? null,
    status: item.status ?? (item.value === undefined || item.value === null ? 'unknown' : 'valid'),
    reason: item.reason ?? null,
    errorCode: item.error_code ?? null,
    sourceId: item.source_id ?? null,
    observedAt: item.observed_at ?? null,
    windowMS: typeof item.window_ms === 'number' ? item.window_ms : null,
  };
}

function isUsable(item: MetricItem): boolean {
  const status = item.status ?? (item.value === undefined || item.value === null ? 'unknown' : 'valid');
  return (status === 'valid' || status === 'partial') && item.value !== undefined && item.value !== null;
}

function invalidQuality(quality: CpuMetricQuality, reason: string): CpuMetricQuality {
  return { ...quality, status: 'invalid', reason, errorCode: quality.errorCode ?? 'SOURCE_INVALID_DATA' };
}

function normalizeAdditionalValue(
  item: MetricItem,
  previousValue: unknown,
  qualityItem: CpuMetricQuality,
): { value: unknown; quality: CpuMetricQuality } {
  if (item.status === 'valid' && (item.value === undefined || item.value === null)) {
    return { value: previousValue ?? null, quality: invalidQuality(qualityItem, 'missing_value') };
  }
  if (!isUsable(item)) return { value: previousValue ?? null, quality: qualityItem };
  if (item.unit === 'ns' || item.unit === 'count') {
    const value = exactCounter(item.value);
    return value === null
      ? { value: previousValue ?? null, quality: invalidQuality(qualityItem, 'invalid_integer_counter') }
      : { value, quality: qualityItem };
  }
  if (item.unit === 'percent') {
    const value = finitePercent(item.value);
    return value === null
      ? { value: previousValue ?? null, quality: invalidQuality(qualityItem, 'percentage_out_of_range_or_non_finite') }
      : { value, quality: qualityItem };
  }
  return { value: item.value, quality: qualityItem };
}

function frequencyMetric(item: MetricItem): boolean {
  return item.metric_id.startsWith('system.cpu.frequency.')
    || item.metric_id === 'system.cpu.frequency'
    || item.metric_id === 'system.cpu.core.frequency';
}

export function useHomeCloudCpuMonitoring(
  serverId: string | null,
  serverPhase: string,
  activeSection: string,
  additionalListenerReadyFor: string | null,
): CpuTelemetry {
  const [telemetry, setTelemetry] = useState<CpuTelemetry>(INITIAL);
  const [listenerReadyFor, setListenerReadyFor] = useState<string | null>(null);

  // One listener per selected server. Native Rust owns all WebSocket subscriptions.
  useEffect(() => {
    if (!serverId) {
      setListenerReadyFor(null);
      setTelemetry(INITIAL);
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;

    setTelemetry({
      ...INITIAL,
      phase: serverPhase === 'offline' || serverPhase === 'error' ? 'offline' : 'connecting',
    });

    void (async () => {
      try {
        const stop = await listen<MonitoringEvent>(EVENT, event => {
          const message = event.payload;
          if (disposed || message.server_id !== serverId) return;

          if (message.target === 'system.cpu.perf') {
            if (message.kind === 'created') {
              const subscriptionId = typeof message.payload.subscription_id === 'string'
                ? message.payload.subscription_id
                : null;
              setTelemetry(previous => ({
                ...previous,
                perfSubscriptionId: subscriptionId,
                perfError: null,
                additionalMetrics: previous.additionalMetrics.filter(item => !item.metricId.startsWith('system.cpu.perf.')),
                quality: Object.fromEntries(Object.entries(previous.quality).filter(([key]) => !key.startsWith('system.cpu.perf.'))),
              }));
              return;
            }
            if (message.kind === 'error') {
              const errorObject = message.payload.error as { message?: unknown; code?: unknown } | undefined;
              const errorText = typeof errorObject?.message === 'string'
                ? errorObject.message
                : typeof errorObject?.code === 'string'
                  ? errorObject.code
                  : 'Не удалось получить PMU-счётчики CPU';
              setTelemetry(previous => ({ ...previous, perfSubscriptionId: null, perfError: errorText }));
              return;
            }
            if (message.kind !== 'update') return;
            const subscriptionId = typeof message.payload.subscription_id === 'string'
              ? message.payload.subscription_id
              : null;
            const items = Array.isArray(message.payload.items) ? message.payload.items as MetricItem[] : [];
            setTelemetry(previous => {
              if (previous.perfSubscriptionId && subscriptionId !== previous.perfSubscriptionId) return previous;
              const quality = { ...previous.quality };
              const additional = new Map<string, CpuAdditionalMetric>(
                previous.additionalMetrics.map(item => [metricKey({
                  metric_id: item.metricId,
                  object_id: item.objectId ?? undefined,
                  window_ms: item.windowMS ?? undefined,
                }), { ...item }]),
              );
              for (const item of items) {
                const key = metricKey(item);
                const qualityItem = qualityOf(item);
                const normalized = normalizeAdditionalValue(item, additional.get(key)?.value, qualityItem);
                quality[key] = normalized.quality;
                additional.set(key, {
                  ...normalized.quality,
                  value: normalized.value,
                  unit: item.unit ?? additional.get(key)?.unit ?? null,
                });
              }
              return {
                ...previous,
                perfSubscriptionId: subscriptionId ?? previous.perfSubscriptionId,
                perfError: null,
                additionalMetrics: [...additional.values()],
                quality,
              };
            });
            return;
          }

          if (message.target !== 'system.cpu') return;

          if (message.kind === 'created') {
            const subscriptionId = typeof message.payload.subscription_id === 'string'
              ? message.payload.subscription_id
              : null;
            setTelemetry({
              ...INITIAL,
              phase: 'streaming',
              subscriptionId,
            });
            return;
          }

          if (message.kind === 'error') {
            const errorObject = message.payload.error as { message?: unknown; code?: unknown } | undefined;
            const errorText = typeof errorObject?.message === 'string'
              ? errorObject.message
              : typeof errorObject?.code === 'string'
                ? errorObject.code
                : 'Не удалось получить телеметрию CPU';
            setTelemetry(previous => ({ ...previous, phase: 'error', error: errorText }));
            return;
          }

          if (message.kind !== 'update') return;

          const subscriptionId = typeof message.payload.subscription_id === 'string'
            ? message.payload.subscription_id
            : null;
          const items = Array.isArray(message.payload.items) ? message.payload.items as MetricItem[] : [];

          setTelemetry(previous => {
            if (previous.subscriptionId && subscriptionId !== previous.subscriptionId) return previous;

            let totalUsage = previous.totalUsage;
            let userTimeNs = previous.userTimeNs;
            let systemTimeNs = previous.systemTimeNs;
            let niceTimeNs = previous.niceTimeNs;
            let idleTimeNs = previous.idleTimeNs;
            let ioWaitTimeNs = previous.ioWaitTimeNs;
            let irqTimeNs = previous.irqTimeNs;
            let softIrqTimeNs = previous.softIrqTimeNs;
            let stealTimeNs = previous.stealTimeNs;
            let guestTimeNs = previous.guestTimeNs;
            let guestNiceTimeNs = previous.guestNiceTimeNs;
            let forks = previous.forks;
            let processesRunning = previous.processesRunning;
            let processesBlocked = previous.processesBlocked;
            let observedAt = previous.observedAt;

            const cores = new Map<string, CpuCoreTelemetry>(
              previous.perCore.map(core => [core.objectId, { ...core }]),
            );
            const policies = new Map<string, CpuFrequencyTelemetry>(
              previous.frequency.map(policy => [policy.objectId, { ...policy }]),
            );
            const quality = { ...previous.quality };
            const additional = new Map<string, CpuAdditionalMetric>(
              previous.additionalMetrics.map(item => [metricKey({
                metric_id: item.metricId,
                object_id: item.objectId ?? undefined,
                window_ms: item.windowMS ?? undefined,
              }), { ...item }]),
            );

            for (const item of items) {
              let qualityItem = qualityOf(item);
              const key = metricKey(item);
              if (item.status === 'valid' && (item.value === undefined || item.value === null)) {
                qualityItem = invalidQuality(qualityItem, 'missing_value');
              }
              quality[key] = qualityItem;
              if (typeof item.observed_at === 'string') observedAt = item.observed_at;

              if (frequencyMetric(item)) {
                if (item.metric_id === 'system.cpu.core.frequency') {
                  if (!item.object_id) continue;
                  const core = cores.get(item.object_id) ?? {
                    objectId: item.object_id,
                    totalUsage: null,
                    userTimeNs: null,
                    frequencyHz: null,
                  };
                  if (isUsable(item)) {
                    const value = finiteNumber(item.value);
                    if (value === null || value < 0) quality[key] = invalidQuality(qualityItem, 'invalid_frequency_value');
                    else core.frequencyHz = value;
                  }
                  cores.set(item.object_id, core);
                  continue;
                }
                if (!item.object_id) continue;
                const policy = policies.get(item.object_id) ?? {
                  objectId: item.object_id,
                  currentHz: null,
                  minHz: null,
                  maxHz: null,
                  baseHz: null,
                  governor: null,
                };
                const numeric = isUsable(item) ? finiteNumber(item.value) : null;
                switch (item.metric_id) {
                  case 'system.cpu.frequency.current':
                  case 'system.cpu.frequency.min':
                  case 'system.cpu.frequency.max':
                  case 'system.cpu.frequency.base':
                    if (isUsable(item)) {
                      if (numeric === null || numeric < 0) quality[key] = invalidQuality(qualityItem, 'invalid_frequency_value');
                      else if (item.metric_id === 'system.cpu.frequency.current') policy.currentHz = numeric;
                      else if (item.metric_id === 'system.cpu.frequency.min') policy.minHz = numeric;
                      else if (item.metric_id === 'system.cpu.frequency.max') policy.maxHz = numeric;
                      else policy.baseHz = numeric;
                    }
                    break;
                  case 'system.cpu.frequency.governor':
                    if (isUsable(item)) {
                      if (typeof item.value === 'string') policy.governor = item.value;
                      else quality[key] = invalidQuality(qualityItem, 'invalid_governor_value');
                    }
                    break;
                }
                policies.set(item.object_id, policy);
                continue;
              }

              if (KNOWN_METRICS.has(item.metric_id)) {
                if (!isUsable(item)) {
                  if (item.object_id && (
                    item.metric_id === 'system.cpu.core.totalusage'
                    || item.metric_id === 'system.cpu.core.usage'
                    || item.metric_id === 'system.cpu.core.user'
                  )) {
                    const core = cores.get(item.object_id);
                    if (core && (item.reason === 'cpu_offline' || item.reason === 'not_present')) {
                      if (item.metric_id === 'system.cpu.core.user') core.userTimeNs = null;
                      else core.totalUsage = null;
                      if (item.reason === 'not_present' || item.reason === 'cpu_offline') {
                        core.totalUsage = null;
                        core.userTimeNs = null;
                        core.frequencyHz = null;
                      }
                      if (core.totalUsage === null && core.userTimeNs === null && core.frequencyHz === null) {
                        cores.delete(item.object_id);
                      } else {
                        cores.set(item.object_id, core);
                      }
                    }
                  }
                  continue;
                }
                switch (item.metric_id) {
                  case 'system.cpu.totalusage': {
                    const value = finitePercent(item.value);
                    if (value === null) quality[key] = invalidQuality(qualityItem, 'percentage_out_of_range_or_non_finite');
                    else totalUsage = value;
                    break;
                  }
                  case 'system.cpu.user':
                  case 'system.cpu.system':
                  case 'system.cpu.nice':
                  case 'system.cpu.idle':
                  case 'system.cpu.iowait':
                  case 'system.cpu.irq':
                  case 'system.cpu.softirq':
                  case 'system.cpu.steal':
                  case 'system.cpu.guest':
                  case 'system.cpu.guest_nice':
                  case 'system.cpu.forks':
                  case 'system.cpu.processes.running':
                  case 'system.cpu.processes.blocked': {
                    const value = exactCounter(item.value);
                    if (value === null) {
                      quality[key] = invalidQuality(qualityItem, 'invalid_integer_counter');
                      break;
                    }
                    switch (item.metric_id) {
                      case 'system.cpu.user': userTimeNs = value; break;
                      case 'system.cpu.system': systemTimeNs = value; break;
                      case 'system.cpu.nice': niceTimeNs = value; break;
                      case 'system.cpu.idle': idleTimeNs = value; break;
                      case 'system.cpu.iowait': ioWaitTimeNs = value; break;
                      case 'system.cpu.irq': irqTimeNs = value; break;
                      case 'system.cpu.softirq': softIrqTimeNs = value; break;
                      case 'system.cpu.steal': stealTimeNs = value; break;
                      case 'system.cpu.guest': guestTimeNs = value; break;
                      case 'system.cpu.guest_nice': guestNiceTimeNs = value; break;
                      case 'system.cpu.forks': forks = value; break;
                      case 'system.cpu.processes.running': processesRunning = value; break;
                      case 'system.cpu.processes.blocked': processesBlocked = value; break;
                    }
                    break;
                  }
                  case 'system.cpu.core.totalusage':
                  case 'system.cpu.core.usage': {
                    if (!item.object_id) break;
                    const core = cores.get(item.object_id) ?? {
                      objectId: item.object_id,
                      totalUsage: null,
                      userTimeNs: null,
                      frequencyHz: null,
                    };
                    const value = finitePercent(item.value);
                    if (value === null) quality[key] = invalidQuality(qualityItem, 'percentage_out_of_range_or_non_finite');
                    else core.totalUsage = value;
                    cores.set(item.object_id, core);
                    break;
                  }
                  case 'system.cpu.core.user': {
                    if (!item.object_id) break;
                    const core = cores.get(item.object_id) ?? {
                      objectId: item.object_id,
                      totalUsage: null,
                      userTimeNs: null,
                      frequencyHz: null,
                    };
                    const value = exactCounter(item.value);
                    if (value === null) quality[key] = invalidQuality(qualityItem, 'invalid_integer_counter');
                    else core.userTimeNs = value;
                    cores.set(item.object_id, core);
                    break;
                  }
                }
                continue;
              }

              // Keep extended CPU metrics as typed samples. They are rendered
              // by family below, while status/reason/source remain available.
              const normalized = normalizeAdditionalValue(item, additional.get(key)?.value, qualityItem);
              quality[key] = normalized.quality;
              additional.set(key, {
                ...normalized.quality,
                value: normalized.value,
                unit: item.unit ?? additional.get(key)?.unit ?? null,
              });
            }

            const perCore = [...cores.values()].sort((a, b) => {
              const aNumber = Number(a.objectId.match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER);
              const bNumber = Number(b.objectId.match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER);
              return aNumber - bNumber || a.objectId.localeCompare(b.objectId);
            });

            return {
              ...previous,
              phase: 'streaming',
              subscriptionId: subscriptionId ?? previous.subscriptionId,
              totalUsage,
              userTimeNs,
              systemTimeNs,
              niceTimeNs,
              idleTimeNs,
              ioWaitTimeNs,
              irqTimeNs,
              softIrqTimeNs,
              stealTimeNs,
              guestTimeNs,
              guestNiceTimeNs,
              forks,
              processesRunning,
              processesBlocked,
              perCore,
              frequency: [...policies.values()]
                .filter(policy => policy.currentHz !== null || policy.minHz !== null || policy.maxHz !== null || policy.baseHz !== null || policy.governor !== null)
                .sort((a, b) => a.objectId.localeCompare(b.objectId, undefined, { numeric: true })),
              additionalMetrics: [...additional.values()],
              quality,
              observedAt,
              error: null,
            };
          });
        });

        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
        setListenerReadyFor(serverId);
      } catch (error) {
        if (!disposed) setTelemetry(previous => ({ ...previous, phase: 'error', error: String(error) }));
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
      void invoke('homecloud_monitoring_set_active', { serverId, section: null }).catch(() => undefined);
    };
  }, [serverId]);

  // Section changes are sent to Rust only after both UI listeners are ready.
  useEffect(() => {
    if (!serverId || listenerReadyFor !== serverId || additionalListenerReadyFor !== serverId) return;
    void invoke('homecloud_monitoring_set_active', {
      serverId,
      section: activeSection,
    }).catch(error => {
      setTelemetry(previous => ({ ...previous, phase: 'error', error: String(error) }));
    });
  }, [serverId, activeSection, listenerReadyFor, additionalListenerReadyFor]);

  useEffect(() => {
    if (serverPhase === 'offline' || serverPhase === 'error') {
      setTelemetry(previous => ({ ...previous, phase: 'offline' }));
    } else if (serverPhase === 'ready') {
      setTelemetry(previous => previous.phase === 'offline'
        ? { ...previous, phase: 'connecting', error: null }
        : previous);
    }
  }, [serverPhase]);

  return telemetry;
}
