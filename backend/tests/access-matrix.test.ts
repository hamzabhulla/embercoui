import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { FakeRepository, dateFromToday, fakeVerifyToken, testEnv } from './fakeRepository';
import { FakeStripeService } from './fakeStripe';
import { FakeStorageService } from './fakeStorage';
import { FakeAuthAdminService } from './fakeAuthAdmin';

// Phase E — the definitive access-control matrix + cross-phase pins.
//
// Everything before this file pinned the access system feature by
// feature (Phase A: resolution + enforcement, B: the MFA gate,
// C: audit hooks, D: the screen lock). This suite is the systematic
// sweep: roles × sections × routes, generated from the HAND-WRITTEN
// expectation table below.
//
// The expectations are deliberately NOT imported from
// lib/permissions (no BUILT_IN_DEFAULTS, no resolvePermissions): a
// matrix generated from the production defaults would be a tautology
// that passes even if the defaults themselves were wrong. The table
// below is the plan as approved (mirrored in the header comment of
// lib/permissions.ts); if production drifts from it, THIS file goes
// red — that is its entire job.
//
// Default world = the fake's PRE-0013 state (MFA enforcement off), so
// the section matrix judges section gates alone; the MFA cells at
// the bottom opt into the post-0013 world explicitly.

type Level = 'none' | 'view' | 'manage';
type Section =
  | 'dashboard' | 'orders' | 'reservations' | 'menu' | 'customers' | 'reviews'
  | 'newsletter' | 'coupons' | 'finance' | 'staff' | 'settings' | 'security';

const SECTIONS: Section[] = [
  'dashboard', 'orders', 'reservations', 'menu', 'customers', 'reviews',
  'newsletter', 'coupons', 'finance', 'staff', 'settings', 'security',
];

// THE EXPECTATION TABLE — hand-written from the approved plan.
// Owner: manage on everything, unconditionally.
// Manager: runs the floor (orders/reservations/menu/reviews manage;
// dashboard/customers/newsletter/coupons view; finance/staff/
// settings/security closed).
// Staff: mirrors the pre-Phase-A route gates (dashboard/orders/
// reservations/menu/reviews manage — menu+reviews 'manage' carries
// the owner-accepted delete widening; coupons view; the rest closed).
// Customer: no admin access at all (the router itself refuses).
const EXPECTED: Record<'admin' | 'manager' | 'staff' | 'customer', Record<Section, Level>> = {
  admin: {
    dashboard: 'manage', orders: 'manage', reservations: 'manage', menu: 'manage',
    customers: 'manage', reviews: 'manage', newsletter: 'manage', coupons: 'manage',
    finance: 'manage', staff: 'manage', settings: 'manage', security: 'manage',
  },
  manager: {
    dashboard: 'view', orders: 'manage', reservations: 'manage', menu: 'manage',
    customers: 'view', reviews: 'manage', newsletter: 'view', coupons: 'view',
    finance: 'none', staff: 'none', settings: 'none', security: 'none',
  },
  staff: {
    dashboard: 'view', orders: 'manage', reservations: 'manage', menu: 'manage',
    customers: 'none', reviews: 'manage', newsletter: 'none', coupons: 'view',
    finance: 'none', staff: 'none', settings: 'none', security: 'none',
  },
  customer: {
    dashboard: 'none', orders: 'none', reservations: 'none', menu: 'none',
    customers: 'none', reviews: 'none', newsletter: 'none', coupons: 'none',
    finance: 'none', staff: 'none', settings: 'none', security: 'none',
  },
};

function setup({ postMigration = false } = {}) {
  const repo = new FakeRepository();
  if (postMigration) {
    // The post-0013 world: the mfa_required column exists and every
    // seeded profile holds NULL (role defaults govern) — mfa.test.ts's
    // opt-in, reused for the MFA matrix cells.
    for (const p of repo.profiles.values()) p.mfaRequired = null;
  }
  const authAdmin = new FakeAuthAdminService();
  const app = createApp({
    env: testEnv(), repo, verifyToken: fakeVerifyToken,
    stripe: new FakeStripeService(), storage: new FakeStorageService(), authAdmin,
  });
  return { repo, app, authAdmin };
}

const as = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);
const TOKENS = {
  admin: 'token-admin', manager: 'token-manager', staff: 'token-staff', customer: 'token-user',
} as const;
const ADMIN = TOKENS.admin;
const MANAGER = TOKENS.manager;
const STAFF = TOKENS.staff;

