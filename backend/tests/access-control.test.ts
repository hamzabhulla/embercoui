import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app';
import {
  BUILT_IN_DEFAULTS, OWNER_PERMISSIONS, resolvePermissions, sanitizePermissionMap,
} from '../src/lib/permissions';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';
import { FakeStripeService } from './fakeStripe';
import { FakeStorageService } from './fakeStorage';

// Phase A — roles + owner-controlled permissions + audit foundation.
// Route behaviour runs over the fake repository (fresh per describe so
// permission mutations never leak between groups); the pure resolution
// rules are pinned directly against lib/permissions; the REAL
// repository's pre-0012 degradation is pinned separately in
// access-control-repository.test.ts.

function setup() {
  const repo = new FakeRepository();
  const app = createApp({
    env: testEnv(), repo, verifyToken: fakeVerifyToken,
    stripe: new FakeStripeService(), storage: new FakeStorageService(),
  });
  return { repo, app };
}

const as = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);
const ADMIN = 'token-admin';
const MANAGER = 'token-manager';
const STAFF = 'token-staff';
const USER = 'token-user';

describe('permission resolution (pure)', () => {
  it('the owner is immune to stored reductions — always all manage', () => {
    const hostile = { orders: 'none', finance: 'none', settings: 'none' } as const;
    expect(resolvePermissions('admin', hostile, hostile)).toEqual(OWNER_PERMISSIONS);
  });

  it('precedence per section: person override > role DB default > built-in > none', () => {
    // built-in only
    expect(resolvePermissions('staff', null, null)).toEqual(BUILT_IN_DEFAULTS.staff);
    expect(resolvePermissions('manager', null, null)).toEqual(BUILT_IN_DEFAULTS.manager);
    // role DB default beats built-in (staff coupons: view -> manage)
    expect(resolvePermissions('staff', { coupons: 'manage' }, null).coupons).toBe('manage');
    // person override beats role DB default
    expect(resolvePermissions('staff', { coupons: 'manage' }, { coupons: 'none' }).coupons).toBe('none');
    // an override for one section leaves the rest to lower layers
    const mixed = resolvePermissions('manager', { finance: 'view' }, { orders: 'view' });
    expect(mixed.finance).toBe('view'); // from role DB
    expect(mixed.orders).toBe('view'); // person override (built-in was manage)
    expect(mixed.menu).toBe('manage'); // built-in
    expect(mixed.settings).toBe('none'); // built-in none
  });

  it('customers and unknown roles resolve to no access at all', () => {
    const forCustomer = resolvePermissions('customer', null, { orders: 'manage' });
    expect(Object.values(forCustomer).every((v) => v === 'none')).toBe(true);
  });

  it('garbage maps are sanitised: unknown sections/levels dropped, non-objects ignored', () => {
    expect(sanitizePermissionMap({ orders: 'manage', bogus: 'view', menu: 'everything', finance: 3 }))
      .toEqual({ orders: 'manage' });
    expect(sanitizePermissionMap('orders')).toBeNull();
    expect(sanitizePermissionMap(['orders'])).toBeNull();
    expect(sanitizePermissionMap(null)).toBeNull();
    // and resolution itself never emits an invalid level from planted garbage
    const resolved = resolvePermissions('staff', { orders: 'bogus' } as never, null);
    expect(resolved.orders).toBe(BUILT_IN_DEFAULTS.staff.orders);
  });
});

