import { useEffect, useState } from 'react';
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
  payload: Record<string, unknown>;
  target: string;
};

export type CpuCStateTelemetry = {
  metricId: string;
  objectId: string;
  residencyNs: string;
};

export type CpuThrottleTelemetry = {
  metricId: string;
  objectId: string;
  value: string;
  unit: string;
};

export type CpuExtendedTelemetry = {
  cstates: CpuCStateTelemetry[];
  throttling: CpuThrottleTelemetry[];
  interrupts: string | null;
  contextSwitches: string | null;
  cstatesError: string | null;
  throttlingError: string | null;
  interruptsError: string | null;
  contextSwitchesError: string | null;
  observedAt: string | null;
};

const INITIAL: CpuExtendedTelemetry = {
  cstates: [],
  throttling: [],
  interrupts: null,
  contextSwitches: null,
  cstatesError: null,
  throttlingError: null,
  interruptsError: null,
  contextSwitchesError: null,
  observedAt: null,
};

const EVENT = 'homecloud:monitoring';
const CSTATE = 'system.cpu.idle.cstate';
const THROTTLING = 'system.cpu.throttling';
const INTERRUPTS = 'system.cpu.interrupts';
const CONTEXT_SWITCHES = 'system.cpu.context_switches';

function exactInteger(value: number | string): string | null {
  const text = String(value);
  return /^\\d+$/.test(text) ? text : null;
}

function errorMessage(payload: Record<string, unknown>, fallback: string): string {
  const error = payload.error as { message?: unknown; code?: unknown } | undefined;
  if (typeof error?.message === 'string') return error.message;
  if (typeof error?.code === 'string') return error.code;
  return fallback;
}

export function useHomeCloudCpuExtendedMonitoring(
  serverId: string | null,
  activeSection: string,
  serverPhase: string,
): CpuExtendedTelemetry {
  const [telemetry, setTelemetry] = useState<CpuExtendedTelemetry>(INITIAL);

  useEffect(() => {
    if (!serverId || activeSection !== 'cpu' || serverPhase === 'offline' || serverPhase === 'error') {
      setTelemetry(INITIAL);
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<MonitoringEvent>(EVENT, event => {
      const message = event.payload;
      if (message.server_id !== serverId) return;
      const target = message.target;
      if (![CSTATE, THROTTLING, INTERRUPTS, CONTEXT_SWITCHES].includes(target)) return;

      const subscriptionId = typeof message.payload.subscription_id === 'string'
        ? message.payload.subscription_id
        : null;

      if (message.kind === 'created') {
        setTelemetry(previous => {
          if (target === CSTATE) return { ...previous, cstates: [], cstatesError: null };
          if (target === THROTTLING) return { ...previous, throttling: [], throttlingError: null };
          if (target === INTERRUPTS) return { ...previous, interrupts: null, interruptsError: null };
          return { ...previous, contextSwitches: null, contextSwitchesError: null };
        });
        return;
      }

      if (message.kind === 'error') {
        const error = errorMessage(message.payload, 'Источник метрики недоступен');
        setTelemetry(previous => ({
          ...previous,
          ...(target === CSTATE ? { cstatesError: error } : {}),
          ...(target === THROTTLING ? { throttlingError: error } : {}),
          ...(target === INTERRUPTS ? { interruptsError: error } : {}),
          ...(target === CONTEXT_SWITCHES ? { contextSwitchesError: error } : {}),
        }));
        return;
      }

      if (message.kind !== 'update') return;
      const items = Array.isArray(message.payload.items) ? message.payload.items as MetricItem[] : [];
      setTelemetry(previous => {
        if (target === CSTATE) {
          const cstates = items
            .filter(item => item.metric_id.startsWith(CSTATE + '.') && item.object_id)
            .map(item => ({
              metricId: item.metric_id,
              objectId: item.object_id!,
              residencyNs: exactInteger(item.value) ?? '0',
            }))
            .filter(item => item.residencyNs !== '0' || items.some(source => source.metric_id === item.metricId && source.object_id === item.objectId && String(source.value) === '0'))
            .sort((a, b) => a.objectId.localeCompare(b.objectId, undefined, { numeric: true }) || a.metricId.localeCompare(b.metricId));
          return { ...previous, cstates, cstatesError: null, observedAt: items[0]?.observed_at ?? previous.observedAt };
        }
        if (target === THROTTLING) {
          const throttling = items
            .filter(item => item.metric_id.startsWith(THROTTLING + '.'))
            .map(item => ({
              metricId: item.metric_id,
              objectId: item.object_id ?? 'host',
              value: exactInteger(item.value) ?? '0',
              unit: item.unit,
            }))
            .sort((a, b) => a.metricId.localeCompare(b.metricId) || a.objectId.localeCompare(b.objectId, undefined, { numeric: true }));
          return { ...previous, throttling, throttlingError: null, observedAt: items[0]?.observed_at ?? previous.observedAt };
        }
        const value = items.find(item => item.metric_id === target);
        const counter = value ? exactInteger(value.value) : null;
        if (target === INTERRUPTS) return { ...previous, interrupts: counter ?? previous.interrupts, interruptsError: null, observedAt: value?.observed_at ?? previous.observedAt };
        return { ...previous, contextSwitches: counter ?? previous.contextSwitches, contextSwitchesError: null, observedAt: value?.observed_at ?? previous.observedAt };
      });
      void subscriptionId;
    }).then(stop => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(error => {
      if (!disposed) setTelemetry(previous => ({ ...previous, cstatesError: String(error) }));
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [serverId, activeSection, serverPhase]);

  return telemetry;
}