interface Fx { orderId: string; reservationId: string }

/** One pending order + one pending reservation for the PATCH probes. */
async function seedFx(repo: FakeRepository): Promise<Fx> {
  const order = await repo.createOrder({
    userId: 'user-1', customerName: 'Matrix Guest', customerEmail: 'guest@example.com', customerPhone: null,
    address: null, notes: null, couponCode: null, currency: 'USD',
    items: [{ menuItemId: 1, name: 'Ember Classic', unitPrice: 24, quantity: 1 }],
    subtotal: 24, deliveryFee: 0, discount: 0, total: 24,
  });
  const reservation = await repo.createReservation({
    userId: null, name: 'Matrix Guest', email: 'guest@example.com', phone: '1234567',
    date: dateFromToday(30), time: '19:00', guests: 2,
  });
  return { orderId: order.id, reservationId: reservation.id };
}

type App = ReturnType<typeof createApp>;
interface Ctx { app: App; token: string; fx: Fx }
type Probe = (ctx: Ctx) => Promise<number>;

const get = (path: string): Probe => async ({ app, token }) => (await as(request(app).get(path), token)).status;

// The route inventory (Phase A audit's verified mapping; Phase B/C
// added the owner-only MFA endpoints — covered separately below —
// and the security reads). One+ read and, where the section has any,
// every mutation route, each with its success status.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64');
const PROBES: Record<Section, { reads: Probe[]; mutations: { name: string; ok: number; run: Probe }[] }> = {
  dashboard: { reads: [get('/api/v1/admin/dashboard')], mutations: [] },
  orders: {
    reads: [get('/api/v1/admin/orders')],
    mutations: [{
      name: 'PATCH /orders/:id/status', ok: 200,
      run: async ({ app, token, fx }) => (await as(request(app).patch(`/api/v1/admin/orders/${fx.orderId}/status`), token).send({ status: 'confirmed' })).status,
    }],
  },
  reservations: {
    reads: [get('/api/v1/admin/reservations')],
    mutations: [
      {
        name: 'POST /reservations', ok: 201,
        run: async ({ app, token }) => (await as(request(app).post('/api/v1/admin/reservations'), token)
          .send({ name: 'Matrix Guest', phone: '03001234567', date: dateFromToday(30), time: '19:00', guests: 2 })).status,
      },
      {
        name: 'PATCH /reservations/:id/status', ok: 200,
        run: async ({ app, token, fx }) => (await as(request(app).patch(`/api/v1/admin/reservations/${fx.reservationId}/status`), token).send({ status: 'confirmed' })).status,
      },
    ],
  },
  menu: {
    reads: [get('/api/v1/admin/menu')],
    mutations: [
      {
        name: 'POST /menu', ok: 201,
        run: async ({ app, token }) => (await as(request(app).post('/api/v1/admin/menu'), token).send({ name: 'Matrix Dish', price: 10, category: 'Mains' })).status,
      },
      {
        name: 'PATCH /menu/:id', ok: 200,
        run: async ({ app, token }) => (await as(request(app).patch('/api/v1/admin/menu/1'), token).send({ price: 25 })).status,
      },
      {
        name: 'DELETE /menu/:id', ok: 200,
        run: async ({ app, token }) => (await as(request(app).delete('/api/v1/admin/menu/3'), token)).status,
      },
      {
        name: 'POST /menu/upload', ok: 201,
        run: async ({ app, token }) => (await as(request(app).post('/api/v1/admin/menu/upload'), token).send({ filename: 'dish.png', contentType: 'image/png', dataBase64: PNG })).status,
      },
    ],
  },
  customers: { reads: [get('/api/v1/admin/customers')], mutations: [] },
  reviews: {
    reads: [get('/api/v1/admin/reviews')],
    mutations: [
      {
        name: 'PATCH /reviews/:id', ok: 200,
        run: async ({ app, token }) => (await as(request(app).patch('/api/v1/admin/reviews/rev-2'), token).send({ isApproved: true })).status,
      },
      {
        name: 'DELETE /reviews/:id', ok: 200,
        run: async ({ app, token }) => (await as(request(app).delete('/api/v1/admin/reviews/rev-1'), token)).status,
      },
    ],
  },
  newsletter: {
    reads: [get('/api/v1/admin/newsletter'), get('/api/v1/admin/newsletter.csv')],
    mutations: [],
  },
  coupons: {
    reads: [get('/api/v1/admin/coupons')],
    mutations: [
      {
        name: 'POST /coupons', ok: 201,
        run: async ({ app, token }) => (await as(request(app).post('/api/v1/admin/coupons'), token).send({ code: 'MATRIX10', type: 'percent', value: 10 })).status,
      },
      {
        name: 'PATCH /coupons/:id', ok: 200,
        run: async ({ app, token }) => (await as(request(app).patch('/api/v1/admin/coupons/cpn-1'), token).send({ value: 15 })).status,
      },
      {
        name: 'DELETE /coupons/:id', ok: 200,
        run: async ({ app, token }) => (await as(request(app).delete('/api/v1/admin/coupons/cpn-2'), token)).status,
      },
    ],
  },
  finance: { reads: [get('/api/v1/admin/finance')], mutations: [] },
  staff: {
    // The staff section's writes are the OWNER-only endpoints (role /
    // permissions / MFA) — not section-gated at all; they are swept in
    // the owner-immunity describe below.
    reads: [get('/api/v1/admin/staff')],
    mutations: [],
  },
  settings: {
    reads: [get('/api/v1/admin/settings')],
    mutations: [{
      name: 'PATCH /settings', ok: 200,
      run: async ({ app, token }) => (await as(request(app).patch('/api/v1/admin/settings'), token).send({ waitMin: 25 })).status,
    }],
  },
  security: {
    reads: [get('/api/v1/admin/security/events'), get('/api/v1/admin/security/events.csv')],
    mutations: [],
  },
};

