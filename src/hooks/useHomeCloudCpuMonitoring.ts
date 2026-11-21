import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

type MetricItem = {
  metric_id: string;
  object_id?: string;
  value: number | string;
  unit: string;
  observed_at: string;
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
  perCore: CpuCoreTelemetry[];
  observedAt: string | null;
  subscriptionId: string | null;
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
  perCore: [],
  observedAt: null,
  subscriptionId: null,
  error: null,
};

const EVENT = 'homecloud:monitoring';

function finitePercent(value: number | string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null;
}

function exactCounter(value: number | string): string | null {
  const text = String(value);
  return /^\d+$/.test(text) ? text : null;
}

export function useHomeCloudCpuMonitoring(
  serverId: string | null,
  serverPhase: string,
  activeSection: string,
  additionalListenerReadyFor: string | null,
): CpuTelemetry {
  const [telemetry, setTelemetry] = useState<CpuTelemetry>(INITIAL);
  const [listenerReadyFor, setListenerReadyFor] = useState<string | null>(null);

  // One listener per selected server. It remains mounted while the user moves
  // between Monitoring tabs; only the native subscription target changes.
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
          if (message.server_id !== serverId || message.target !== 'system.cpu') return;

          if (message.kind === 'created') {
            const subscriptionId = typeof message.payload.subscription_id === 'string'
              ? message.payload.subscription_id
              : null;
            setTelemetry(previous => {
              if (previous.subscriptionId === subscriptionId) {
                return { ...previous, phase: 'streaming', error: null };
              }
              return {
                ...INITIAL,
                phase: 'streaming',
                subscriptionId,
              };
            });
            return;
          }

          if (message.kind === 'error') {
            const errorObject = message.payload.error as { message?: unknown; code?: unknown } | undefined;
            const messageText = typeof errorObject?.message === 'string'
              ? errorObject.message
              : typeof errorObject?.code === 'string'
                ? errorObject.code
                : 'Не удалось получить телеметрию CPU';
            setTelemetry(previous => ({ ...previous, phase: 'error', error: messageText }));
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
            let observedAt = previous.observedAt;
            // The group subscription includes core.user for every currently present logical CPU.
            // Rebuild the map per update so hot-removed CPUs do not remain in the UI.
            const cores = new Map<string, CpuCoreTelemetry>();

            for (const item of items) {
              if (typeof item.observed_at === 'string') observedAt = item.observed_at;

              switch (item.metric_id) {
                case 'system.cpu.totalusage':
                  totalUsage = finitePercent(item.value) ?? totalUsage;
                  break;
                case 'system.cpu.user':
                  userTimeNs = exactCounter(item.value) ?? userTimeNs;
                  break;
                case 'system.cpu.system':
                  systemTimeNs = exactCounter(item.value) ?? systemTimeNs;
                  break;
                case 'system.cpu.nice':
                  niceTimeNs = exactCounter(item.value) ?? niceTimeNs;
                  break;
                case 'system.cpu.idle':
                  idleTimeNs = exactCounter(item.value) ?? idleTimeNs;
                  break;
                case 'system.cpu.iowait':
                  ioWaitTimeNs = exactCounter(item.value) ?? ioWaitTimeNs;
                  break;
                case 'system.cpu.irq':
                  irqTimeNs = exactCounter(item.value) ?? irqTimeNs;
                  break;
                case 'system.cpu.softirq':
                  softIrqTimeNs = exactCounter(item.value) ?? softIrqTimeNs;
                  break;
                case 'system.cpu.steal':
                  stealTimeNs = exactCounter(item.value) ?? stealTimeNs;
                  break;
                case 'system.cpu.guest':
                  guestTimeNs = exactCounter(item.value) ?? guestTimeNs;
                  break;
                case 'system.cpu.guest_nice':
                  guestNiceTimeNs = exactCounter(item.value) ?? guestNiceTimeNs;
                  break;
                case 'system.cpu.core.totalusage': {
                  if (!item.object_id) break;
                  const core = cores.get(item.object_id) ?? {
                    objectId: item.object_id,
                    totalUsage: null,
                    userTimeNs: null,
                  };
                  core.totalUsage = finitePercent(item.value) ?? core.totalUsage;
                  cores.set(item.object_id, core);
                  break;
                }
                case 'system.cpu.core.user': {
                  if (!item.object_id) break;
                  const core = cores.get(item.object_id) ?? {
                    objectId: item.object_id,
                    totalUsage: null,
                    userTimeNs: null,
                  };
                  core.userTimeNs = exactCounter(item.value) ?? core.userTimeNs;
                  cores.set(item.object_id, core);
                  break;
                }
              }
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
              perCore,
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

  // Section changes update the desired target without an intermediate cancel /
  // recreate race. Rust deduplicates and owns the actual WebSocket lifecycle.
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
