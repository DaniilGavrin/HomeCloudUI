import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

type MetricItem = {
  metric_id: string;
  object_id?: string;
  value: unknown;
  unit?: string;
  observed_at?: string;
};

export type CpuTopologyCore = {
  objectId: string;
  online: boolean | null;
  coreId: number | null;
  packageId: number | null;
  dieId: number | null;
  numaNodeId: number | null;
  vendor: string | null;
  model: string | null;
  family: string | null;
  modelId: string | null;
  stepping: number | null;
  features: string[];
};

export type CpuTopology = {
  phase: 'idle' | 'loading' | 'ready' | 'error' | 'offline';
  logicalCount: number | null;
  onlineCount: number | null;
  offlineCount: number | null;
  physicalCoreCount: number | null;
  packageCount: number | null;
  dieCount: number | null;
  numaNodeCount: number | null;
  architecture: string | null;
  cores: CpuTopologyCore[];
  observedAt: string | null;
  error: string | null;
};

const INITIAL: CpuTopology = {
  phase: 'idle',
  logicalCount: null,
  onlineCount: null,
  offlineCount: null,
  physicalCoreCount: null,
  packageCount: null,
  dieCount: null,
  numaNodeCount: null,
  architecture: null,
  cores: [],
  observedAt: null,
  error: null,
};

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTopology(items: MetricItem[]): Omit<CpuTopology, 'phase' | 'error'> {
  const summary = new Map<string, unknown>();
  const cpus = new Map<string, CpuTopologyCore>();
  let observedAt: string | null = null;

  for (const item of items) {
    if (typeof item.observed_at === 'string') observedAt = item.observed_at;
    if (!item.object_id) {
      summary.set(item.metric_id, item.value);
      continue;
    }
    const cpu = cpus.get(item.object_id) ?? {
      objectId: item.object_id,
      online: null,
      coreId: null,
      packageId: null,
      dieId: null,
      numaNodeId: null,
      vendor: null,
      model: null,
      family: null,
      modelId: null,
      stepping: null,
      features: [],
    };
    switch (item.metric_id) {
      case 'system.cpu.topology.online': cpu.online = typeof item.value === 'boolean' ? item.value : null; break;
      case 'system.cpu.topology.core_id': cpu.coreId = finiteNumber(item.value); break;
      case 'system.cpu.topology.package_id': cpu.packageId = finiteNumber(item.value); break;
      case 'system.cpu.topology.die_id': cpu.dieId = finiteNumber(item.value); break;
      case 'system.cpu.topology.numa_node_id': cpu.numaNodeId = finiteNumber(item.value); break;
      case 'system.cpu.topology.vendor': cpu.vendor = typeof item.value === 'string' ? item.value : null; break;
      case 'system.cpu.topology.model': cpu.model = typeof item.value === 'string' ? item.value : null; break;
      case 'system.cpu.topology.family': cpu.family = typeof item.value === 'string' ? item.value : null; break;
      case 'system.cpu.topology.model_id': cpu.modelId = typeof item.value === 'string' ? item.value : null; break;
      case 'system.cpu.topology.stepping': cpu.stepping = finiteNumber(item.value); break;
      case 'system.cpu.topology.features': cpu.features = Array.isArray(item.value) ? item.value.filter((value): value is string => typeof value === 'string') : []; break;
    }
    cpus.set(item.object_id, cpu);
  }

  const number = (id: string) => finiteNumber(summary.get(`system.cpu.topology.${id}`));
  const string = (id: string) => {
    const value = summary.get(`system.cpu.topology.${id}`);
    return typeof value === 'string' ? value : null;
  };

  return {
    logicalCount: number('logical_count'),
    onlineCount: number('online_count'),
    offlineCount: number('offline_count'),
    physicalCoreCount: number('physical_core_count'),
    packageCount: number('package_count'),
    dieCount: number('die_count'),
    numaNodeCount: number('numa_node_count'),
    architecture: string('architecture'),
    cores: [...cpus.values()]
      .filter(cpu => cpu.online !== null || cpu.coreId !== null || cpu.packageId !== null
        || cpu.dieId !== null || cpu.numaNodeId !== null || cpu.vendor !== null
        || cpu.model !== null || cpu.family !== null || cpu.modelId !== null
        || cpu.stepping !== null || cpu.features.length > 0)
      .sort((a, b) => a.objectId.localeCompare(b.objectId, undefined, { numeric: true })),
    observedAt,
  };
}

export function useHomeCloudCpuTopology(serverId: string | null, active: boolean, serverPhase: string) {
  const [topology, setTopology] = useState<CpuTopology>(INITIAL);
  const requestGeneration = useRef(0);

  const refresh = useCallback(async () => {
    if (!serverId || !active) return;
    const generation = ++requestGeneration.current;
    if (serverPhase === 'offline' || serverPhase === 'error') {
      setTopology({ ...INITIAL, phase: 'offline' });
      return;
    }
    setTopology(previous => ({ ...previous, phase: 'loading', error: null }));
    try {
      const result = await invoke<MetricItem[]>('homecloud_monitoring_get_topology', { serverId });
      if (generation !== requestGeneration.current) return;
      if (!Array.isArray(result)) throw new Error('Backend вернул некорректный формат топологии CPU');
      setTopology({ ...parseTopology(result), phase: 'ready', error: null });
    } catch (error) {
      if (generation === requestGeneration.current) {
        setTopology(previous => ({ ...previous, phase: 'error', error: String(error) }));
      }
    }
  }, [serverId, active, serverPhase]);

  useEffect(() => {
    if (!serverId || !active) {
      requestGeneration.current += 1;
      setTopology(INITIAL);
      return;
    }
    void refresh();
  }, [serverId, active, refresh]);

  return { topology, refresh };
}
