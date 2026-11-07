import { filesystemVolumes, type HcssAgent } from '../storage/hcssModel';

// Counts only mounted filesystem inventory, never sums physical block devices
// and their corresponding mounts as though they were separate capacities.
export function inventoryTotals(agents: HcssAgent[]) {
  return agents.reduce((sum, agent) => ({
    nodes: sum.nodes + 1,
    online: sum.online + Number(agent.online),
    filesystems: sum.filesystems + new Set(filesystemVolumes(agent.volumes).map(v => v.volume_id)).size,
    blockDevices: sum.blockDevices + new Set((agent.volumes ?? [])
      .filter(v => v.kind === 'block').map(v => v.volume_id)).size,
    roots: sum.roots + (agent.roots?.length ?? 0),
    browsable: sum.browsable + (agent.roots?.filter(v => v.online && v.allow_list).length ?? 0),
  }), { nodes: 0, online: 0, filesystems: 0, blockDevices: 0, roots: 0, browsable: 0 });
}

export function capacityOf(total: number, free: number) {
  const size = Number.isFinite(total) ? Math.max(0, total) : 0;
  const unused = Number.isFinite(free) ? Math.min(size, Math.max(0, free)) : 0;
  const used = size - unused;
  return { used, percent: size > 0 ? Math.min(100, Math.round(100 * used / size)) : 0 };
}
