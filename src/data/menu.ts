/**
 * Menu domain types + small pure helpers.
 *
 * The menu itself lives ONLY in the backend (Admin-editable in Supabase).
 * There is deliberately no built-in item list here: an earlier version
 * shipped a hardcoded copy that was silently rendered whenever the API
 * failed or returned an empty list — selling stale dishes at stale
 * prices (audit H-1). Consumers get real data via useMenuItems() and
 * must handle its loading / error / empty states honestly.
 */
export interface MenuItem {
  id: number;
  name: string;
  description: string;
  price: number;
  image: string;
  category: string;
  /** Dietary tags from the API (e.g. 'Vegan'); may be absent. */
  tags?: string[];
}

/**
 * Category tabs/sidebar entries derived from the items themselves —
 * unique categories in first-seen (menu) order, 'All' first. Deriving
 * instead of hardcoding means a category created or renamed in the
 * admin panel appears on the site immediately (audit M-6).
 */
export function deriveCategories(items: MenuItem[]): string[] {
  const seen: string[] = [];
  for (const item of items) {
    if (item.category && !seen.includes(item.category)) seen.push(item.category);
  }
  return ['All', ...seen];
}
