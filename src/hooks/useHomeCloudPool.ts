import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ServerStatusData } from './useHomeCloudServer';

export type PoolServer = {
  id: string;
  name: string;
  ipv4: string | null;
  ipv6: string | null;
  builtin: boolean;
  phase: 'offline' | 'connecting' | 'ready' | 'error';
  latency_ms: number | null;
  data: ServerStatusData | null;
  error: string | null;
};
export type PoolSnapshot = { servers: PoolServer[]; revision: number };
export type ServerPoolInput = { name: string; ipv4: string | null; ipv6: string | null };
const EVENT = 'homecloud:server-pool';
const EMPTY: PoolSnapshot = { servers: [], revision: -1 };

export function useHomeCloudPool() {
  const [snapshot, setSnapshot] = useState<PoolSnapshot>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    let dispose: (() => void) | undefined;
    const apply = (next: PoolSnapshot) => {
      if (live) setSnapshot(prev => next.revision >= prev.revision ? next : prev);
    };
    void (async () => {
      try {
        const unlisten = await listen<PoolSnapshot>(EVENT, event => apply(event.payload));
        if (!live) { unlisten(); return; }
        dispose = unlisten;
        apply(await invoke<PoolSnapshot>('homecloud_pool_status'));
      } catch (e) { if (live) setError(String(e)); }
    })();
    return () => { live = false; dispose?.(); };
  }, []);

  const add = useCallback(async (input: ServerPoolInput) => {
    const next = await invoke<PoolSnapshot>('homecloud_pool_add', { input });
    setSnapshot(prev => next.revision >= prev.revision ? next : prev);
  }, []);
  const update = useCallback(async (id: string, input: ServerPoolInput) => {
    const next = await invoke<PoolSnapshot>('homecloud_pool_update', { id, input });
    setSnapshot(prev => next.revision >= prev.revision ? next : prev);
  }, []);
  const remove = useCallback(async (id: string) => {
    const next = await invoke<PoolSnapshot>('homecloud_pool_delete', { id });
    setSnapshot(prev => next.revision >= prev.revision ? next : prev);
  }, []);
  const refresh = useCallback(async (id: string) => {
    if (id === 'primary') {
      await invoke('homecloud_server_refresh');
    } else {
      await invoke('homecloud_pool_refresh', { id });
    }
  }, []);

  return { snapshot, error, add, update, remove, refresh };
}
