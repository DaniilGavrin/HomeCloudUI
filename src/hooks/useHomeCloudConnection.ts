import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type ConnectionStatus = {
  phase: 'connecting' | 'online' | 'offline';
  latency_ms: number | null;
  revision: number;
};

const EVENT_NAME = 'homecloud:connection-status';
const STARTING_STATUS: ConnectionStatus = {
  phase: 'connecting',
  latency_ms: null,
  revision: -1,
};

export function useHomeCloudConnection(): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>(STARTING_STATUS);

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | null = null;

    const apply = (incoming: ConnectionStatus) => {
      if (!mounted) return;
      // Events can arrive while the initial invoke is still in flight.
      setStatus((current) => incoming.revision >= current.revision ? incoming : current);
    };

    const subscribeAndSync = async () => {
      try {
        const stop = await listen<ConnectionStatus>(EVENT_NAME, (event) => {
          apply(event.payload);
        });
        if (!mounted) {
          stop();
          return;
        }
        unlisten = stop;
      } catch (error) {
        console.error('[HomeCloud] Cannot subscribe to Rust connection updates:', error);
      }

      try {
        const current = await invoke<ConnectionStatus>('homecloud_connection_status');
        apply(current);
      } catch (error) {
        console.error('[HomeCloud] Cannot read Rust connection status:', error);
        if (mounted) {
          setStatus((current) => current.revision < 0
            ? { phase: 'offline', latency_ms: null, revision: -1 }
            : current);
        }
      }
    };

    void subscribeAndSync();
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  return status;
}
