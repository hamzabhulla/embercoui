import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';
import { FakeStripeService } from './fakeStripe';
import { FakeStorageService } from './fakeStorage';
import { FakeAuthAdminService } from './fakeAuthAdmin';

// Phase B — owner-controlled two-factor requirement + aal2 gate.
// Route behaviour runs over the fake repository; fakeVerifyToken's
// '-aal2' suffix yields the same user with an MFA-verified session.
// The REAL verifier's aal extraction is pinned separately in
// auth-verifier-real.test.ts; the REAL repository's tri-state read
// and pre-0013 degradation in mfa-repository.test.ts.

function setup({ withAuthAdmin = true, postMigration = true } = {}) {
  const repo = new FakeRepository();
  // The fake's default world is PRE-0013 (no mfa_required column —
  // enforcement off), which is what every other suite assumes. This
  // suite's subject is the world AFTER the owner runs 0013: the
  // column exists and every seeded profile holds NULL (no per-person
  // decision yet, so role defaults govern). The pre-0013 describe
  // below opts back out explicitly.
  if (postMigration) {
    for (const p of repo.profiles.values()) p.mfaRequired = null;
  }
  const authAdmin = new FakeAuthAdminService();
  const app = createApp({
    env: testEnv(), repo, verifyToken: fakeVerifyToken,
    stripe: new FakeStripeService(), storage: new FakeStorageService(),
    ...(withAuthAdmin ? { authAdmin } : {}),
  });
  return { repo, app, authAdmin };
}

const as = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);
const ADMIN = 'token-admin';
const ADMIN2 = 'token-admin-aal2';
const MANAGER = 'token-manager';
const MANAGER2 = 'token-manager-aal2';
const STAFF = 'token-staff';
const STAFF2 = 'token-staff-aal2';
const USER = 'token-user';

describe('/admin/me — the MFA contract', () => {
  const { app } = setup();

  it('owner at aal1: 200 with required + unsatisfied, and NOTHING beyond identity/permissions/mfa', async () => {
    const res = await as(request(app).get('/api/v1/admin/me'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.mfa).toEqual({ required: true, satisfied: false });
    // The one response an unsatisfied caller can read must not leak
    // admin data: exactly these five keys, no more.
    expect(Object.keys(res.body).sort()).toEqual(['email', 'id', 'mfa', 'permissions', 'role']);
  });

  it('owner at aal2: satisfied', async () => {
    const res = await as(request(app).get('/api/v1/admin/me'), ADMIN2);
    expect(res.status).toBe(200);
    expect(res.body.mfa).toEqual({ required: true, satisfied: true });
  });

  it('manager defaults ON like the owner; staff defaults OFF', async () => {
    const manager = await as(request(app).get('/api/v1/admin/me'), MANAGER);
    expect(manager.body.mfa).toEqual({ required: true, satisfied: false });
    const manager2 = await as(request(app).get('/api/v1/admin/me'), MANAGER2);
    expect(manager2.body.mfa).toEqual({ required: true, satisfied: true });
    const staff = await as(request(app).get('/api/v1/admin/me'), STAFF);
    expect(staff.body.mfa).toEqual({ required: false, satisfied: true });
  });
});

describe('the gate — every data route, per role and level', () => {
  const { app } = setup();

  it('owner at aal1: 403 with code MFA_REQUIRED on reads AND writes alike', async () => {
    for (const path of ['/dashboard', '/orders', '/menu', '/reservations', '/customers', '/reviews', '/coupons', '/finance', '/staff', '/settings', '/permissions/roles']) {
      const res = await as(request(app).get(`/api/v1/admin${path}`), ADMIN);
      expect(res.status, path).toBe(403);
      expect(res.body.code, path).toBe('MFA_REQUIRED');
    }
    const write = await as(request(app).post('/api/v1/admin/coupons').send({ code: 'NEW10', type: 'percent', value: 10 }), ADMIN);
    expect(write.status).toBe(403);
    expect(write.body.code).toBe('MFA_REQUIRED');
    // Even the owner's own MFA management endpoints sit behind the
    // gate: you must complete verification before changing the rules.
    const manage = await as(request(app).put('/api/v1/admin/staff/staff-1/mfa-required').send({ mfaRequired: false }), ADMIN);
    expect(manage.status).toBe(403);
    expect(manage.body.code).toBe('MFA_REQUIRED');
  });

  it('owner at aal2: the panel opens (section gates then apply as usual)', async () => {
    expect((await as(request(app).get('/api/v1/admin/orders'), ADMIN2)).status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/dashboard'), ADMIN2)).status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/staff'), ADMIN2)).status).toBe(200);
  });

  it('manager at aal1 is gated, at aal2 passes; staff is never gated by default', async () => {
    const gated = await as(request(app).get('/api/v1/admin/orders'), MANAGER);
    expect(gated.status).toBe(403);
    expect(gated.body.code).toBe('MFA_REQUIRED');
    expect((await as(request(app).get('/api/v1/admin/orders'), MANAGER2)).status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/orders'), STAFF)).status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/orders'), STAFF2)).status).toBe(200);
  });

  it('a customer is refused by role (403) — with NO MFA code attached', async () => {
    const res = await as(request(app).get('/api/v1/admin/me'), USER);
    expect(res.status).toBe(403);
    expect(res.body.code).toBeUndefined();
    const data = await as(request(app).get('/api/v1/admin/orders'), USER);
    expect(data.status).toBe(403);
    expect(data.body.code).toBeUndefined();
  });
});