const expectedRead = (level: Level) => (level === 'none' ? 403 : 200);
const expectedMutation = (level: Level, ok: number) => (level === 'manage' ? ok : 403);

async function runRoleMatrix(role: keyof typeof EXPECTED) {
  const { repo, app } = setup();
  const fx = await seedFx(repo);
  const ctx: Ctx = { app, token: TOKENS[role], fx };
  for (const section of SECTIONS) {
    const level = EXPECTED[role][section];
    for (const read of PROBES[section].reads) {
      expect(await read(ctx), `${role} read ${section}`).toBe(expectedRead(level));
    }
    for (const mutation of PROBES[section].mutations) {
      expect(await mutation.run(ctx), `${role} ${mutation.name}`).toBe(expectedMutation(level, mutation.ok));
    }
  }
}

describe('built-in role × section matrix (hand-written expectations)', () => {
  it('owner: every section readable, every mutation allowed', async () => {
    await runRoleMatrix('admin');
  });

  it('manager: exactly the built-in manager map, route by route', async () => {
    await runRoleMatrix('manager');
  });

  it('staff: exactly the built-in staff map, route by route', async () => {
    await runRoleMatrix('staff');
  });

  it('customer: refused on every admin route (the router gate, 403)', async () => {
    await runRoleMatrix('customer');
  });

  it('anonymous: 401, not 403 — no token, no judgement', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/v1/admin/orders')).status).toBe(401);
    expect((await request(app).get('/api/v1/admin/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/admin/finance')).status).toBe(401);
  });

  it('/admin/me hands each role exactly the expectation table (and refuses customers)', async () => {
    const { app } = setup();
    for (const role of ['admin', 'manager', 'staff'] as const) {
      const res = await as(request(app).get('/api/v1/admin/me'), TOKENS[role]);
      expect(res.status, role).toBe(200);
      expect(res.body.role, role).toBe(role);
      expect(res.body.permissions, role).toEqual(EXPECTED[role]);
    }
    expect((await as(request(app).get('/api/v1/admin/me'), TOKENS.customer)).status).toBe(403);
  });
});

