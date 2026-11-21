import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

type MonitoringEvent = {
  server_id: string;
  kind: 'created' | 'update' | 'error';
  target: string;
  payload: Record<string, unknown>;
};
type CpuPanelTelemetry = {
  phase: 'connecting' | 'streaming' | 'offline' | 'error';
  totalUsage: number | null;
  readyFor: string | null;
};
const INITIAL: CpuPanelTelemetry = { phase: 'connecting', totalUsage: null, readyFor: null };
const EVENT = 'homecloud:monitoring';

function finitePercent(value: unknown): number | null {
  const parsed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.max(0, Math.min(100, parsed)) : null;
}

export function useHomeCloudCpuPanel(serverId: string | null, serverPhase: string): CpuPanelTelemetry {
  const [telemetry, setTelemetry] = useState<CpuPanelTelemetry>(INITIAL);
  useEffect(() => {
    if (!serverId) { setTelemetry(INITIAL); return; }
    let disposed = false;
    let unlisten: (() => void) | undefined;
    setTelemetry({
      phase: serverPhase === 'offline' || serverPhase === 'error' ? 'offline' : 'connecting',
      totalUsage: null,
      readyFor: null,
    });
    void (async () => {
      try {
        const stop = await listen<MonitoringEvent>(EVENT, event => {
          const message = event.payload;
          if (message.server_id !== serverId || message.target !== 'system.cpu.totalusage') return;
          if (message.kind === 'created') {
            setTelemetry(previous => ({ ...previous, phase: 'streaming' }));
            return;
          }
          if (message.kind === 'error') {
            setTelemetry(previous => ({ ...previous, phase: 'error' }));
            return;
          }
          if (message.kind !== 'update') return;
          const items = Array.isArray(message.payload.items)
            ? message.payload.items as Array<{ metric_id?: unknown; value?: unknown }>
            : [];
          const item = items.find(candidate => candidate.metric_id === 'system.cpu.totalusage');
          if (!item) return;
          const value = finitePercent(item.value);
          if (value !== null) setTelemetry(previous => ({ ...previous, phase: 'streaming', totalUsage: value }));
        });
        if (disposed) { stop(); return; }
        unlisten = stop;
        setTelemetry(previous => ({ ...previous, readyFor: serverId }));
      } catch {
        if (!disposed) setTelemetry(previous => ({ ...previous, phase: 'error' }));
      }
    })();
    return () => { disposed = true; unlisten?.(); };
  }, [serverId]);

  useEffect(() => {
    if (serverPhase === 'offline' || serverPhase === 'error') {
      setTelemetry(previous => ({ ...previous, phase: 'offline', totalUsage: null }));
    } else if (serverPhase === 'ready') {
      setTelemetry(previous => previous.phase === 'offline'
        ? { phase: 'connecting', totalUsage: null, readyFor: previous.readyFor }
        : previous);
    }
  }, [serverPhase]);
  return telemetry;
}
