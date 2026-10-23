import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { FakeRepository, dateFromToday, fakeVerifyToken, testEnv } from './fakeRepository';
import { FakeStripeService } from './fakeStripe';
import { FakeStorageService } from './fakeStorage';
import { FakeAuthAdminService } from './fakeAuthAdmin';

// Phase C — Security & Activity: session events written from verified
// tokens, failed sign-ins as honestly-flagged client reports, audit
// hooks on the main admin mutations, and the security:view-gated
// read API + CSV export. Route behaviour runs over the fake
// repository; the REAL repository's query translation + degradation
// are pinned in security-repository.test.ts.

function setup({ postMigration = false } = {}) {
  const repo = new FakeRepository();
  // The fake's default world is PRE-0013 (MFA enforcement off) — the
  // right default here too: session events and the read API must work
  // in it. The one describe that needs the MFA gate opts in.
  if (postMigration) {
    for (const p of repo.profiles.values()) p.mfaRequired = null;
  }
  const app = createApp({
    env: testEnv(), repo, verifyToken: fakeVerifyToken,
    stripe: new FakeStripeService(), storage: new FakeStorageService(),
    authAdmin: new FakeAuthAdminService(),
  });
  return { repo, app };
}

const as = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);
const ADMIN = 'token-admin';
const ADMIN2 = 'token-admin-aal2';
const STAFF = 'token-staff';
const STAFF2 = 'token-staff-aal2';
const MANAGER = 'token-manager';
const USER = 'token-user';

const authRows = (repo: FakeRepository) => repo.auditEvents.filter((e) => e.action.startsWith('auth.'));