describe('override matrix — staff', () => {
  it('GRANT: a per-person finance:view opens finance reads (and the dashboard revenue block)', async () => {
    const { app } = setup();
    expect((await as(request(app).get('/api/v1/admin/finance'), STAFF)).status).toBe(403); // built-in: none
    const put = await as(request(app).put('/api/v1/admin/staff/staff-1/permissions')
      .send({ permissions: { finance: 'view' } }), ADMIN);
    expect(put.status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/finance'), STAFF)).status).toBe(200);
    const dash = await as(request(app).get('/api/v1/admin/dashboard'), STAFF);
    expect(dash.body.stats.revenue).toBeDefined();
  });

  it('REVOKE: a per-person orders:none closes reads the role default grants', async () => {
    const { app } = setup();
    expect((await as(request(app).get('/api/v1/admin/orders'), STAFF)).status).toBe(200); // built-in: manage
    await as(request(app).put('/api/v1/admin/staff/staff-1/permissions')
      .send({ permissions: { orders: 'none' } }), ADMIN);
    expect((await as(request(app).get('/api/v1/admin/orders'), STAFF)).status).toBe(403);
  });

  it('DOWNGRADE to view — the Phase A L3 pin: EVERY mutation route 403s while reads stay 200', async () => {
    const { repo, app } = setup();
    const fx = await seedFx(repo);
    await as(request(app).put('/api/v1/admin/staff/staff-1/permissions')
      .send({
        permissions: {
          orders: 'view', menu: 'view', reservations: 'view',
          reviews: 'view', coupons: 'view', settings: 'view',
        },
      }), ADMIN);
    const ctx: Ctx = { app, token: STAFF, fx };
    // Every section that HAS a mutation route: read passes, every
    // single mutation is refused. (Before Phase E this denial was
    // verified manually by the Phase A auditor but never pinned.)
    for (const section of ['orders', 'menu', 'reservations', 'reviews', 'coupons', 'settings'] as const) {
      for (const read of PROBES[section].reads) {
        expect(await read(ctx), `view-only staff read ${section}`).toBe(200);
      }
      for (const mutation of PROBES[section].mutations) {
        expect(await mutation.run(ctx), `view-only staff ${mutation.name}`).toBe(403);
      }
    }
  });
});

describe('override matrix — manager', () => {
  it('GRANT: finance:view + settings:view open the reads; settings writes still 403 (view < manage)', async () => {
    const { app } = setup();
    expect((await as(request(app).get('/api/v1/admin/finance'), MANAGER)).status).toBe(403);
    expect((await as(request(app).get('/api/v1/admin/settings'), MANAGER)).status).toBe(403);
    await as(request(app).put('/api/v1/admin/staff/manager-1/permissions')
      .send({ permissions: { finance: 'view', settings: 'view' } }), ADMIN);
    expect((await as(request(app).get('/api/v1/admin/finance'), MANAGER)).status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/settings'), MANAGER)).status).toBe(200);
    expect((await as(request(app).patch('/api/v1/admin/settings').send({ waitMin: 25 }), MANAGER)).status).toBe(403);
  });

  it('REVOKE + DOWNGRADE: orders:none closes reads; menu manage→view closes every menu write', async () => {
    const { repo, app } = setup();
    const fx = await seedFx(repo);
    await as(request(app).put('/api/v1/admin/staff/manager-1/permissions')
      .send({ permissions: { orders: 'none', menu: 'view' } }), ADMIN);
    expect((await as(request(app).get('/api/v1/admin/orders'), MANAGER)).status).toBe(403);
    const ctx: Ctx = { app, token: MANAGER, fx };
    expect((await PROBES.menu.reads[0](ctx))).toBe(200);
    for (const mutation of PROBES.menu.mutations) {
      expect(await mutation.run(ctx), `downgraded manager ${mutation.name}`).toBe(403);
    }
  });
});

describe('role-default changes take effect on the NEXT request (no cache, no re-login)', () => {
  it('grant → person override wins → clear → revoke, all against the same live staff token', async () => {
    const { app } = setup();
    expect((await as(request(app).get('/api/v1/admin/finance'), STAFF)).status).toBe(403);
    // The owner opens finance for the whole staff role…
    await as(request(app).put('/api/v1/admin/permissions/roles/staff')
      .send({ permissions: { finance: 'view' } }), ADMIN);
    expect((await as(request(app).get('/api/v1/admin/finance'), STAFF)).status).toBe(200);
    // …a per-person override still beats the new role default…
    await as(request(app).put('/api/v1/admin/staff/staff-1/permissions')
      .send({ permissions: { finance: 'none' } }), ADMIN);
    expect((await as(request(app).get('/api/v1/admin/finance'), STAFF)).status).toBe(403);
    // …clearing the override falls back to the role default…
    await as(request(app).put('/api/v1/admin/staff/staff-1/permissions')
      .send({ permissions: {} }), ADMIN);
    expect((await as(request(app).get('/api/v1/admin/finance'), STAFF)).status).toBe(200);
    // …and revoking the role default closes it again, immediately.
    await as(request(app).put('/api/v1/admin/permissions/roles/staff')
      .send({ permissions: { finance: 'none' } }), ADMIN);
    expect((await as(request(app).get('/api/v1/admin/finance'), STAFF)).status).toBe(403);
  });
});

describe('owner immunity + owner-only endpoints', () => {
  it('a hostile stored override (every section none) changes NOTHING for the owner', async () => {
    const { repo, app } = setup();
    repo.profiles.get('admin-1')!.permissions = Object.fromEntries(SECTIONS.map((s) => [s, 'none']));
    const me = await as(request(app).get('/api/v1/admin/me'), ADMIN);
    expect(me.status).toBe(200);
    expect(me.body.permissions).toEqual(EXPECTED.admin);
    expect((await as(request(app).get('/api/v1/admin/orders'), ADMIN)).status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/finance'), ADMIN)).status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/security/events'), ADMIN)).status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/permissions/roles'), ADMIN)).status).toBe(200);
    expect((await as(request(app).post('/api/v1/admin/coupons').send({ code: 'OWNED10', type: 'percent', value: 10 }), ADMIN)).status).toBe(201);
    expect((await as(request(app).patch('/api/v1/admin/settings').send({ waitMin: 22 }), ADMIN)).status).toBe(200);
  });

  it('role/permissions/MFA management denies manager (even with staff:manage), staff and customer', async () => {
    const { app, authAdmin } = setup();
    authAdmin.seed('staff-1', [{ id: 'fac-1', status: 'verified', factorType: 'totp' }]);
    // Give the manager REAL staff-section control first, so the 403s
    // below prove these endpoints are role-gated, not section-gated.
    await as(request(app).put('/api/v1/admin/staff/manager-1/permissions')
      .send({ permissions: { staff: 'manage' } }), ADMIN);
    expect((await as(request(app).get('/api/v1/admin/staff'), MANAGER)).status).toBe(200);

    const attempts: { name: string; run: (token: string) => Promise<number> }[] = [
      { name: 'PATCH /staff/:id/role', run: async (t) => (await as(request(app).patch('/api/v1/admin/staff/user-1/role'), t).send({ role: 'staff' })).status },
      { name: 'PUT /staff/:id/permissions', run: async (t) => (await as(request(app).put('/api/v1/admin/staff/user-1/permissions'), t).send({ permissions: {} })).status },
      { name: 'GET /permissions/roles', run: async (t) => (await as(request(app).get('/api/v1/admin/permissions/roles'), t)).status },
      { name: 'PUT /permissions/roles/:role', run: async (t) => (await as(request(app).put('/api/v1/admin/permissions/roles/staff'), t).send({ permissions: {} })).status },
      { name: 'PUT /staff/:id/mfa-required', run: async (t) => (await as(request(app).put('/api/v1/admin/staff/user-1/mfa-required'), t).send({ mfaRequired: true })).status },
      { name: 'POST /staff/:id/mfa/reset', run: async (t) => (await as(request(app).post('/api/v1/admin/staff/staff-1/mfa/reset'), t)).status },
    ];
    for (const attempt of attempts) {
      expect(await attempt.run(MANAGER), `manager ${attempt.name}`).toBe(403);
      expect(await attempt.run(STAFF), `staff ${attempt.name}`).toBe(403);
      expect(await attempt.run(TOKENS.customer), `customer ${attempt.name}`).toBe(403);
    }
    // The same endpoints answer the owner — the denials above are
    // about WHO is asking, not broken routes.
    const reset = await as(request(app).post('/api/v1/admin/staff/staff-1/mfa/reset'), ADMIN);
    expect(reset.status).toBe(200);
    expect(reset.body).toMatchObject({ reset: true, factorsRemoved: 1 });
    expect((await as(request(app).put('/api/v1/admin/staff/user-1/mfa-required').send({ mfaRequired: true }), ADMIN)).status).toBe(200);
  });

  it('the last-admin guard still holds: the sole admin cannot demote themselves', async () => {
    const { app } = setup();
    const res = await as(request(app).patch('/api/v1/admin/staff/admin-1/role').send({ role: 'staff' }), ADMIN);
    expect(res.status).toBe(400);
    const list = await as(request(app).get('/api/v1/admin/staff'), ADMIN);
    expect(list.body.staff.find((p: { id: string }) => p.id === 'admin-1').role).toBe('admin');
  });
});

