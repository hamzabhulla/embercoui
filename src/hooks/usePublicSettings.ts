import { useEffect, useState } from 'react';
import { fetchPublicSettings, type PublicSettings } from '../services/api.ts';

// One fetch per page load, shared by every component that needs the
// public settings (navbar brand, footer, contact page, reservation
// section…): the first caller starts it, everyone else reuses the same
// promise. A failed fetch resolves null — callers render their loading
// placeholder and no contact details rather than inventing any.
let cached: Promise<PublicSettings | null> | null = null;

function loadPublicSettings(): Promise<PublicSettings | null> {
  if (!cached) {
    cached = fetchPublicSettings().then((s) => {
      // A failed fetch must not poison the whole session: drop the
      // cached promise so the next component that mounts retries.
      if (s === null) cached = null;
      return s;
    });
  }
  return cached;
}

/** The public restaurant settings, or null while loading / after a failed fetch. */
export function usePublicSettings(): PublicSettings | null {
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  useEffect(() => {
    let alive = true;
    loadPublicSettings().then((s) => {
      if (alive) setSettings(s);
    });
    return () => {
      alive = false;
    };
  }, []);
  return settings;
}

/**
 * Display lines for the settings' openingHours record. The admin stores
 * free-form keys; the known `weekdays` / `weekends` string keys get
 * labelled lines, and any other string entry is shown as "key: value"
 * so no stored hour is silently dropped.
 */
export function openingHoursLines(settings: PublicSettings | null): string[] {
  const hours = settings?.openingHours;
  if (!hours || typeof hours !== 'object') return [];
  const lines: string[] = [];
  if (typeof hours.weekdays === 'string' && hours.weekdays) lines.push(`Weekdays: ${hours.weekdays}`);
  if (typeof hours.weekends === 'string' && hours.weekends) lines.push(`Weekends: ${hours.weekends}`);
  for (const [key, value] of Object.entries(hours)) {
    if (key === 'weekdays' || key === 'weekends') continue;
    if (typeof value === 'string' && value) lines.push(`${key}: ${value}`);
  }
  return lines;
}