describe('POST /admin/session-events — verified login activity', () => {
  it('a login event writes a row from the VERIFIED token: actor, role, ip, user-agent', async () => {
    const { repo, app } = setup();
    const res = await as(request(app).post('/api/v1/admin/session-events'), ADMIN)
      .set('User-Agent', 'EmberTest/1.0')
      .send({ event: 'login' });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ recorded: true });
    const rows = authRows(repo);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      action: 'auth.login',
      actorId: 'admin-1',
      actorLabel: 'Admin',
      actorRole: 'admin',
      entity: 'session',
    });
    expect(rows[0].ip).toBeTruthy();
    expect(rows[0].userAgent).toBe('EmberTest/1.0');
  });

  it('mfa_verified (at aal2) and logout map to their actions', async () => {
    const { repo, app } = setup();
    await as(request(app).post('/api/v1/admin/session-events'), STAFF2).send({ event: 'mfa_verified' });
    await as(request(app).post('/api/v1/admin/session-events'), STAFF).send({ event: 'logout' });
    expect(authRows(repo).map((e) => e.action)).toEqual(['auth.mfa_verified', 'auth.logout']);
    expect(authRows(repo).every((e) => e.actorId === 'staff-1' && e.actorRole === 'staff')).toBe(true);
  });

  it('mfa_verified from an aal1 (password-only) token is a 403 and writes NOTHING', async () => {
    const { repo, app } = setup();
    // The row would be presented as verified server truth, so a
    // session that has not itself completed two-factor verification
    // cannot assert it — for any privileged role.
    for (const token of [ADMIN, STAFF, MANAGER]) {
      const res = await as(request(app).post('/api/v1/admin/session-events'), token).send({ event: 'mfa_verified' });
      expect(res.status).toBe(403);
    }
    expect(repo.auditEvents).toHaveLength(0);
    // The aal is read from the VERIFIED token only: a body or query
    // claiming aal2 changes nothing (the strict body schema 400s the
    // extra field; a query claim is ignored and the aal1 rule bites).
    const spoofed = await as(request(app).post('/api/v1/admin/session-events?aal=aal2'), ADMIN).send({ event: 'mfa_verified' });
    expect(spoofed.status).toBe(403);
    expect(repo.auditEvents).toHaveLength(0);
  });

  it('login and logout stay recordable at aal1 (the route sits above the MFA gate for them)', async () => {
    const { repo, app } = setup();
    expect((await as(request(app).post('/api/v1/admin/session-events'), STAFF).send({ event: 'login' })).status).toBe(202);
    expect((await as(request(app).post('/api/v1/admin/session-events'), STAFF).send({ event: 'logout' })).status).toBe(202);
    expect(authRows(repo).map((e) => e.action)).toEqual(['auth.login', 'auth.logout']);
  });

  it('a customer token is rejected (403) and writes nothing', async () => {
    const { repo, app } = setup();
    const res = await as(request(app).post('/api/v1/admin/session-events'), USER).send({ event: 'login' });
    expect(res.status).toBe(403);
    expect(repo.auditEvents).toHaveLength(0);
  });

  it('no token is a 401', async () => {
    const { app } = setup();
    expect((await request(app).post('/api/v1/admin/session-events').send({ event: 'login' })).status).toBe(401);
  });

  it('an unknown event value is a 400 and writes nothing', async () => {
    const { repo, app } = setup();
    const res = await as(request(app).post('/api/v1/admin/session-events'), ADMIN).send({ event: 'hacked' });
    expect(res.status).toBe(400);
    expect(repo.auditEvents).toHaveLength(0);
  });

  it('the client cannot spoof actor/ip: extra body fields are a 400, never stored', async () => {
    const { repo, app } = setup();
    const res = await as(request(app).post('/api/v1/admin/session-events'), ADMIN)
      .send({ event: 'login', actorId: 'someone-else', actorLabel: 'Fake', ip: '1.2.3.4', createdAt: '1970-01-01T00:00:00Z' });
    expect(res.status).toBe(400);
    expect(repo.auditEvents.filter((e) => e.actorId === 'someone-else')).toHaveLength(0);
    expect(repo.auditEvents).toHaveLength(0);
  });

  it('stays reachable at aal1 for an MFA-required account (it is registered above the MFA gate)', async () => {
    const { repo, app } = setup({ postMigration: true });
    // The owner at aal1 is MFA-unsatisfied: every data route 403s
    // with MFA_REQUIRED, but the login event — the thing that STARTS
    // the MFA flow — must still be recordable.
    const data = await as(request(app).get('/api/v1/admin/orders'), ADMIN);
    expect(data.status).toBe(403);
    const res = await as(request(app).post('/api/v1/admin/session-events'), ADMIN).send({ event: 'login' });
    expect(res.status).toBe(202);
    expect(authRows(repo)).toHaveLength(1);
    // And once verified (aal2), the mfa_verified event lands too.
    const res2 = await as(request(app).post('/api/v1/admin/session-events'), ADMIN2).send({ event: 'mfa_verified' });
    expect(res2.status).toBe(202);
    expect(authRows(repo).map((e) => e.action)).toEqual(['auth.login', 'auth.mfa_verified']);
  });
});

describe('POST /auth/admin-login-failed — unverified client reports', () => {
  it('writes a flagged row: no actor id, the attempted email as label, ip/ua from the request', async () => {
    const { repo, app } = setup();
    const res = await request(app).post('/api/v1/auth/admin-login-failed')
      .set('User-Agent', 'EmberTest/2.0')
      .send({ email: 'Owner@Example.com' });
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ received: true });
    const rows = repo.auditEvents.filter((e) => e.action === 'auth.login_failed');
    expect(rows).toHaveLength(1);
    expect(rows[0].actorId).toBeNull();
    expect(rows[0].actorLabel).toBe('owner@example.com');
    expect(rows[0].actorRole).toBeNull();
    expect(rows[0].changes).toBeNull();
    expect(rows[0].ip).toBeTruthy();
    expect(rows[0].userAgent).toBe('EmberTest/2.0');
  });

  it('answers identically for an email that belongs to no account (no existence leak)', async () => {
    const { app } = setup();
    const known = await request(app).post('/api/v1/auth/admin-login-failed').send({ email: 'admin@example.com' });
    const unknown = await request(app).post('/api/v1/auth/admin-login-failed').send({ email: 'ghost@nowhere.example' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
  });

  it('rejects an invalid or oversized email with a 400 and writes nothing', async () => {
    const { repo, app } = setup();
    expect((await request(app).post('/api/v1/auth/admin-login-failed').send({ email: 'not-an-email' })).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/admin-login-failed').send({ email: `${'a'.repeat(250)}@x.co` })).status).toBe(400);
    expect((await request(app).post('/api/v1/auth/admin-login-failed').send({})).status).toBe(400);
    expect(repo.auditEvents).toHaveLength(0);
  });

  it('is tightly rate-limited: the 6th report from one IP inside the window is a 429', async () => {
    const { app } = setup();
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/v1/auth/admin-login-failed').send({ email: `try${i}@example.com` });
      expect(res.status).toBe(202);
    }
    const sixth = await request(app).post('/api/v1/auth/admin-login-failed').send({ email: 'try6@example.com' });
    expect(sixth.status).toBe(429);
  });
});