describe('MFA matrix cells (post-0013 world)', () => {
  const ADMIN2 = 'token-admin-aal2';
  const MANAGER2 = 'token-manager-aal2';
  const STAFF_AAL2 = 'token-staff-aal2';

  it('required + aal1 → 403 MFA_REQUIRED on sampled data routes; /me still answers 200', async () => {
    const { app } = setup({ postMigration: true });
    // Manager is required by role default; sample one route per
    // section family, including two the manager may not even view —
    // the MFA gate fires BEFORE the section gate.
    for (const path of ['/dashboard', '/orders', '/finance', '/security/events']) {
      const res = await as(request(app).get(`/api/v1/admin${path}`), MANAGER);
      expect(res.status, `manager aal1 ${path}`).toBe(403);
      expect(res.body.code, `manager aal1 ${path}`).toBe('MFA_REQUIRED');
    }
    const owner = await as(request(app).get('/api/v1/admin/finance'), ADMIN);
    expect(owner.status).toBe(403);
    expect(owner.body.code).toBe('MFA_REQUIRED');
    // /me is the one escape hatch, and it reports the unsatisfied state.
    const me = await as(request(app).get('/api/v1/admin/me'), MANAGER);
    expect(me.status).toBe(200);
    expect(me.body.mfa).toEqual({ required: true, satisfied: false });
  });

  it('required + aal2 → the panel opens (section gates then apply as usual)', async () => {
    const { app } = setup({ postMigration: true });
    expect((await as(request(app).get('/api/v1/admin/dashboard'), MANAGER2)).status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/orders'), MANAGER2)).status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/finance'), ADMIN2)).status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/security/events'), ADMIN2)).status).toBe(200);
    const me = await as(request(app).get('/api/v1/admin/me'), MANAGER2);
    expect(me.body.mfa).toEqual({ required: true, satisfied: true });
  });

  it('not-required + aal1 → open; the role defaults differ (staff OFF, manager ON)', async () => {
    const { app } = setup({ postMigration: true });
    const staffMe = await as(request(app).get('/api/v1/admin/me'), STAFF);
    expect(staffMe.body.mfa).toEqual({ required: false, satisfied: true });
    expect((await as(request(app).get('/api/v1/admin/orders'), STAFF)).status).toBe(200);
    const managerMe = await as(request(app).get('/api/v1/admin/me'), MANAGER);
    expect(managerMe.body.mfa.required).toBe(true);
  });

  it('the session-events route stays reachable at aal1 for an MFA-required account', async () => {
    const { repo, app } = setup({ postMigration: true });
    const res = await as(request(app).post('/api/v1/admin/session-events'), MANAGER).send({ event: 'login' });
    expect(res.status).toBe(202);
    const row = repo.auditEvents.find((e) => e.action === 'auth.login');
    expect(row).toMatchObject({ actorId: 'manager-1', actorRole: 'manager' });
  });

  it("the owner's flag makes staff required — enforced on the very next request", async () => {
    const { app } = setup({ postMigration: true });
    expect((await as(request(app).get('/api/v1/admin/orders'), STAFF)).status).toBe(200);
    const put = await as(request(app).put('/api/v1/admin/staff/staff-1/mfa-required').send({ mfaRequired: true }), ADMIN2);
    expect(put.status).toBe(200);
    const gated = await as(request(app).get('/api/v1/admin/orders'), STAFF);
    expect(gated.status).toBe(403);
    expect(gated.body.code).toBe('MFA_REQUIRED');
    expect((await as(request(app).get('/api/v1/admin/orders'), STAFF_AAL2)).status).toBe(200);
  });
});

describe('audit-write cross-role cell', () => {
  it("a MANAGER's mutation writes the audit row with the manager as actor", async () => {
    const { repo, app } = setup();
    const fx = await seedFx(repo);
    const res = await as(request(app).patch(`/api/v1/admin/orders/${fx.orderId}/status`), MANAGER)
      .send({ status: 'confirmed' });
    expect(res.status).toBe(200);
    const rows = repo.auditEvents.filter((e) => e.action === 'order.status_changed');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorId: 'manager-1', actorRole: 'manager', entity: 'order', entityId: fx.orderId,
      changes: { status: { from: 'pending', to: 'confirmed' } },
    });
  });
});
