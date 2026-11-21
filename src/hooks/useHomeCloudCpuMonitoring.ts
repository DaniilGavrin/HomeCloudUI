import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

type MetricItem = {
  metric_id: string;
  value: number | string;
  unit: string;
  observed_at: string;
};

type MonitoringEvent = {
  server_id: string;
  kind: 'created' | 'update' | 'error' | 'state';
  node_id: string | null;
  payload: Record<string, unknown>;
};

export type CpuTelemetry = {
  phase: 'connecting' | 'streaming' | 'offline' | 'error';
  totalUsage: number | null;
  userTimeNs: string | null;
  systemTimeNs: string | null;
  observedAt: string | null;
  subscriptionId: string | null;
  error: string | null;
};

const INITIAL: CpuTelemetry = {
  phase: 'connecting',
  totalUsage: null,
  userTimeNs: null,
  systemTimeNs: null,
  observedAt: null,
  subscriptionId: null,
  error: null,
};

const EVENT = 'homecloud:monitoring';

export function useHomeCloudCpuMonitoring(serverId: string, serverPhase: string): CpuTelemetry {
  const [telemetry, setTelemetry] = useState<CpuTelemetry>(INITIAL);

  useEffect(() => {
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
          if (message.server_id !== serverId) return;

          if (message.kind === 'created') {
            const subscriptionId = typeof message.payload.subscription_id === 'string'
              ? message.payload.subscription_id
              : null;
            setTelemetry(previous => ({
              ...previous,
              phase: 'streaming',
              subscriptionId,
              error: null,
            }));
            return;
          }

          if (message.kind === 'error') {
            const errorObject = message.payload.error as { message?: unknown; code?: unknown } | undefined;
            const messageText = typeof errorObject?.message === 'string'
              ? errorObject.message
              : typeof errorObject?.code === 'string'
                ? errorObject.code
                : 'Не удалось получить телеметрию CPU';
            setTelemetry(previous => ({
              ...previous,
              phase: 'error',
              error: messageText,
            }));
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
            let observedAt = previous.observedAt;

            for (const item of items) {
              if (typeof item.observed_at === 'string') observedAt = item.observed_at;
              if (item.metric_id === 'system.cpu.totalusage') {
                const value = Number(item.value);
                if (Number.isFinite(value)) totalUsage = Math.max(0, Math.min(100, value));
              } else if (item.metric_id === 'system.cpu.user') {
                userTimeNs = String(item.value);
              } else if (item.metric_id === 'system.cpu.system') {
                systemTimeNs = String(item.value);
              }
            }

            return {
              ...previous,
              phase: 'streaming',
              subscriptionId: subscriptionId ?? previous.subscriptionId,
              totalUsage,
              userTimeNs,
              systemTimeNs,
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
        await invoke('homecloud_monitoring_set_active', { serverId, section: 'cpu' });
      } catch (error) {
        if (!disposed) {
          setTelemetry(previous => ({
            ...previous,
            phase: 'error',
            error: String(error),
          }));
        }
      }
    })();

    return () => {
      disposed = true;
      unlisten?.();
      void invoke('homecloud_monitoring_set_active', { serverId, section: null }).catch(() => undefined);
    };
  }, [serverId]);

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