describe('change-history hooks on admin mutations', () => {
  it('order status change writes exactly one row with the exact from → to; a no-op write writes none', async () => {
    const { repo, app } = setup();
    const order = await repo.createOrder({
      userId: 'user-1', customerName: 'Test User', customerEmail: 'user@example.com', customerPhone: null,
      address: null, notes: null, couponCode: null, currency: 'USD',
      items: [{ menuItemId: 1, name: 'Ember Classic', unitPrice: 24, quantity: 1 }],
      subtotal: 24, deliveryFee: 0, discount: 0, total: 24,
    });
    const res = await as(request(app).patch(`/api/v1/admin/orders/${order.id}/status`), ADMIN).send({ status: 'confirmed' });
    expect(res.status).toBe(200);
    const rows = repo.auditEvents.filter((e) => e.action === 'order.status_changed');
    expect(rows).toHaveLength(1);
    expect(rows[0].entity).toBe('order');
    expect(rows[0].entityId).toBe(order.id);
    expect(rows[0].actorId).toBe('admin-1');
    expect(rows[0].changes).toEqual({ status: { from: 'pending', to: 'confirmed' } });

    const noop = await as(request(app).patch(`/api/v1/admin/orders/${order.id}/status`), ADMIN).send({ status: 'confirmed' });
    expect(noop.status).toBe(200);
    expect(repo.auditEvents.filter((e) => e.action === 'order.status_changed')).toHaveLength(1);
  });

  it('menu price edit diffs the price; a no-op edit writes no row', async () => {
    const { repo, app } = setup();
    const res = await as(request(app).patch('/api/v1/admin/menu/1'), ADMIN).send({ price: 26 });
    expect(res.status).toBe(200);
    const rows = repo.auditEvents.filter((e) => e.action === 'menu_item.updated');
    expect(rows).toHaveLength(1);
    expect(rows[0].changes).toEqual({ price: { from: 24, to: 26 } });
    expect(rows[0].summary).toContain('Ember Classic');

    await as(request(app).patch('/api/v1/admin/menu/1'), ADMIN).send({ price: 26 });
    expect(repo.auditEvents.filter((e) => e.action === 'menu_item.updated')).toHaveLength(1);
  });

  it('menu create and delete are recorded; the delete keeps the item name', async () => {
    const { repo, app } = setup();
    const created = await as(request(app).post('/api/v1/admin/menu'), ADMIN).send({
      name: 'Charred Leeks', description: '', price: 12, image: '', category: 'Starters', tags: [], isAvailable: true, sortOrder: 9,
    });
    expect(created.status).toBe(201);
    const createRow = repo.auditEvents.find((e) => e.action === 'menu_item.created');
    expect(createRow?.changes).toMatchObject({ price: { from: null, to: 12 } });

    const del = await as(request(app).delete('/api/v1/admin/menu/3'), ADMIN);
    expect(del.status).toBe(200);
    const delRow = repo.auditEvents.find((e) => e.action === 'menu_item.deleted');
    expect(delRow?.summary).toContain('Secret Special');
  });

  it('coupon create/update/delete are recorded; the delete keeps the code', async () => {
    const { repo, app } = setup();
    const created = await as(request(app).post('/api/v1/admin/coupons'), ADMIN).send({
      code: 'HARVEST15', type: 'percent', value: 15, isActive: true, expiresAt: null,
    });
    expect(created.status).toBe(201);
    expect(repo.auditEvents.find((e) => e.action === 'coupon.created')?.entityId).toBe(created.body.coupon.id);

    const updated = await as(request(app).patch(`/api/v1/admin/coupons/${created.body.coupon.id}`), ADMIN).send({ value: 20 });
    expect(updated.status).toBe(200);
    const updRow = repo.auditEvents.find((e) => e.action === 'coupon.updated');
    expect(updRow?.changes).toEqual({ value: { from: 15, to: 20 } });

    const del = await as(request(app).delete('/api/v1/admin/coupons/cpn-1'), ADMIN);
    expect(del.status).toBe(200);
    expect(repo.auditEvents.find((e) => e.action === 'coupon.deleted')?.summary).toContain('WELCOME10');
  });

  it('reservation create + status change are recorded with from → to', async () => {
    const { repo, app } = setup();
    const created = await as(request(app).post('/api/v1/admin/reservations'), ADMIN).send({
      name: 'Walk In', phone: '1234567', date: dateFromToday(30), time: '19:00', guests: 2, status: 'pending',
    });
    expect(created.status).toBe(201);
    const createRow = repo.auditEvents.find((e) => e.action === 'reservation.created');
    expect(createRow?.entityId).toBe(created.body.reservation.id);
    expect(createRow?.summary).toContain('Walk In');

    const id = created.body.reservation.id as string;
    const changed = await as(request(app).patch(`/api/v1/admin/reservations/${id}/status`), ADMIN).send({ status: 'confirmed' });
    expect(changed.status).toBe(200);
    const row = repo.auditEvents.find((e) => e.action === 'reservation.status_changed');
    expect(row?.changes).toEqual({ status: { from: 'pending', to: 'confirmed' } });
  });

  it('settings update diffs only the changed keys; an unchanged save writes no row', async () => {
    const { repo, app } = setup();
    const res = await as(request(app).patch('/api/v1/admin/settings'), ADMIN).send({ waitMin: 25, phone: '+1 555 0100' });
    expect(res.status).toBe(200);
    const rows = repo.auditEvents.filter((e) => e.action === 'settings.updated');
    expect(rows).toHaveLength(1);
    expect(rows[0].changes).toEqual({
      waitMin: { from: 20, to: 25 },
      phone: { from: null, to: '+1 555 0100' },
    });

    const noop = await as(request(app).patch('/api/v1/admin/settings'), ADMIN).send({ waitMin: 25 });
    expect(noop.status).toBe(200);
    expect(repo.auditEvents.filter((e) => e.action === 'settings.updated')).toHaveLength(1);
  });

  it('settings site-locations changes flatten to the exact field', async () => {
    const { repo, app } = setup();
    const res = await as(request(app).patch('/api/v1/admin/settings'), ADMIN)
      .send({ siteLocations: { footer: { phone: '+1 555 0199' } } });
    expect(res.status).toBe(200);
    const row = repo.auditEvents.find((e) => e.action === 'settings.updated');
    expect(row?.changes).toEqual({ 'siteLocations.footer.phone': { from: null, to: '+1 555 0199' } });
  });
});

