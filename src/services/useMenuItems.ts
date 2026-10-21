import { useEffect, useState } from 'react';
import { menuItems as localMenuItems, type MenuItem } from '../data/menu.ts';
import { fetchMenuItems } from './api.ts';

/**
 * Menu items from the API, with the site's built-in menu as the initial
 * value and as the fallback when the API is unreachable — so the page
 * renders exactly as before on first paint and never goes empty.
 */
export function useMenuItems(): MenuItem[] {
  const [items, setItems] = useState<MenuItem[]>(localMenuItems);
  useEffect(() => {
    let cancelled = false;
    fetchMenuItems().then((remote) => {
      if (!cancelled && remote) setItems(remote);
    });
    return () => { cancelled = true; };
  }, []);
  return items;
}
