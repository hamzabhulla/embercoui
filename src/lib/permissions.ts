/**
 * Admin section permissions (Phase A) — the client mirror of the
 * backend model in backend/src/lib/permissions.ts. The backend resolves
 * and enforces the effective map on every request (GET /admin/me hands
 * it to the shell); this module only shapes UI: which nav items and
 * pages render, and which controls a 'view' holder does not get. It is
 * never a security boundary — the API 403s regardless.
 */

export type SectionKey =
  | 'dashboard' | 'orders' | 'reservations' | 'menu' | 'customers' | 'reviews'
  | 'newsletter' | 'coupons' | 'finance' | 'staff' | 'settings' | 'security';

export type PermissionLevel = 'none' | 'view' | 'manage';

export type PermissionMap = Record<SectionKey, PermissionLevel>;
export type PartialPermissionMap = Partial<Record<SectionKey, PermissionLevel>>;

export const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'orders', label: 'Orders' },
  { key: 'reservations', label: 'Reservations' },
  { key: 'menu', label: 'Menu' },
  { key: 'customers', label: 'Customers' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'newsletter', label: 'Newsletter' },
  { key: 'coupons', label: 'Coupons' },
  { key: 'finance', label: 'Finance' },
  { key: 'staff', label: 'Staff' },
  { key: 'settings', label: 'Settings' },
  { key: 'security', label: 'Security & Activity' },
];

export const LEVELS: PermissionLevel[] = ['none', 'view', 'manage'];

const RANK: Record<PermissionLevel, number> = { none: 0, view: 1, manage: 2 };

export function levelAtLeast(level: PermissionLevel | undefined, required: PermissionLevel): boolean {
  return RANK[level ?? 'none'] >= RANK[required];
}

/**
 * The effective value of one section for the permission editors: the
 * per-person override when one is set, otherwise the role default.
 * Mirrors the backend's per-section precedence (person > role).
 */
export function effectiveLevel(
  roleDefault: PermissionMap,
  overrides: PartialPermissionMap,
  section: SectionKey,
): PermissionLevel {
  return overrides[section] ?? roleDefault[section];
}

/** True when every section in the map is 'none' (a stripped account). */
export function hasAnyAccess(permissions: PermissionMap): boolean {
  return SECTIONS.some(({ key }) => permissions[key] !== 'none');
}
