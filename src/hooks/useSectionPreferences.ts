import { useCallback, useEffect, useState } from 'react';
import { navigationItems } from '../data/navigation';

export type SectionId = Exclude<(typeof navigationItems)[number]['id'], 'home' | 'settings'>;
export type SectionPreferences = Record<SectionId, boolean>;

const STORAGE_KEY = 'homecloud:section-preferences:v1';
const STORAGE_VERSION = 1;

const SECTION_IDS = navigationItems
  .filter((item) => item.id !== 'home' && item.id !== 'settings')
  .map((item) => item.id) as SectionId[];

const DEFAULT_PREFERENCES = Object.fromEntries(
  SECTION_IDS.map((id) => [id, true]),
) as SectionPreferences;

function normalizePreferences(value: unknown): SectionPreferences {
  if (!value || typeof value !== 'object') return { ...DEFAULT_PREFERENCES };

  const record = value as Record<string, unknown>;
  const stored = record.version === STORAGE_VERSION && record.sections && typeof record.sections === 'object'
    ? record.sections as Record<string, unknown>
    : record;

  return Object.fromEntries(
    SECTION_IDS.map((id) => [id, typeof stored[id] === 'boolean' ? stored[id] : DEFAULT_PREFERENCES[id]]),
  ) as SectionPreferences;
}

function readPreferences(): SectionPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    return normalizePreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function useSectionPreferences() {
  const [sections, setSections] = useState<SectionPreferences>(readPreferences);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: STORAGE_VERSION,
        sections,
      }));
    } catch {
      // Keep the current session functional if persistent storage is unavailable.
    }
  }, [sections]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY || event.newValue === null) return;
      try {
        setSections(normalizePreferences(JSON.parse(event.newValue)));
      } catch {
        setSections({ ...DEFAULT_PREFERENCES });
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setEnabled = useCallback((id: SectionId, enabled: boolean) => {
    setSections((current) => ({ ...current, [id]: enabled }));
  }, []);

  return { sections, setEnabled };
}