describe('the explicit flag beats the role default in both directions', () => {
  const { repo, app } = setup();

  it('staff with mfaRequired=true: gated at aal1, open at aal2', async () => {
    repo.profiles.get('staff-1')!.mfaRequired = true;
    const me = await as(request(app).get('/api/v1/admin/me'), STAFF);
    expect(me.body.mfa).toEqual({ required: true, satisfied: false });
    const gated = await as(request(app).get('/api/v1/admin/orders'), STAFF);
    expect(gated.status).toBe(403);
    expect(gated.body.code).toBe('MFA_REQUIRED');
    expect((await as(request(app).get('/api/v1/admin/orders'), STAFF2)).status).toBe(200);
  });

  it('clearing the flag back to null restores the staff default (off)', async () => {
    repo.profiles.get('staff-1')!.mfaRequired = null;
    expect((await as(request(app).get('/api/v1/admin/orders'), STAFF)).status).toBe(200);
  });

  it('owner with mfaRequired=false: aal1 passes — the release is real', async () => {
    repo.profiles.get('admin-1')!.mfaRequired = false;
    const me = await as(request(app).get('/api/v1/admin/me'), ADMIN);
    expect(me.body.mfa).toEqual({ required: false, satisfied: true });
    expect((await as(request(app).get('/api/v1/admin/orders'), ADMIN)).status).toBe(200);
    repo.profiles.get('admin-1')!.mfaRequired = null;
  });

  it('manager with mfaRequired=false: aal1 passes too', async () => {
    repo.profiles.get('manager-1')!.mfaRequired = false;
    expect((await as(request(app).get('/api/v1/admin/orders'), MANAGER)).status).toBe(200);
    repo.profiles.get('manager-1')!.mfaRequired = null;
  });
});

describe('pre-0013 world: the column does not exist and enforcement is OFF', () => {
  // The fake's default state (setup WITHOUT the post-migration
  // opt-in): profiles carry no mfaRequired at all, exactly what the
  // real repository yields when the column is absent.
  const { app } = setup({ postMigration: false });

  it('owner and manager at aal1 use the panel exactly as before Phase B', async () => {
    const me = await as(request(app).get('/api/v1/admin/me'), ADMIN);
    expect(me.body.mfa).toEqual({ required: false, satisfied: true });
    expect((await as(request(app).get('/api/v1/admin/orders'), ADMIN)).status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/orders'), MANAGER)).status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/dashboard'), MANAGER)).status).toBe(200);
  });
});

describe('PUT /staff/:id/mfa-required — the owner toggle', () => {
  const { repo, app } = setup();

  it('sets, clears and re-sets the flag; audit rows carry {from,to} and skip no-ops', async () => {
    const on = await as(request(app).put('/api/v1/admin/staff/staff-1/mfa-required').send({ mfaRequired: true }), ADMIN2);
    expect(on.status).toBe(200);
    expect(on.body.profile.mfaRequired).toBe(true);
    expect(on.body.mfaRequiredEffective).toBe(true);
    // The change is live on the very next request.
    expect((await as(request(app).get('/api/v1/admin/orders'), STAFF)).status).toBe(403);

    const off = await as(request(app).put('/api/v1/admin/staff/staff-1/mfa-required').send({ mfaRequired: null }), ADMIN2);
    expect(off.status).toBe(200);
    expect(off.body.profile.mfaRequired).toBeNull();
    expect(off.body.mfaRequiredEffective).toBe(false); // staff role default
    expect((await as(request(app).get('/api/v1/admin/orders'), STAFF)).status).toBe(200);

    await as(request(app).put('/api/v1/admin/staff/staff-1/mfa-required').send({ mfaRequired: null }), ADMIN2);

    const rows = repo.auditEvents.filter((e) => e.action === 'staff.mfa_required_changed');
    expect(rows).toHaveLength(2); // the third PUT changed nothing → no row
    expect(rows[0]).toMatchObject({
      actorId: 'admin-1', actorRole: 'admin', entity: 'profile', entityId: 'staff-1',
      changes: { mfaRequired: { from: null, to: true } },
    });
    expect(rows[1]).toMatchObject({ changes: { mfaRequired: { from: true, to: null } } });
  });

  it("the owner can release their OWN requirement — allowed, and logged like anyone's", async () => {
    const res = await as(request(app).put('/api/v1/admin/staff/admin-1/mfa-required').send({ mfaRequired: false }), ADMIN2);
    expect(res.status).toBe(200);
    expect(res.body.mfaRequiredEffective).toBe(false);
    expect((await as(request(app).get('/api/v1/admin/orders'), ADMIN)).status).toBe(200);
    const own = repo.auditEvents.find((e) => e.action === 'staff.mfa_required_changed' && e.entityId === 'admin-1');
    expect(own).toMatchObject({ actorId: 'admin-1', changes: { mfaRequired: { from: null, to: false } } });
    // Restore for the other tests in this group.
    await as(request(app).put('/api/v1/admin/staff/admin-1/mfa-required').send({ mfaRequired: null }), ADMIN2);
  });

  it('bad values are 400 and unknown people 404 — nothing is stored', async () => {
    expect((await as(request(app).put('/api/v1/admin/staff/staff-1/mfa-required').send({ mfaRequired: 'yes' }), ADMIN2)).status).toBe(400);
    expect((await as(request(app).put('/api/v1/admin/staff/staff-1/mfa-required').send({}), ADMIN2)).status).toBe(400);
    expect((await as(request(app).put('/api/v1/admin/staff/nobody/mfa-required').send({ mfaRequired: true }), ADMIN2)).status).toBe(404);
    expect(repo.profiles.get('staff-1')!.mfaRequired).toBeNull();
  });
});

