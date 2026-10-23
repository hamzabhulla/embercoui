import type {
  PartialPermissionMap,
  PermissionLevel,
  PermissionMap,
  ProfileDTO,
  Repository,
} from '../repositories/types';

/**
 * Owner-controlled section permissions (Phase A of the access system).
 *
 * The admin panel is twelve sections; for each one a person holds
 * 'none' | 'view' | 'manage'. Effective permissions resolve per request,
 * server-side, in this order (first hit wins, per section):
 *
 *   1. the Owner (role 'admin') — always 'manage' on everything,
 *      hard-coded here; nothing stored in the database can reduce it;
 *   2. the person's own overrides (profiles.permissions, migration 0012);
 *   3. the owner-edited role defaults (role_permissions row, 0012);
 *   4. the built-in defaults below;
 *   5. 'none'.
 *
 * Because resolution happens on every request from the live profile and
 * role rows, an owner's permission change takes effect on the very next
 * request — no re-login, no cache to invalidate.
 *
 * Degradation: until migration 0012 runs, the repository's reads of the
 * new table/column degrade to "absent" (null), and this module simply
 * falls through to the built-in defaults — which mirror today's gates —
 * so pre-migration behavior is exactly today's behavior.
 */

export const SECTION_KEYS = [
  'dashboard', 'orders', 'reservations', 'menu', 'customers', 'reviews',
  'newsletter', 'coupons', 'finance', 'staff', 'settings', 'security',
] as const;

export const PERMISSION_LEVELS = ['none', 'view', 'manage'] as const;

const LEVEL_RANK: Record<PermissionLevel, number> = { none: 0, view: 1, manage: 2 };

export function levelAtLeast(level: PermissionLevel, required: PermissionLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[required];
}

function fullMap(fill: PermissionLevel, overrides: PartialPermissionMap): PermissionMap {
  const out = {} as PermissionMap;
  for (const section of SECTION_KEYS) out[section] = overrides[section] ?? fill;
  return out;
}

export const OWNER_PERMISSIONS: PermissionMap = fullMap('manage', {});
export const NO_PERMISSIONS: PermissionMap = fullMap('none', {});

/**
 * Built-in role defaults — used before migration 0012 runs, as the
 * fall-through when no role_permissions row exists, and as the seed
 * values migration 0012 inserts.
 *
 * Manager (per the approved plan): runs the floor — orders, reservations,
 * menu and reviews at manage; dashboard, customers, newsletter and
 * coupons visible; finance, staff, settings and security closed.
 *
 * Staff mirrors today's ACTUAL gates in the pre-Phase-A routes
 * (adminRouter's router-wide admin+staff grant plus its per-route
 * admin-only exceptions):
 *   - dashboard/orders/reservations: staff had full read + mutate access
 *     (incl. creating walk-in reservations) → manage.
 *   - menu: staff could create, edit and upload images; only DELETE was
 *     admin-only. The three-level model cannot express "mutate but not
 *     delete", so staff get 'manage' — DELETE /admin/menu/:id moves from
 *     admin-only to menu:manage. Documented, deliberate widening: the
 *     owner's lever is dropping staff to menu 'view' (read-only).
 *   - reviews: same shape (approve was staff-allowed, delete admin-only)
 *     → 'manage', with the same documented widening for DELETE.
 *   - coupons: staff could read the list but not create/edit/delete → view.
 *   - customers/newsletter/finance/staff/settings: admin-only today → none.
 *   - security: does not exist yet (Phase C) → none for everyone but owner.
 */
export const BUILT_IN_DEFAULTS: Record<'manager' | 'staff', PermissionMap> = {
  manager: fullMap('none', {
    dashboard: 'view',
    orders: 'manage',
    reservations: 'manage',
    menu: 'manage',
    customers: 'view',
    reviews: 'manage',
    newsletter: 'view',
    coupons: 'view',
  }),
  staff: fullMap('none', {
    dashboard: 'view',
    orders: 'manage',
    reservations: 'manage',
    menu: 'manage',
    reviews: 'manage',
    coupons: 'view',
  }),
};

/**
 * Settings-style sanitisation for permission maps arriving from the
 * database or a request body: only known sections with valid levels
 * survive; anything else (unknown section, bogus level, non-object) is
 * dropped. Returns null when the input is not a plain object at all, and
 * an object (possibly empty) otherwise.
 */
export function sanitizePermissionMap(raw: unknown): PartialPermissionMap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: PartialPermissionMap = {};
  for (const section of SECTION_KEYS) {
    const value = (raw as Record<string, unknown>)[section];
    if (value === 'none' || value === 'view' || value === 'manage') out[section] = value;
  }
  return out;
}

/**
 * Pure resolution: the effective map for a role given the stored role
 * defaults and the person's overrides (either may be null/absent). Both
 * stored maps are sanitised on the way in, so even a hand-planted
 * garbage row can never produce an invalid level — repository reads
 * sanitise too; this is the second, airtight layer.
 */
export function resolvePermissions(
  role: string,
  roleDefaults: PartialPermissionMap | null,
  overrides: PartialPermissionMap | null,
): PermissionMap {
  if (role === 'admin') return { ...OWNER_PERMISSIONS };
  if (role !== 'manager' && role !== 'staff') return { ...NO_PERMISSIONS };
  const builtIn = BUILT_IN_DEFAULTS[role];
  const cleanDefaults = sanitizePermissionMap(roleDefaults);
  const cleanOverrides = sanitizePermissionMap(overrides);
  const out = {} as PermissionMap;
  for (const section of SECTION_KEYS) {
    out[section] = cleanOverrides?.[section] ?? cleanDefaults?.[section] ?? builtIn[section];
  }
  return out;
}

/**
 * Resolve a loaded profile's effective permissions against the
 * repository (one small role_permissions read). Repository degradation
 * (pre-0012) makes getRolePermissions return null, which resolves to
 * the built-in defaults — never an error.
 */
export async function effectivePermissionsFor(
  repo: Repository,
  profile: Pick<ProfileDTO, 'role' | 'permissions'>,
): Promise<PermissionMap> {
  if (profile.role === 'admin') return { ...OWNER_PERMISSIONS };
  if (profile.role !== 'manager' && profile.role !== 'staff') return { ...NO_PERMISSIONS };
  const roleDefaults = await repo.getRolePermissions(profile.role);
  return resolvePermissions(profile.role, roleDefaults, profile.permissions);
}
