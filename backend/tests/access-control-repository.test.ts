import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase A — the REAL Supabase repository's access-control surface,
// pinned against the shared PostgREST miniature (./stubSupabase), and
// above all its PRE-MIGRATION behaviour: until the owner runs migration
// 0012, the role_permissions table, profiles.permissions column and
// audit_events table do not exist, and every access-control read/write
// must degrade to the built-in defaults instead of failing — an admin
// request must never 500 because of the missing migration.

vi.mock('@supabase/supabase-js', async () => {
  const m = await import('./stubSupabase');
  return { createClient: m.stubSupabase.createClient };
});

import { stubSupabase as stub, type Row } from './stubSupabase';
import { createSupabaseRepository } from '../src/repositories/supabaseRepository';
import { BUILT_IN_DEFAULTS, effectivePermissionsFor } from '../src/lib/permissions';

const repo = createSupabaseRepository('https://stub.invalid', 'stub-key');

const ts = (sec: number) => new Date(Date.UTC(2026, 0, 1) + sec * 1000).toISOString();
const rows = (table: string): Row[] => stub.tables.get(table) ?? [];

function profileRow(id: string, patch: Row = {}): Row {
  return {
    id, role: 'customer', full_name: `Person ${id}`, phone: null,
    addresses: [], favorites: [], created_at: ts(1), ...patch,
  };
}

beforeEach(() => stub.reset());

describe('profile DTO: manager role + permission overrides', () => {
  it("a stored 'manager' reads back as manager; an unknown role coerces to customer as before", async () => {
    stub.seed('profiles', [
      profileRow('mgr-1', { role: 'manager' }),
      profileRow('odd-1', { role: 'superuser' }),
    ]);
    expect((await repo.getProfile('mgr-1'))?.role).toBe('manager');
    expect((await repo.getProfile('odd-1'))?.role).toBe('customer');
  });

  it('stored overrides are sanitised on read; absent/empty reads as null', async () => {
    stub.seed('profiles', [
      profileRow('p-1', { permissions: { orders: 'manage', payroll: 'view', menu: 'everything' } }),
      profileRow('p-2', { permissions: null }),
      profileRow('p-3', {}), // pre-0012 shape: no permissions key at all
    ]);
    expect((await repo.getProfile('p-1'))?.permissions).toEqual({ orders: 'manage' });
    expect((await repo.getProfile('p-2'))?.permissions).toBeNull();
    expect((await repo.getProfile('p-3'))?.permissions).toBeNull();
  });

  it('role changes to manager persist through updateProfileRole', async () => {
    stub.seed('profiles', [profileRow('p-1')]);
    const updated = await repo.updateProfileRole('p-1', 'manager');
    expect(updated?.role).toBe('manager');
    expect(rows('profiles')[0].role).toBe('manager');
  });
});

describe('role permissions: read/write + degradation', () => {
  it('no row stored -> null (built-ins apply); a stored row reads back sanitised', async () => {
    expect(await repo.getRolePermissions('staff')).toBeNull();
    stub.seed('role_permissions', [
      { role: 'staff', permissions: { orders: 'none', bogus: 'view' }, created_at: ts(1), updated_at: ts(1) },
    ]);
    expect(await repo.getRolePermissions('staff')).toEqual({ orders: 'none' });
    expect(await repo.getRolePermissions('manager')).toBeNull();
  });

  it('setRolePermissions upserts the row (sanitised) and updates it in place', async () => {
    await repo.setRolePermissions('staff', { orders: 'none', nope: 'manage' } as never);
    expect(rows('role_permissions')).toHaveLength(1);
    expect(rows('role_permissions')[0]).toMatchObject({ role: 'staff', permissions: { orders: 'none' } });
    await repo.setRolePermissions('staff', { orders: 'view' });
    expect(rows('role_permissions')).toHaveLength(1);
    expect(await repo.getRolePermissions('staff')).toEqual({ orders: 'view' });
  });

  it('PRE-0012: a missing role_permissions schema degrades reads to null and writes to no-ops', async () => {
    stub.setMissingColumns('role_permissions', ['permissions']);
    await expect(repo.getRolePermissions('staff')).resolves.toBeNull();
    await expect(repo.setRolePermissions('staff', { orders: 'none' })).resolves.toBeUndefined();
    expect(rows('role_permissions')).toHaveLength(0);
  });
});