describe('/admin/me', () => {
  const { repo, app } = setup();

  it('returns the effective map per role; customers 403, anonymous 401', async () => {
    const manager = await as(request(app).get('/api/v1/admin/me'), MANAGER);
    expect(manager.status).toBe(200);
    expect(manager.body.role).toBe('manager');
    expect(manager.body.permissions).toEqual(BUILT_IN_DEFAULTS.manager);

    const staff = await as(request(app).get('/api/v1/admin/me'), STAFF);
    expect(staff.body.permissions).toEqual(BUILT_IN_DEFAULTS.staff);

    expect((await as(request(app).get('/api/v1/admin/me'), USER)).status).toBe(403);
    expect((await request(app).get('/api/v1/admin/me')).status).toBe(401);
  });

  it('the owner gets all-manage even with hostile stored overrides', async () => {
    const owner = repo.profiles.get('admin-1')!;
    owner.permissions = { orders: 'none', settings: 'none', staff: 'none' };
    const res = await as(request(app).get('/api/v1/admin/me'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.permissions).toEqual(OWNER_PERMISSIONS);
    owner.permissions = null;
  });
});

describe('route matrix — built-in defaults mirror the pre-Phase-A gates', () => {
  const { app } = setup();

  it('staff: closed sections 403 on read, coupon reads pass but writes 403', async () => {
    for (const path of ['/customers', '/newsletter', '/finance', '/settings', '/staff']) {
      expect((await as(request(app).get(`/api/v1/admin${path}`), STAFF)).status, path).toBe(403);
    }
    expect((await as(request(app).get('/api/v1/admin/coupons'), STAFF)).status).toBe(200);
    expect((await as(request(app).post('/api/v1/admin/coupons').send({ code: 'NEW10', type: 'percent', value: 10 }), STAFF)).status).toBe(403);
    expect((await as(request(app).get('/api/v1/admin/orders'), STAFF)).status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/menu'), STAFF)).status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/reviews'), STAFF)).status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/reservations'), STAFF)).status).toBe(200);
  });

  it('manager: floor sections open, money/people/settings closed, coupons read-only', async () => {
    expect((await as(request(app).get('/api/v1/admin/customers'), MANAGER)).status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/newsletter'), MANAGER)).status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/newsletter.csv'), MANAGER)).status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/finance'), MANAGER)).status).toBe(403);
    expect((await as(request(app).get('/api/v1/admin/staff'), MANAGER)).status).toBe(403);
    expect((await as(request(app).get('/api/v1/admin/settings'), MANAGER)).status).toBe(403);
    expect((await as(request(app).post('/api/v1/admin/coupons').send({ code: 'NEW10', type: 'percent', value: 10 }), MANAGER)).status).toBe(403);
    expect((await as(request(app).post('/api/v1/admin/menu').send({ name: 'X', price: 1, category: 'Mains' }), MANAGER)).status).toBe(201);
  });

  it('dashboard assembles only the blocks the caller may view', async () => {
    const staff = await as(request(app).get('/api/v1/admin/dashboard'), STAFF);
    expect(staff.status).toBe(200);
    // orders + reservations blocks ride along; finance + customers do not
    expect(staff.body.stats.totalOrders).toBeDefined();
    expect(staff.body.stats.pendingReservations).toBeDefined();
    expect(staff.body.stats.revenue).toBeUndefined();
    expect(staff.body.stats.customers).toBeUndefined();
    expect(staff.body.recentOrders).toBeDefined();

    const owner = await as(request(app).get('/api/v1/admin/dashboard'), ADMIN);
    expect(owner.body.stats.revenue).toBeDefined();
    expect(owner.body.stats.customers).toBeDefined();
  });
});

