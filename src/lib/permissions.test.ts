import { describe, expect, it } from 'vitest';
import {
  SECTIONS, effectiveLevel, hasAnyAccess, levelAtLeast,
  type PermissionMap,
} from './permissions';

// Phase A — the permission editors' merge helper. The backend resolves
// the effective map authoritatively (person override > role default >
// built-in); these pins keep the editor's displayed values on the same
// precedence, so what the owner sees is what the person gets.

const roleDefault: PermissionMap = Object.fromEntries(
  SECTIONS.map((s) => [s.key, 'none']),
) as PermissionMap;
roleDefault.orders = 'manage';
roleDefault.coupons = 'view';

describe('effectiveLevel', () => {
  it('falls back to the role default when no override is set', () => {
    expect(effectiveLevel(roleDefault, {}, 'orders')).toBe('manage');
    expect(effectiveLevel(roleDefault, {}, 'finance')).toBe('none');
  });

  it('a person override wins over the role default in both directions', () => {
    expect(effectiveLevel(roleDefault, { orders: 'view' }, 'orders')).toBe('view');
    expect(effectiveLevel(roleDefault, { coupons: 'manage' }, 'coupons')).toBe('manage');
    expect(effectiveLevel(roleDefault, { orders: 'none' }, 'orders')).toBe('none');
  });

  it('an override for one section leaves the others on their defaults', () => {
    const overrides = { finance: 'view' } as const;
    expect(effectiveLevel(roleDefault, overrides, 'finance')).toBe('view');
    expect(effectiveLevel(roleDefault, overrides, 'orders')).toBe('manage');
  });
});

describe('levelAtLeast / hasAnyAccess', () => {
  it('orders the levels none < view < manage', () => {
    expect(levelAtLeast('manage', 'view')).toBe(true);
    expect(levelAtLeast('view', 'manage')).toBe(false);
    expect(levelAtLeast('view', 'view')).toBe(true);
    expect(levelAtLeast(undefined, 'view')).toBe(false);
    expect(levelAtLeast('none', 'none')).toBe(true);
  });

  it('hasAnyAccess is false only for the all-none map', () => {
    expect(hasAnyAccess(roleDefault)).toBe(true);
    const stripped: PermissionMap = Object.fromEntries(SECTIONS.map((s) => [s.key, 'none'])) as PermissionMap;
    expect(hasAnyAccess(stripped)).toBe(false);
  });
});
