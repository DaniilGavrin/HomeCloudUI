import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type MediaRoom = {
  room_id: string;
  playback_id: string;
  generation: number;
  instance_id: string;
  sequence: number;
  revision: number;
  target: { node_id: string; device_id: string };
  room_state: string;
  playback_state: string;
  tv_attach: string;
  position_ms: number;
  volume: number | null;
  muted: boolean | null;
  seek_target_ms: number | null;
  control_status: string | null;
  control_action: string | null;
  control_error_code: string | null;
};

export type MediaServerView = {
  server_id: string;
  phase: 'offline' | 'loading' | 'ready' | 'error';
  instance_id: string | null;
  sequence: number;
  rooms: MediaRoom[];
  error: string | null;
  revision: number;
};

const empty = (serverId: string): MediaServerView =>
  ({ server_id: serverId, phase: 'offline', instance_id: null, sequence: 0, rooms: [], error: null, revision: -1 });

export function useHomeCloudMediaRooms(serverId: string) {
  const [snapshot, setSnapshot] = useState<MediaServerView>(() => empty(serverId));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    setSnapshot(empty(serverId));
    setError(null);
    const apply = (next: MediaServerView) => {
      if (active && next.server_id === serverId) {
        setSnapshot(previous => next.revision >= previous.revision ? next : previous);
      }
    };
    void (async () => {
      try {
        const dispose = await listen<MediaServerView>('homecloud:media-rooms', event => apply(event.payload));
        if (!active) { dispose(); return; }
        unlisten = dispose;
        apply(await invoke<MediaServerView>('homecloud_media_status', { serverId }));
      } catch (cause) { if (active) setError(String(cause)); }
    })();
    return () => { active = false; unlisten?.(); };
  }, [serverId]);
  return { snapshot, error };
}

export type MediaControlRequest = {
  serverId: string;
  deviceId: string;
  roomId: string;
  playbackId: string;
  generation: number;
  action: 'play' | 'pause' | 'resume' | 'volume' | 'mute' | 'seek' | 'stop';
  volume?: number;
  muted?: boolean;
  positionMs?: number;
};

export const sendMediaControl = (request: MediaControlRequest) =>
  invoke<Record<string, unknown>>('homecloud_media_command', request);

export const refreshMediaRooms = (serverId: string) =>
  invoke('homecloud_media_refresh', { serverId });