describe('owner-controlled permissions take effect immediately', () => {
  const { app } = setup();

  it('per-person override: staff gains coupon manage and finance view on the next request', async () => {
    const put = await as(request(app).put('/api/v1/admin/staff/staff-1/permissions')
      .send({ permissions: { coupons: 'manage', finance: 'view' } }), ADMIN);
    expect(put.status).toBe(200);
    expect(put.body.profile.permissions).toEqual({ coupons: 'manage', finance: 'view' });
    expect(put.body.permissions.coupons).toBe('manage');

    expect((await as(request(app).post('/api/v1/admin/coupons').send({ code: 'STAFF10', type: 'percent', value: 10 }), STAFF)).status).toBe(201);
    expect((await as(request(app).get('/api/v1/admin/finance'), STAFF)).status).toBe(200);
    const dash = await as(request(app).get('/api/v1/admin/dashboard'), STAFF);
    expect(dash.body.stats.revenue).toBeDefined(); // finance block unlocked by the same override
  });

  it('role defaults change the whole role; a person override still wins over them', async () => {
    const put = await as(request(app).put('/api/v1/admin/permissions/roles/staff')
      .send({ permissions: { ...BUILT_IN_DEFAULTS.staff, orders: 'none' } }), ADMIN);
    expect(put.status).toBe(200);
    expect(put.body.permissions.orders).toBe('none');
    // staff-1 (no orders override) loses orders immediately
    expect((await as(request(app).get('/api/v1/admin/orders'), STAFF)).status).toBe(403);
    // grant staff-1 a personal view: reads return, writes stay closed
    await as(request(app).put('/api/v1/admin/staff/staff-1/permissions')
      .send({ permissions: { orders: 'view' } }), ADMIN);
    expect((await as(request(app).get('/api/v1/admin/orders'), STAFF)).status).toBe(200);
  });

  it('an empty per-person map clears the overrides back to the role default', async () => {
    const put = await as(request(app).put('/api/v1/admin/staff/staff-1/permissions')
      .send({ permissions: {} }), ADMIN);
    expect(put.status).toBe(200);
    expect(put.body.profile.permissions).toBeNull();
    const me = await as(request(app).get('/api/v1/admin/me'), STAFF);
    expect(me.body.permissions.orders).toBe('none'); // role default set by the previous test
  });

  it('unknown sections and bad levels are rejected; unknown roles 404', async () => {
    expect((await as(request(app).put('/api/v1/admin/staff/staff-1/permissions')
      .send({ permissions: { payroll: 'manage' } }), ADMIN)).status).toBe(400);
    expect((await as(request(app).put('/api/v1/admin/staff/staff-1/permissions')
      .send({ permissions: { orders: 'everything' } }), ADMIN)).status).toBe(400);
    expect((await as(request(app).put('/api/v1/admin/permissions/roles/admin')
      .send({ permissions: {} }), ADMIN)).status).toBe(404);
    expect((await as(request(app).put('/api/v1/admin/permissions/roles/customer')
      .send({ permissions: {} }), ADMIN)).status).toBe(404);
    expect((await as(request(app).put('/api/v1/admin/staff/nobody/permissions')
      .send({ permissions: {} }), ADMIN)).status).toBe(404);
  });

  it('GET /permissions/roles returns the effective defaults for both roles', async () => {
    const res = await as(request(app).get('/api/v1/admin/permissions/roles'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.roles.manager).toEqual(BUILT_IN_DEFAULTS.manager);
    expect(res.body.roles.staff.orders).toBe('none'); // reflects the earlier edit in this group
  });
});

describe('management endpoints are owner-only — never assignable', () => {
  const { app } = setup();

  it('a manager holding staff:manage can view the staff list but cannot edit roles or permissions', async () => {
    // The owner grants the manager full staff-section access...
    const grant = await as(request(app).put('/api/v1/admin/staff/manager-1/permissions')
      .send({ permissions: { staff: 'manage' } }), ADMIN);
    expect(grant.status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/staff'), MANAGER)).status).toBe(200);
    // ...but every management write stays 403: permission editing is
    // not a capability that can be handed out.
    expect((await as(request(app).patch('/api/v1/admin/staff/user-1/role').send({ role: 'staff' }), MANAGER)).status).toBe(403);
    expect((await as(request(app).put('/api/v1/admin/staff/user-1/permissions').send({ permissions: {} }), MANAGER)).status).toBe(403);
    expect((await as(request(app).put('/api/v1/admin/permissions/roles/staff').send({ permissions: {} }), MANAGER)).status).toBe(403);
    expect((await as(request(app).get('/api/v1/admin/permissions/roles'), MANAGER)).status).toBe(403);
    // staff (no staff section at all by default) likewise
    expect((await as(request(app).put('/api/v1/admin/staff/user-1/permissions').send({ permissions: {} }), STAFF)).status).toBe(403);
    expect((await as(request(app).get('/api/v1/admin/permissions/roles'), STAFF)).status).toBe(403);
  });
});

describe('manager role assignment round-trips', () => {
  const { app } = setup();

  it('promote customer -> manager: the account immediately works as a manager', async () => {
    const res = await as(request(app).patch('/api/v1/admin/staff/user-1/role').send({ role: 'manager' }), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.profile.role).toBe('manager');

    const me = await as(request(app).get('/api/v1/admin/me'), USER);
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('manager');
    expect(me.body.permissions).toEqual(BUILT_IN_DEFAULTS.manager);
    expect((await as(request(app).get('/api/v1/admin/orders'), USER)).status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/finance'), USER)).status).toBe(403);

    const list = await as(request(app).get('/api/v1/admin/staff'), ADMIN);
    expect(list.body.staff.find((p: { id: string }) => p.id === 'user-1').role).toBe('manager');
  });

  it('an unknown role string is a 400, not a stored value', async () => {
    expect((await as(request(app).patch('/api/v1/admin/staff/user-2/role').send({ role: 'superuser' }), ADMIN)).status).toBe(400);
  });
});

describe('audit foundation', () => {
  const { repo, app } = setup();

  it('role changes, role-default changes and per-person changes are logged with {from,to}', async () => {
    await as(request(app).patch('/api/v1/admin/staff/user-2/role').send({ role: 'manager' }), ADMIN);
    await as(request(app).put('/api/v1/admin/permissions/roles/manager')
      .send({ permissions: { ...BUILT_IN_DEFAULTS.manager, finance: 'view' } }), ADMIN);
    await as(request(app).put('/api/v1/admin/staff/staff-1/permissions')
      .send({ permissions: { finance: 'view' } }), ADMIN);

    const roleChange = repo.auditEvents.find((e) => e.action === 'staff.role_changed');
    expect(roleChange).toMatchObject({
      actorId: 'admin-1', actorRole: 'admin', entity: 'profile', entityId: 'user-2',
      changes: { role: { from: 'customer', to: 'manager' } },
    });
    const defaultsChange = repo.auditEvents.find((e) => e.action === 'permissions.role_defaults_changed');
    expect(defaultsChange).toMatchObject({
      actorId: 'admin-1', entity: 'role_permissions', entityId: 'manager',
      changes: { finance: { from: 'none', to: 'view' } },
    });
    const personChange = repo.auditEvents.find((e) => e.action === 'staff.permissions_changed');
    expect(personChange).toMatchObject({
      actorId: 'admin-1', entity: 'profile', entityId: 'staff-1',
      changes: { finance: { from: null, to: 'view' } },
    });
  });

  it("the owner's own changes are logged too — no exemption", async () => {
    // The owner edits their OWN overrides: stored (and logged) even
    // though resolution ignores them for the owner.
    const res = await as(request(app).put('/api/v1/admin/staff/admin-1/permissions')
      .send({ permissions: { orders: 'none' } }), ADMIN);
    expect(res.status).toBe(200);
    const own = repo.auditEvents.find((e) => e.action === 'staff.permissions_changed' && e.entityId === 'admin-1');
    expect(own).toMatchObject({ actorId: 'admin-1', changes: { orders: { from: null, to: 'none' } } });
    const me = await as(request(app).get('/api/v1/admin/me'), ADMIN);
    expect(me.body.permissions).toEqual(OWNER_PERMISSIONS); // still immune
  });

  it('a failed audit write never fails the mutation', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    repo.insertAuditEvent = async () => { throw new Error('audit store down'); };
    const res = await as(request(app).patch('/api/v1/admin/staff/user-1/role').send({ role: 'staff' }), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.profile.role).toBe('staff');
    expect(spy).toHaveBeenCalled(); // the failure was logged, not hidden
    spy.mockRestore();
  });
});
