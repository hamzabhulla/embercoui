import { useCallback, useEffect, useState } from 'react';
import type { MenuItem } from '../data/menu.ts';
import { fetchMenuItems } from './api.ts';

export type MenuStatus = 'loading' | 'ready' | 'error';

export interface MenuItemsState {
  /** Real items from the API. Empty while loading, after an error, and
   *  when the restaurant's menu is genuinely empty — never a fallback. */
  items: MenuItem[];
  status: MenuStatus;
  /** Re-run the fetch (used by the error state's Retry button). */
  retry: () => void;
}

/**
 * The site's menu, straight from the API — and nothing else (audit H-1).
 * An earlier version initialised state with a hardcoded copy of the menu
 * and kept it whenever the API failed or returned an empty list, so the
 * site silently sold stale dishes at stale prices and an admin could
 * never actually empty the menu. Now the three states are explicit and
 * every consumer renders them honestly: skeletons while loading, an
 * unavailable message + Retry on error, an "updating" note when the
 * menu is genuinely empty.
 */
export function useMenuItems(): MenuItemsState {
  const [items, setItems] = useState<MenuItem[]>([]);
  const [status, setStatus] = useState<MenuStatus>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    fetchMenuItems().then((remote) => {
      if (cancelled) return;
      if (remote === null) {
        setStatus('error');
        return;
      }
      setItems(remote);
      setStatus('ready');
    });
    return () => { cancelled = true; };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { items, status, retry };
}
