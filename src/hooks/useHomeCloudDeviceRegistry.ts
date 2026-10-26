import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type RegisteredDevice = {
  server_id: string;
  device_id: string;
  client_type: string;
  online: boolean;
  last_seen_at: number | null;
};

export type DeviceRegistrySnapshot = { devices: RegisteredDevice[]; revision: number };
const EVENT = 'homecloud:device-registry';
const EMPTY: DeviceRegistrySnapshot = { devices: [], revision: -1 };

export function useHomeCloudDeviceRegistry() {
  const [snapshot, setSnapshot] = useState<DeviceRegistrySnapshot>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    const apply = (next: DeviceRegistrySnapshot) => {
      if (active) setSnapshot(previous => next.revision >= previous.revision ? next : previous);
    };
    void (async () => {
      try {
        const dispose = await listen<DeviceRegistrySnapshot>(EVENT, event => apply(event.payload));
        if (!active) { dispose(); return; }
        unlisten = dispose;
        apply(await invoke<DeviceRegistrySnapshot>('homecloud_device_registry_status'));
      } catch (cause) {
        if (active) setError(String(cause));
      }
    })();
    return () => { active = false; unlisten?.(); };
  }, []);

  const forget = useCallback(async (device: Pick<RegisteredDevice, 'server_id' | 'device_id'>) => {
    await invoke('homecloud_device_forget', { serverId: device.server_id, deviceId: device.device_id });
  }, []);

  const refresh = useCallback(async (serverId: string) => {
    await invoke('homecloud_device_refresh', { serverId });
  }, []);

  const send = useCallback(async (device: Pick<RegisteredDevice, 'server_id' | 'device_id'>, payload: Record<string, unknown>) => {
    return invoke<string>('homecloud_device_send', { serverId: device.server_id, deviceId: device.device_id, payload });
  }, []);

  return { snapshot, error, forget, refresh, send };
}
