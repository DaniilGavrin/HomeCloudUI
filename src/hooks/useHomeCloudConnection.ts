import { useHomeCloudPool } from './useHomeCloudPool';

export type ConnectionStatus = {
  phase: 'connecting' | 'online' | 'offline';
  latency_ms: number | null;
  revision: number;
};

/** Aggregate the real user-configured Backend pool; never represent a hidden
 * localhost connection as the HomeCloud connection status. */
export function useHomeCloudConnection(): ConnectionStatus {
  const { snapshot } = useHomeCloudPool();
  const ready = snapshot.servers.filter(s => s.phase === 'ready');
  const connecting = snapshot.servers.some(s => s.phase === 'connecting');
  const rtt = ready.map(s => s.latency_ms).filter((n): n is number => n !== null && Number.isFinite(n));
  return {
    phase: ready.length > 0 ? 'online' : connecting ? 'connecting' : 'offline',
    latency_ms: rtt.length ? Math.round(Math.min(...rtt)) : null,
    revision: snapshot.revision,
  };
}
