/**
 * UI-only classification of the Backend's client_type. The authoritative
 * identity stays (server_id, device_id); never infer TV from device_id.
 */
export type DeviceKind = 'desktop' | 'mobile' | 'tv' | 'server' | 'other';

export function kindOf(clientType: string): DeviceKind {
  const normalized = clientType.trim().toLowerCase().replace(/[_\s]+/g, '-');
  const tokens = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  const isAny = (...values: string[]) => values.some(value => tokens.includes(value));

  // TV Player currently registers the canonical client_type "tv".
  // Accept historical/third-party descriptors, without treating a random
  // substring such as "activity" as a television.
  if (isAny('tv', 'television', 'tizen', 'webos', 'androidtv')
      || normalized === 'smarttv' || normalized === 'tvplayer'
      || normalized === 'web-os') {
    return 'tv';
  }
  if (isAny('phone', 'mobile', 'android', 'ios', 'tablet', 'touch')) return 'mobile';
  if (isAny('server', 'agent', 'backend', 'node', 'hub', 'gateway', 'storage')) return 'server';
  if (isAny('desktop', 'pc', 'computer', 'laptop', 'windows', 'linux', 'mac')) return 'desktop';
  return 'other';
}