describe('management endpoints are owner-only — never assignable', () => {
  const { app } = setup();

  it('a manager holding staff:manage gets 403 on both MFA endpoints', async () => {
    const grant = await as(request(app).put('/api/v1/admin/staff/manager-1/permissions')
      .send({ permissions: { staff: 'manage' } }), ADMIN2);
    expect(grant.status).toBe(200);
    expect((await as(request(app).get('/api/v1/admin/staff'), MANAGER2)).status).toBe(200);
    expect((await as(request(app).put('/api/v1/admin/staff/staff-1/mfa-required').send({ mfaRequired: true }), MANAGER2)).status).toBe(403);
    expect((await as(request(app).post('/api/v1/admin/staff/staff-1/mfa/reset'), MANAGER2)).status).toBe(403);
    expect((await as(request(app).put('/api/v1/admin/staff/staff-1/mfa-required').send({ mfaRequired: true }), STAFF2)).status).toBe(403);
  });
});

describe('POST /staff/:id/mfa/reset — the recovery path', () => {
  const { repo, app, authAdmin } = setup();
  authAdmin.seed('staff-1', [
    { id: 'fac-verified', status: 'verified', factorType: 'totp' },
    { id: 'fac-abandoned', status: 'unverified', factorType: 'totp' },
  ]);

  it('deletes every factor through the Admin API and logs the reset', async () => {
    const res = await as(request(app).post('/api/v1/admin/staff/staff-1/mfa/reset'), ADMIN2);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reset: true, factorsRemoved: 2 });
    expect(authAdmin.calls).toEqual([
      { method: 'list', userId: 'staff-1' },
      { method: 'delete', userId: 'staff-1', factorId: 'fac-verified' },
      { method: 'delete', userId: 'staff-1', factorId: 'fac-abandoned' },
    ]);
    expect(await authAdmin.listMfaFactors('staff-1')).toEqual([]);
    const row = repo.auditEvents.find((e) => e.action === 'staff.mfa_reset');
    expect(row).toMatchObject({
      actorId: 'admin-1', actorRole: 'admin', entity: 'profile', entityId: 'staff-1',
      changes: { mfaFactors: { from: 2, to: 0 } },
    });
  });

  it('a second reset is a clean no-op: 200, zero removed, no new audit row', async () => {
    const before = repo.auditEvents.filter((e) => e.action === 'staff.mfa_reset').length;
    const res = await as(request(app).post('/api/v1/admin/staff/staff-1/mfa/reset'), ADMIN2);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reset: true, factorsRemoved: 0 });
    expect(repo.auditEvents.filter((e) => e.action === 'staff.mfa_reset')).toHaveLength(before);
  });

  it('unknown person 404s before the Admin API is touched', async () => {
    const callsBefore = authAdmin.calls.length;
    expect((await as(request(app).post('/api/v1/admin/staff/nobody/mfa/reset'), ADMIN2)).status).toBe(404);
    expect(authAdmin.calls.length).toBe(callsBefore);
  });

  it('an Admin API failure answers an honest 502, removes nothing, logs nothing', async () => {
    const { repo: repo2, app: app2, authAdmin: authAdmin2 } = setup();
    authAdmin2.seed('staff-1', [{ id: 'fac-1', status: 'verified', factorType: 'totp' }]);
    authAdmin2.failWith = new Error('auth service down');
    const res = await as(request(app2).post('/api/v1/admin/staff/staff-1/mfa/reset'), ADMIN2);
    expect(res.status).toBe(502);
    expect(authAdmin2.factors.get('staff-1')).toHaveLength(1);
    expect(repo2.auditEvents.filter((e) => e.action === 'staff.mfa_reset')).toHaveLength(0);
  });

  it('without the Admin API configured the endpoint answers 503, never a fake success', async () => {
    const { app: bare } = setup({ withAuthAdmin: false });
    const res = await as(request(bare).post('/api/v1/admin/staff/staff-1/mfa/reset'), ADMIN2);
    expect(res.status).toBe(503);
  });
});
