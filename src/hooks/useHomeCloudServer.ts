import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type ServerStatusData = {
  status?: string;
  collected_at?: string;
  system?: {
    hostname?: string; platform?: string; platform_family?: string; platform_version?: string;
    goos?: string; goarch?: string; os_family?: string; kernel_version?: string;
    kernel_arch?: string; timezone?: string; timezone_offset_seconds?: number;
    uptime_seconds?: number; boot_time_unix?: number; process_count?: number;
    virtualization?: { system?: string; role?: string };
  };
  cpu?: {
    model?: string; vendor?: string; physical_cores?: number; logical_cores?: number;
    frequency_mhz?: number; cache_kb?: number; features?: string[];
    usage_percent?: number; usage_per_core_percent?: number[];
  };
  memory?: { total_bytes?: number; available_bytes?: number; free_bytes?: number; used_bytes?: number; used_percent?: number };
  swap?: { total_bytes?: number; used_bytes?: number; free_bytes?: number; used_percent?: number };
  disks?: {
    partitions?: Array<{ device?: string; mountpoint?: string; filesystem?: string; total_bytes?: number; used_bytes?: number; free_bytes?: number; used_percent?: number; inodes_total?: number; inodes_used?: number; error?: string }>;
    io_counters?: Record<string, { read_bytes?: number; write_bytes?: number; read_operations?: number; write_operations?: number }>;
  };
  network?: { interfaces?: Array<{ name?: string; index?: number; mtu?: number; mac?: string; up?: boolean; loopback?: boolean; addresses?: string[]; address_error?: string; traffic?: { bytes_sent?: number; bytes_received?: number; packets_sent?: number; packets_received?: number } }> };
  backend?: {
    connections?: number; go_version?: string; pid?: number; logical_cpus_visible_to_go?: number;
    goroutines?: number; gomaxprocs?: number; cgo_calls?: number; threads?: number;
    started_at?: string; uptime_seconds?: number;
    process_memory?: { rss_bytes?: number; vms_bytes?: number };
    go_heap?: { allocated_bytes?: number; heap_in_use_bytes?: number; heap_objects?: number; gc_cycles?: number; total_allocated_bytes?: number };
  };
  load_average?: { one_minute?: number; five_minutes?: number; fifteen_minutes?: number };
  temperatures?: Array<{ sensor?: string; celsius?: number; high_celsius?: number; critical_celsius?: number }>;
  collection_errors?: Record<string, string>;
};

export type ServerSnapshot = {
  phase: 'offline' | 'loading' | 'ready' | 'error';
  data: ServerStatusData | null;
  error: string | null;
  revision: number;
};

const EVENT = 'homecloud:server-status';
const INITIAL: ServerSnapshot = { phase: 'offline', data: null, error: null, revision: -1 };

export function useHomeCloudServer() {
  const [snapshot, setSnapshot] = useState<ServerSnapshot>(INITIAL);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let dispose: (() => void) | undefined;
    const apply = (next: ServerSnapshot) => {
      if (!mounted) return;
      setSnapshot((previous) => next.revision >= previous.revision ? next : previous);
      setRefreshError(null);
    };
    const initialize = async () => {
      try {
        const unlisten = await listen<ServerSnapshot>(EVENT, (e) => apply(e.payload));
        if (!mounted) { unlisten(); return; }
        dispose = unlisten;
      } catch (error) {
        if (mounted) setRefreshError(`Не удалось подписаться на состояние сервера: ${String(error)}`);
      }
      try {
        apply(await invoke<ServerSnapshot>('homecloud_server_status'));
      } catch (error) {
        if (mounted) setRefreshError(`Не удалось прочитать сведения о сервере: ${String(error)}`);
      }
    };
    void initialize();
    return () => { mounted = false; dispose?.(); };
  }, []);

  const refresh = useCallback(async () => {
    setRefreshError(null);
    try {
      await invoke('homecloud_server_refresh');
    } catch (error) {
      setRefreshError(String(error));
    }
  }, []);
  return { snapshot, refresh, refreshError };
}
