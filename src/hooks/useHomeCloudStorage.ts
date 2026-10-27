import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open, save } from '@tauri-apps/plugin-dialog';

export type StorageVolume = {
  storage_id: string;
  name: string;
  path: string;
  priority: number;
  enabled: boolean;
  online: boolean;
  available_bytes: number;
  total_bytes: number;
};
export type StoredFile = {
  file_id: string;
  storage_id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
  uploaded_by: string;
};
export type StorageProgress = {
  server_id: string;
  transfer_id: string;
  role: 'upload' | 'download';
  completed_bytes: number;
  total_bytes: number;
};
type Transfer = { transfer_id: string; role: 'upload' | 'download'; size_bytes: number };
type LocalFile = { name: string; size_bytes: number; mime_type: string };

async function command<T>(serverId: string, action: string, data: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>('homecloud_storage_command', { serverId, action, data });
}

export function useHomeCloudStorage() {
  const [progress, setProgress] = useState<StorageProgress | null>(null);
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<StorageProgress>('homecloud:storage-progress', event => {
      if (!disposed) setProgress(event.payload);
    }).then(stop => { if (disposed) stop(); else unlisten = stop; }).catch(console.error);
    return () => { disposed = true; unlisten?.(); };
  }, []);

  const listVolumes = useCallback(async (serverId: string): Promise<StorageVolume[]> => {
    const result = await command<{ storages: StorageVolume[] }>(serverId, 'storage.list');
    return result.storages ?? [];
  }, []);
  const listFiles = useCallback(async (serverId: string, storageId = ''): Promise<StoredFile[]> => {
    const result = await command<{ files: StoredFile[] }>(serverId, 'storage.files.list', { storage_id: storageId, limit: 500 });
    return result.files ?? [];
  }, []);
  const register = useCallback(async (serverId: string, name: string, path: string, priority: number) => {
    return command<StorageVolume>(serverId, 'storage.register', { name, path, priority });
  }, []);

  const upload = useCallback(async (serverId: string, storageId: string): Promise<string | null> => {
    const filePath = await open({ multiple: false, directory: false, title: 'Файл для загрузки в HomeCloud' });
    if (!filePath || Array.isArray(filePath)) return null;
    const local = await invoke<LocalFile>('homecloud_storage_local_file', { filePath });
    const transfer = await command<Transfer>(serverId, 'storage.upload.prepare', {
      name: local.name, mime_type: local.mime_type, size_bytes: local.size_bytes,
      storage_id: storageId || 'auto',
    });
    setProgress({ server_id: serverId, transfer_id: transfer.transfer_id, role: 'upload', completed_bytes: 0, total_bytes: transfer.size_bytes });
    try {
      await invoke('homecloud_storage_transfer', { serverId, role: 'upload', transfer, filePath });
      return local.name;
    } catch (error) {
      await command(serverId, 'storage.transfer.cancel', { transfer_id: transfer.transfer_id }).catch(() => {});
      throw error;
    } finally { setProgress(null); }
  }, []);

  const download = useCallback(async (serverId: string, file: StoredFile): Promise<string | null> => {
    const filePath = await save({ defaultPath: file.name.replace(/[\\/:*?"<>|]/g, '_'), title: 'Сохранить файл из HomeCloud' });
    if (!filePath) return null;
    const transfer = await command<Transfer>(serverId, 'storage.download.prepare', { file_id: file.file_id });
    setProgress({ server_id: serverId, transfer_id: transfer.transfer_id, role: 'download', completed_bytes: 0, total_bytes: transfer.size_bytes });
    try {
      await invoke('homecloud_storage_transfer', { serverId, role: 'download', transfer, filePath });
      return filePath;
    } catch (error) {
      await command(serverId, 'storage.transfer.cancel', { transfer_id: transfer.transfer_id }).catch(() => {});
      throw error;
    } finally { setProgress(null); }
  }, []);

  return { progress, listVolumes, listFiles, register, upload, download };
}