describe('per-person overrides: write + degradation', () => {
  it('setUserPermissions stores the sanitised map; an empty map clears to NULL', async () => {
    stub.seed('profiles', [profileRow('p-1', { role: 'staff' })]);
    const updated = await repo.setUserPermissions('p-1', { finance: 'view', bogus: 'none' } as never);
    expect(updated?.permissions).toEqual({ finance: 'view' });
    expect(rows('profiles')[0].permissions).toEqual({ finance: 'view' });

    const cleared = await repo.setUserPermissions('p-1', {});
    expect(cleared?.permissions).toBeNull();
    expect(rows('profiles')[0].permissions).toBeNull();
  });

  it('an unknown or malformed id resolves to null, never a throw', async () => {
    stub.seed('profiles', [profileRow('p-1')]);
    expect(await repo.setUserPermissions('ghost', { finance: 'view' })).toBeNull();
    expect(await repo.setUserPermissions('not-a-uuid', { finance: 'view' })).toBeNull();
  });

  it('PRE-0012: with the permissions column missing, the write no-ops and returns the profile as it stands', async () => {
    stub.seed('profiles', [profileRow('p-1', { role: 'staff' })]);
    stub.setMissingColumns('profiles', ['permissions']);
    const result = await repo.setUserPermissions('p-1', { finance: 'view' });
    expect(result?.id).toBe('p-1');
    expect(result?.permissions).toBeNull();
  });
});

describe('audit events: write + degradation', () => {
  it('insertAuditEvent writes the snake_case row', async () => {
    await repo.insertAuditEvent({
      actorId: 'admin-1', actorLabel: 'Admin', actorRole: 'admin',
      action: 'staff.role_changed', entity: 'profile', entityId: 'p-1',
      summary: null, changes: { role: { from: 'customer', to: 'manager' } },
      ip: '203.0.113.9', userAgent: 'test-agent',
    });
    expect(rows('audit_events')).toHaveLength(1);
    expect(rows('audit_events')[0]).toMatchObject({
      actor_id: 'admin-1', actor_label: 'Admin', actor_role: 'admin',
      action: 'staff.role_changed', entity: 'profile', entity_id: 'p-1',
      changes: { role: { from: 'customer', to: 'manager' } },
      ip: '203.0.113.9', user_agent: 'test-agent',
    });
  });

  it('PRE-0012: with the audit table missing from the schema, the insert is dropped silently', async () => {
    stub.setMissingColumns('audit_events', ['actor_id']);
    await expect(repo.insertAuditEvent({
      actorId: 'admin-1', actorLabel: null, actorRole: 'admin', action: 'x',
      entity: null, entityId: null, summary: null, changes: null, ip: null, userAgent: null,
    })).resolves.toBeUndefined();
    expect(rows('audit_events')).toHaveLength(0);
  });
});

describe('degradation end-to-end: a pre-0012 database behaves exactly as today', () => {
  it('effective permissions resolve to the built-in defaults with no table, no column, no throw', async () => {
    // The pre-migration world: profiles carry no permissions key and
    // role_permissions has never existed.
    stub.seed('profiles', [profileRow('s-1', { role: 'staff' }), profileRow('m-1', { role: 'manager' })]);
    const staff = await repo.getProfile('s-1');
    const manager = await repo.getProfile('m-1');
    expect(await effectivePermissionsFor(repo, staff!)).toEqual(BUILT_IN_DEFAULTS.staff);
    expect(await effectivePermissionsFor(repo, manager!)).toEqual(BUILT_IN_DEFAULTS.manager);
  });
});