describe('GET /admin/security/events — the read API', () => {
  async function seeded() {
    const { repo, app } = setup();
    await repo.insertAuditEvent({
      actorId: 'admin-1', actorLabel: 'Admin', actorRole: 'admin', action: 'auth.login',
      entity: 'session', entityId: null, summary: 'Admin sign-in', changes: null,
      ip: '203.0.113.9', userAgent: 'EmberTest/1.0',
    });
    await repo.insertAuditEvent({
      actorId: null, actorLabel: 'intruder@example.com', actorRole: null, action: 'auth.login_failed',
      entity: null, entityId: null, summary: 'Failed admin sign-in attempt (client report — unverified)',
      changes: null, ip: '198.51.100.7', userAgent: 'curl/8',
    });
    await repo.insertAuditEvent({
      actorId: 'staff-1', actorLabel: 'Staff', actorRole: 'staff', action: 'menu_item.updated',
      entity: 'menu_item', entityId: '1', summary: 'Menu item "Ember Classic" updated',
      changes: { price: { from: 24, to: 26 } }, ip: '203.0.113.10', userAgent: 'EmberTest/1.0',
    });
    await repo.insertAuditEvent({
      actorId: 'admin-1', actorLabel: 'Admin', actorRole: 'admin', action: 'coupon.created',
      entity: 'coupon', entityId: 'cpn-9', summary: 'Coupon HARVEST15 created',
      changes: { code: { from: null, to: 'HARVEST15' } }, ip: '203.0.113.9', userAgent: 'EmberTest/1.0',
    });
    return { repo, app };
  }

  it('security:none (staff + manager built-in defaults) is a 403 on both endpoints', async () => {
    const { app } = await seeded();
    expect((await as(request(app).get('/api/v1/admin/security/events'), STAFF)).status).toBe(403);
    expect((await as(request(app).get('/api/v1/admin/security/events'), MANAGER)).status).toBe(403);
    expect((await as(request(app).get('/api/v1/admin/security/events.csv'), STAFF)).status).toBe(403);
  });

  it('a role granted security:view through the owner lever can read', async () => {
    const { repo, app } = await seeded();
    repo.rolePermissions.set('staff', { security: 'view' });
    const res = await as(request(app).get('/api/v1/admin/security/events'), STAFF);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
  });

  it('rows carry the contract shape: derived category, actor, entity, changes, trust metadata', async () => {
    const { app } = await seeded();
    const res = await as(request(app).get('/api/v1/admin/security/events'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4);
    expect(res.body.degraded).toBe(false);
    const byAction = new Map((res.body.events as { action: string }[]).map((e) => [e.action, e]));
    const login = byAction.get('auth.login');
    expect(login).toMatchObject({
      category: 'auth',
      actor: { id: 'admin-1', label: 'Admin', role: 'admin' },
      metadata: { ip: '203.0.113.9', userAgent: 'EmberTest/1.0', verified: true, source: 'server' },
    });
    const failed = byAction.get('auth.login_failed');
    expect(failed).toMatchObject({
      category: 'auth',
      actor: { id: null, label: 'intruder@example.com', role: null },
      metadata: { verified: false, source: 'client-report' },
    });
    const menu = byAction.get('menu_item.updated');
    expect(menu).toMatchObject({
      category: 'change',
      entity: { type: 'menu_item', id: '1', label: 'Menu item "Ember Classic" updated' },
      changes: { price: { from: 24, to: 26 } },
    });
  });

  it('filters actually filter: category, action prefix, actorId, q, date range', async () => {
    const { app } = await seeded();
    const auth = await as(request(app).get('/api/v1/admin/security/events?category=auth'), ADMIN);
    expect(auth.body.total).toBe(2);
    expect((auth.body.events as { category: string }[]).every((e) => e.category === 'auth')).toBe(true);

    const changes = await as(request(app).get('/api/v1/admin/security/events?category=change'), ADMIN);
    expect(changes.body.total).toBe(2);

    const prefix = await as(request(app).get('/api/v1/admin/security/events?action=menu_item.'), ADMIN);
    expect(prefix.body.total).toBe(1);
    expect(prefix.body.events[0].action).toBe('menu_item.updated');

    const actor = await as(request(app).get('/api/v1/admin/security/events?actorId=staff-1'), ADMIN);
    expect(actor.body.total).toBe(1);

    const byText = await as(request(app).get('/api/v1/admin/security/events?q=HARVEST15'), ADMIN);
    expect(byText.body.total).toBe(1);
    expect(byText.body.events[0].action).toBe('coupon.created');

    const future = await as(request(app).get('/api/v1/admin/security/events?from=2999-01-01'), ADMIN);
    expect(future.body.total).toBe(0);
    const past = await as(request(app).get('/api/v1/admin/security/events?to=2000-01-01'), ADMIN);
    expect(past.body.total).toBe(0);
  });

  it('pagination bounds: totals are the filtered count, pages tile, a huge limit clamps, garbage is a 400', async () => {
    const { app } = await seeded();
    const page1 = await as(request(app).get('/api/v1/admin/security/events?limit=2&offset=0'), ADMIN);
    expect(page1.status).toBe(200);
    expect(page1.body.events).toHaveLength(2);
    expect(page1.body.total).toBe(4);
    const page2 = await as(request(app).get('/api/v1/admin/security/events?limit=2&offset=2'), ADMIN);
    expect(page2.body.events).toHaveLength(2);
    const ids = new Set([...page1.body.events, ...page2.body.events].map((e: { id: string }) => e.id));
    expect(ids.size).toBe(4);

    const clamped = await as(request(app).get('/api/v1/admin/security/events?limit=99999'), ADMIN);
    expect(clamped.status).toBe(200);
    expect(clamped.body.limit).toBe(500);
    expect((await as(request(app).get('/api/v1/admin/security/events?limit=abc'), ADMIN)).status).toBe(400);
    expect((await as(request(app).get('/api/v1/admin/security/events?category=bogus'), ADMIN)).status).toBe(400);
    expect((await as(request(app).get('/api/v1/admin/security/events?from=not-a-date'), ADMIN)).status).toBe(400);
  });

  it('pre-0012 degradation: an empty page flagged degraded, not a 500', async () => {
    const { repo, app } = setup();
    repo.auditLogAvailable = false;
    const res = await as(request(app).get('/api/v1/admin/security/events'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ events: [], total: 0, degraded: true });
  });
});

describe('GET /admin/security/events.csv — the export', () => {
  it('streams a CSV download with a dated filename, a header row and the data rows', async () => {
    const { repo, app } = setup();
    await repo.insertAuditEvent({
      actorId: 'admin-1', actorLabel: 'Admin', actorRole: 'admin', action: 'auth.login',
      entity: 'session', entityId: null, summary: 'Admin sign-in', changes: null,
      ip: '203.0.113.9', userAgent: 'EmberTest/1.0',
    });
    await repo.insertAuditEvent({
      actorId: 'admin-1', actorLabel: 'Admin', actorRole: 'admin', action: 'order.status_changed',
      entity: 'order', entityId: 'order-1', summary: 'Order status: pending → confirmed',
      changes: { status: { from: 'pending', to: 'confirmed' } }, ip: '203.0.113.9', userAgent: 'EmberTest/1.0',
    });
    const res = await as(request(app).get('/api/v1/admin/security/events.csv'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="security-activity-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe('"timestamp","category","action","actor","actor_role","entity","summary","changes","ip","user_agent","verification"');
    expect(lines).toHaveLength(3);
    expect(res.text).toContain('"auth.login"');
    expect(res.text).toContain('"order.status_changed"');
    expect(res.text).toContain('"verified"');
  });

  it('respects the same filters as the JSON read', async () => {
    const { repo, app } = setup();
    await repo.insertAuditEvent({
      actorId: 'admin-1', actorLabel: 'Admin', actorRole: 'admin', action: 'auth.login',
      entity: 'session', entityId: null, summary: 'Admin sign-in', changes: null, ip: null, userAgent: null,
    });
    await repo.insertAuditEvent({
      actorId: 'admin-1', actorLabel: 'Admin', actorRole: 'admin', action: 'coupon.deleted',
      entity: 'coupon', entityId: 'cpn-1', summary: 'Coupon WELCOME10 deleted', changes: null, ip: null, userAgent: null,
    });
    const res = await as(request(app).get('/api/v1/admin/security/events.csv?category=change'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.text).toContain('coupon.deleted');
    expect(res.text).not.toContain('auth.login');
  });

  it('neutralises spreadsheet formula triggers in actor, summary and changes cells', async () => {
    const { repo, app } = setup();
    await repo.insertAuditEvent({
      actorId: 'admin-1', actorLabel: '=cmd|calc', actorRole: 'admin', action: 'menu_item.updated',
      entity: 'menu_item', entityId: '1', summary: '=2+5+cmd',
      changes: { note: { from: null, to: '@SUM(1+1)' } }, ip: '203.0.113.9', userAgent: 'EmberTest/1.0',
    });
    const res = await as(request(app).get('/api/v1/admin/security/events.csv'), ADMIN);
    expect(res.status).toBe(200);
    // Formula-leading actor and summary cells are defused with a
    // leading apostrophe inside the quotes, so a spreadsheet shows
    // them as text instead of executing them.
    expect(res.text).toContain('"\'=cmd|calc"');
    expect(res.text).toContain('"\'=2+5+cmd"');
    // The changes payload rides inside the JSON-stringified cell,
    // which opens with '{' — the '@' value is never in formula
    // position at the start of a cell, so it needs (and gets) no
    // prefix; pin that no cell in the export opens with a bare
    // formula trigger.
    expect(res.text).toContain('"{""note""');
    expect(res.text).toContain('@SUM(1+1)');
    expect(res.text).not.toMatch(/,"[=+\-@]/);
  });

  it('defuses formulas hidden behind leading whitespace/control characters — and the pipe trigger', async () => {
    const { repo, app } = setup();
    // Spreadsheet apps strip leading spaces/tabs/newlines before
    // evaluating a cell (OWASP), so a trigger hiding behind them is
    // still a formula; '|' is a trigger in its own right.
    await repo.insertAuditEvent({
      actorId: 'admin-1', actorLabel: ' =cmd', actorRole: 'admin', action: 'menu_item.updated',
      entity: 'menu_item', entityId: '1', summary: '\r=cmd', changes: null, ip: null, userAgent: null,
    });
    await repo.insertAuditEvent({
      actorId: 'admin-1', actorLabel: 'Admin', actorRole: 'admin', action: 'menu_item.updated',
      entity: 'menu_item', entityId: '2', summary: '|x', changes: null, ip: null, userAgent: null,
    });
    await repo.insertAuditEvent({
      actorId: 'admin-1', actorLabel: '  Weekly regular', actorRole: 'admin', action: 'menu_item.updated',
      entity: 'menu_item', entityId: '3', summary: '  Notes from the floor', changes: null, ip: null, userAgent: null,
    });
    const res = await as(request(app).get('/api/v1/admin/security/events.csv'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.text).toContain('"\' =cmd"');
    expect(res.text).toContain('"\'\r=cmd"');
    expect(res.text).toContain('"\'|x"');
    // Leading whitespace before an ORDINARY character is not a
    // formula: those values stay byte-identical, no apostrophe.
    expect(res.text).toContain('"  Weekly regular"');
    expect(res.text).toContain('"  Notes from the floor"');
    expect(res.text).not.toContain("'  Weekly regular");
    expect(res.text).not.toContain("'  Notes from the floor");
  });
});

describe('the audit log is append-only — no route mutates it', () => {
  it('write verbs against the security surface are 404s, even for the owner', async () => {
    const { app } = setup();
    expect((await as(request(app).post('/api/v1/admin/security/events'), ADMIN).send({})).status).toBe(404);
    expect((await as(request(app).put('/api/v1/admin/security/events'), ADMIN).send({})).status).toBe(404);
    expect((await as(request(app).patch('/api/v1/admin/security/events'), ADMIN).send({})).status).toBe(404);
    expect((await as(request(app).delete('/api/v1/admin/security/events'), ADMIN)).status).toBe(404);
    expect((await as(request(app).delete('/api/v1/admin/security/events/some-id'), ADMIN)).status).toBe(404);
    expect((await as(request(app).patch('/api/v1/admin/security/events/some-id'), ADMIN).send({})).status).toBe(404);
  });
});
