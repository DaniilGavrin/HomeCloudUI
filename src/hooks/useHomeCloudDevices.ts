import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type ConnectedDevice = {
  device_id: string;
  client_type: string;
};

export type DevicesSnapshot = {
  phase: 'offline' | 'loading' | 'ready' | 'error';
  devices: ConnectedDevice[];
  error: string | null;
  revision: number;
};

const EVENT = 'homecloud:devices-updated';
const INITIAL: DevicesSnapshot = { phase: 'offline', devices: [], error: null, revision: -1 };

export function useHomeCloudDevices() {
  const [snapshot, setSnapshot] = useState<DevicesSnapshot>(INITIAL);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;
    const apply = (incoming: DevicesSnapshot) => {
      if (!mounted) return;
      setSnapshot((previous) => incoming.revision >= previous.revision ? incoming : previous);
      setRefreshError(null);
    };
    const init = async () => {
      try {
        const dispose = await listen<DevicesSnapshot>(EVENT, (event) => apply(event.payload));
        if (!mounted) { dispose(); return; }
        unlisten = dispose;
      } catch (error) {
        console.error('[HomeCloud Devices] Event subscription failed:', error);
      }
      try {
        apply(await invoke<DevicesSnapshot>('homecloud_devices_status'));
      } catch (error) {
        console.error('[HomeCloud Devices] Initial state failed:', error);
        if (mounted) setRefreshError(String(error));
      }
    };
    void init();
    return () => { mounted = false; unlisten?.(); };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshError(null);
    try {
      await invoke('homecloud_devices_refresh');
    } catch (error) {
      setRefreshError(String(error));
    }
  }, []);

  return { snapshot, refresh, refreshError };
}
