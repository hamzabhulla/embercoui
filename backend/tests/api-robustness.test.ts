import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { OrderDTO } from '../src/repositories/types';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';
import { FakeStripeService } from './fakeStripe';

// Audit-2 fix 8 — API robustness pack, route level (fake repository).
// Each describe builds a fresh repo + app so limiter stores and
// monkeypatched repository methods never leak between groups.

const ABSENT_UUID = '123e4567-e89b-12d3-a456-426614174000';

function buildApp(repo: FakeRepository, extra: Record<string, unknown> = {}) {
  return createApp({
    env: testEnv(), repo, verifyToken: fakeVerifyToken,
    stripe: new FakeStripeService(), chat: null, ...extra,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

const guestOrderBody = {
  customerName: 'Guest One', customerEmail: 'guest@example.com', customerPhone: null,
  address: null, notes: null, couponCode: null, items: [{ menuItemId: 1, quantity: 1 }],
};

async function placeOrder(app: ReturnType<typeof buildApp>, overrides: Record<string, unknown> = {}, token?: string) {
  let req = request(app).post('/api/v1/orders');
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  return req.send({ ...guestOrderBody, ...overrides });
}

async function seedPendingOrder(repo: FakeRepository): Promise<OrderDTO> {
  return repo.createOrder({
    userId: null, customerName: 'Seed', customerEmail: 'seed@example.com', customerPhone: null,
    address: null, notes: null, couponCode: null, currency: 'USD', idempotencyKey: null,
    items: [{ menuItemId: 1, name: 'Ember Classic', unitPrice: 24, quantity: 1 }],
    subtotal: 24, deliveryFee: 0, discount: 0, total: 24,
  });
}

describe('conditional status transitions — stale writer gets an honest 409 (B-M1)', () => {
  it('order: a transition landing between read and write wins; the stale writer gets 409 + current state', async () => {
    const repo = new FakeRepository();
    const app = buildApp(repo);
    const order = await seedPendingOrder(repo);

    // Simulate the race deterministically: when the route's write
    // arrives, a FIRST writer (another admin) confirms the order
    // through the same conditional path, then the route's own write
    // is attempted against its now-stale expectation.
    const realUpdate = repo.updateOrderStatus.bind(repo);
    let raced = false;
    repo.updateOrderStatus = async (id, expected, target) => {
      if (!raced) {
        raced = true;
        await realUpdate(id, 'pending', 'confirmed');
      }
      return realUpdate(id, expected, target);
    };

    const res = await request(app)
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set('Authorization', 'Bearer token-admin')
      .send({ status: 'cancelled' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/changed — refresh/);
    // The response carries the CURRENT state, and it is the first
    // writer's — the stale cancel never applied.
    expect(res.body.order.status).toBe('confirmed');
    expect((await repo.getOrder(order.id))?.status).toBe('confirmed');
  });

  it('order: a payment landing mid-cancel also conflicts instead of cancelling a paid order', async () => {
    const repo = new FakeRepository();
    const app = buildApp(repo);
    const order = await seedPendingOrder(repo);

    const realUpdate = repo.updateOrderStatus.bind(repo);
    let raced = false;
    repo.updateOrderStatus = async (id, expected, target) => {
      if (!raced) {
        raced = true;
        // The webhook marks the order paid in the read→write window.
        const stored = repo.orders.find((o) => o.id === id)!;
        stored.paymentIntentId = 'pi_race';
        stored.paymentStatus = 'pending';
        await repo.markOrderPaidByPaymentIntent('pi_race');
      }
      return realUpdate(id, expected, target);
    };

    const res = await request(app)
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set('Authorization', 'Bearer token-admin')
      .send({ status: 'cancelled' });
    expect(res.status).toBe(409);
    expect(res.body.order.paymentStatus).toBe('paid');
    const stored = await repo.getOrder(order.id);
    expect(stored?.status).toBe('pending'); // NOT cancelled
    expect(stored?.paymentStatus).toBe('paid');
  });

  it('order: an uncontended transition still succeeds through the conditional write', async () => {
    const repo = new FakeRepository();
    const app = buildApp(repo);
    const order = await seedPendingOrder(repo);
    const res = await request(app)
      .patch(`/api/v1/admin/orders/${order.id}/status`)
      .set('Authorization', 'Bearer token-admin')
      .send({ status: 'confirmed' });
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('confirmed');
  });

  it('reservation: first writer wins; the stale writer gets 409 + current state', async () => {
    const repo = new FakeRepository();
    const app = buildApp(repo);
    const reservation = await repo.createReservation({
      userId: null, name: 'Seed', email: 'seed@example.com', phone: '555',
      date: '2026-12-24', time: '19:00', guests: 2,
    });

    const realUpdate = repo.updateReservationStatus.bind(repo);
    let raced = false;
    repo.updateReservationStatus = async (id, expected, target) => {
      if (!raced) {
        raced = true;
        await realUpdate(id, 'pending', 'cancelled');
      }
      return realUpdate(id, expected, target);
    };

    const res = await request(app)
      .patch(`/api/v1/admin/reservations/${reservation.id}/status`)
      .set('Authorization', 'Bearer token-admin')
      .send({ status: 'confirmed' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/changed — refresh/);
    expect(res.body.reservation.status).toBe('cancelled');
    expect((await repo.getReservation(reservation.id))?.status).toBe('cancelled');
  });
});

describe('malformed ids answer 404, never 500 (B-M2)', () => {
  it('covers the surveyed id routes with both malformed and valid-but-absent ids', async () => {
    const repo = new FakeRepository();
    const app = buildApp(repo);
    const admin = 'Bearer token-admin';

    for (const id of ['not-a-uuid', ABSENT_UUID]) {
      expect((await request(app).get(`/api/v1/orders/${id}`)).status).toBe(404);
      expect((await request(app).post('/api/v1/payments/create-intent').send({ orderId: id })).status).toBe(404);
      expect((await request(app).patch(`/api/v1/admin/orders/${id}/status`).set('Authorization', admin).send({ status: 'confirmed' })).status).toBe(404);
      expect((await request(app).patch(`/api/v1/admin/reservations/${id}/status`).set('Authorization', admin).send({ status: 'confirmed' })).status).toBe(404);
      expect((await request(app).patch(`/api/v1/admin/reviews/${id}`).set('Authorization', admin).send({ isApproved: true })).status).toBe(404);
      expect((await request(app).delete(`/api/v1/admin/reviews/${id}`).set('Authorization', admin)).status).toBe(404);
      expect((await request(app).patch(`/api/v1/admin/coupons/${id}`).set('Authorization', admin).send({ isActive: false })).status).toBe(404);
      expect((await request(app).delete(`/api/v1/admin/coupons/${id}`).set('Authorization', admin)).status).toBe(404);
      expect((await request(app).patch(`/api/v1/admin/staff/${id}/role`).set('Authorization', admin).send({ role: 'admin' })).status).toBe(404);
      expect((await request(app).patch(`/api/v1/admin/staff/${id}/role`).set('Authorization', admin).send({ role: 'customer' })).status).toBe(404);
    }
  });
});

describe('idempotency replay — order of checks + principal scoping (D-L1/D-L2)', () => {
  it('a replay returns the stored order even after the kitchen closes; a new order is still refused', async () => {
    const repo = new FakeRepository();
    const app = buildApp(repo);
    const first = await placeOrder(app, { idempotencyKey: 'replay-closed-0001' });
    expect(first.status).toBe(201);

    await repo.updateSettings({ kitchenOpen: false });

    const replay = await placeOrder(app, { idempotencyKey: 'replay-closed-0001' });
    expect(replay.status).toBe(201);
    expect(replay.body.order.id).toBe(first.body.order.id);
    expect(replay.body.order.total).toBe(first.body.order.total);
    expect(repo.orders).toHaveLength(1);

    const fresh = await placeOrder(app);
    expect(fresh.status).toBe(400);
    expect(fresh.body.error).toMatch(/kitchen is currently closed/);
    expect(repo.orders).toHaveLength(1);
  });

  it('guest replay with the same checkout email returns the full order (first-write-wins)', async () => {
    const repo = new FakeRepository();
    const app = buildApp(repo);
    const first = await placeOrder(app, { idempotencyKey: 'replay-guest-0001' });
    const replay = await placeOrder(app, {
      idempotencyKey: 'replay-guest-0001',
      customerName: 'Someone Else',
      items: [{ menuItemId: 2, quantity: 3 }],
    });
    expect(replay.status).toBe(201);
    expect(replay.body.order.id).toBe(first.body.order.id);
    expect(replay.body.order.customerName).toBe('Guest One');
    expect(replay.body.order.items).toHaveLength(1);
    expect(repo.orders).toHaveLength(1);
  });

  it('guest replay with a DIFFERENT email gets only the order id — no PII', async () => {
    const repo = new FakeRepository();
    const app = buildApp(repo);
    const first = await placeOrder(app, { idempotencyKey: 'replay-guest-0002' });
    const replay = await placeOrder(app, {
      idempotencyKey: 'replay-guest-0002',
      customerEmail: 'attacker@example.com',
    });
    expect(replay.status).toBe(201);
    expect(replay.body.alreadyCreated).toBe(true);
    expect(Object.keys(replay.body.order)).toEqual(['id']);
    expect(replay.body.order.id).toBe(first.body.order.id);
    expect(JSON.stringify(replay.body)).not.toContain('Guest One');
    expect(repo.orders).toHaveLength(1);
  });

  it('account replay is scoped to the owning account', async () => {
    const repo = new FakeRepository();
    const app = buildApp(repo);
    const first = await placeOrder(app, { idempotencyKey: 'replay-acct-0001' }, 'token-user');
    expect(first.status).toBe(201);
    expect(first.body.order.userId).toBe('user-1');

    // Same account retrying (e.g. after a timeout) gets the full order.
    const ownRetry = await placeOrder(app, { idempotencyKey: 'replay-acct-0001' }, 'token-user');
    expect(ownRetry.status).toBe(201);
    expect(ownRetry.body.order.id).toBe(first.body.order.id);
    expect(ownRetry.body.order.customerEmail).toBe('guest@example.com');

    // A different account presenting the key learns only the id.
    const otherRetry = await placeOrder(app, { idempotencyKey: 'replay-acct-0001' }, 'token-user2');
    expect(otherRetry.status).toBe(201);
    expect(otherRetry.body.alreadyCreated).toBe(true);
    expect(Object.keys(otherRetry.body.order)).toEqual(['id']);

    // And a signed-out presenter gets the same minimal answer.
    const anonRetry = await placeOrder(app, { idempotencyKey: 'replay-acct-0001' });
    expect(anonRetry.body.alreadyCreated).toBe(true);
    expect(Object.keys(anonRetry.body.order)).toEqual(['id']);
    expect(repo.orders).toHaveLength(1);
  });
});

describe('coupon-validate throttle (C-L1)', () => {
  it('answers 429 once the per-IP budget is spent', async () => {
    const repo = new FakeRepository();
    const app = buildApp(repo, { couponRateLimitMax: 3 });
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/api/v1/coupons/validate').send({ code: 'WELCOME10' });
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
    }
    const blocked = await request(app).post('/api/v1/coupons/validate').send({ code: 'WELCOME10' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatch(/coupon checks/);
  });
});

describe('webhook with duplicate payment_intent rows (D-L7)', () => {
  it('paid and failed events resolve the first matching order without wedging', async () => {
    const repo = new FakeRepository();
    const stripe = new FakeStripeService();
    const app = createApp({
      env: testEnv(), repo, verifyToken: fakeVerifyToken, stripe, chat: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const a = await seedPendingOrder(repo);
    const b = await seedPendingOrder(repo);
    for (const o of [a, b]) {
      o.paymentIntentId = 'pi_shared';
      o.paymentStatus = 'pending';
    }
    const paid = await request(app)
      .post('/api/v1/payments/webhook')
      .set('stripe-signature', 'valid-sig')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'payment_intent.succeeded', paymentIntentId: 'pi_shared' }));
    expect(paid.status).toBe(200);
    expect((await repo.getOrder(a.id))?.paymentStatus).toBe('paid');
    expect((await repo.getOrder(b.id))?.paymentStatus).toBe('pending');

    const c = await seedPendingOrder(repo);
    const d = await seedPendingOrder(repo);
    for (const o of [c, d]) {
      o.paymentIntentId = 'pi_shared_f';
      o.paymentStatus = 'pending';
    }
    const failed = await request(app)
      .post('/api/v1/payments/webhook')
      .set('stripe-signature', 'valid-sig')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'payment_intent.payment_failed', paymentIntentId: 'pi_shared_f' }));
    expect(failed.status).toBe(200);
    expect((await repo.getOrder(c.id))?.paymentStatus).toBe('failed');
    expect((await repo.getOrder(d.id))?.paymentStatus).toBe('pending');
  });
});

describe('settings clear-field rule + copy isolation (fix 8)', () => {
  it("blank phone/email/address/whatsapp clear to null; non-empty values are validated", async () => {
    const repo = new FakeRepository();
    const app = buildApp(repo);
    const admin = 'Bearer token-admin';

    const setRes = await request(app).patch('/api/v1/admin/settings').set('Authorization', admin)
      .send({ phone: '555-0100', email: 'hello@ember.example', address: '1 Main St', whatsappNumber: '+1 (555) 010-2233' });
    expect(setRes.status).toBe(200);
    expect(setRes.body.settings.phone).toBe('555-0100');
    expect(setRes.body.settings.whatsappNumber).toBe('+1 (555) 010-2233');

    const cleared = await request(app).patch('/api/v1/admin/settings').set('Authorization', admin)
      .send({ phone: '', email: '   ', address: '', whatsappNumber: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.settings.phone).toBeNull();
    expect(cleared.body.settings.email).toBeNull();
    expect(cleared.body.settings.address).toBeNull();
    expect(cleared.body.settings.whatsappNumber).toBeNull();

    const badEmail = await request(app).patch('/api/v1/admin/settings').set('Authorization', admin)
      .send({ email: 'not-an-email' });
    expect(badEmail.status).toBe(400);
    const badWhatsapp = await request(app).patch('/api/v1/admin/settings').set('Authorization', admin)
      .send({ whatsappNumber: '123' });
    expect(badWhatsapp.status).toBe(400);
  });

  it('getSettings hands out isolated copies (fake mirrors the real repository)', async () => {
    const repo = new FakeRepository();
    const first = await repo.getSettings();
    first.restaurantName = 'Mutated';
    first.openingHours.weekdays = 'mutated';
    first.siteLocations.footer.phone = 'mutated';
    const second = await repo.getSettings();
    expect(second.restaurantName).toBe('Ember & Co.');
    expect(second.openingHours).toEqual({});
    expect(second.siteLocations.footer.phone).toBeNull();
  });

  it('openingHours patches are normalized to string entries', async () => {
    const repo = new FakeRepository();
    const app = buildApp(repo);
    const res = await request(app).patch('/api/v1/admin/settings').set('Authorization', 'Bearer token-admin')
      .send({ openingHours: { weekdays: ' 11:00 – 22:00 ', weekends: 42, blank: ' ' } });
    expect(res.status).toBe(200);
    expect(res.body.settings.openingHours).toEqual({ weekdays: '11:00 – 22:00' });
  });
});

describe('favorites read is one batched lookup (fix 8)', () => {
  it('preserves favorites order, skips missing/unavailable, and never resolves ids one by one', async () => {
    const repo = new FakeRepository();
    const app = buildApp(repo);
    const profile = repo.profiles.get('user-1')!;
    profile.favorites = [2, 999, 1, 3]; // 999 missing, 3 unavailable

    let singleLookups = 0;
    const realSingle = repo.getMenuItem.bind(repo);
    repo.getMenuItem = async (id: number) => { singleLookups++; return realSingle(id); };
    let batchCalls = 0;
    const realBatch = repo.getMenuItemsByIds.bind(repo);
    repo.getMenuItemsByIds = async (ids: number[]) => { batchCalls++; return realBatch(ids); };

    const res = await request(app).get('/api/v1/account/favorites').set('Authorization', 'Bearer token-user');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: number }) => i.id)).toEqual([2, 1]);
    expect(batchCalls).toBe(1);
    expect(singleLookups).toBe(0);
  });
});

// ─── Fix 10 (audit-2, H-5): two route behaviours the fix-8 auditor
// noted as implemented-but-unpinned. Same fake suite, same idioms.

describe('idempotency replay — guest email casing (fix 10 pin)', () => {
  it('a guest replay with a DIFFERENTLY-CASED email still returns the full order', async () => {
    const repo = new FakeRepository();
    const app = buildApp(repo);
    const first = await placeOrder(app, {
      idempotencyKey: 'replay-case-0001',
      customerEmail: 'Guest@Example.COM',
    });
    expect(first.status).toBe(201);

    // Email identity is case-insensitive: the mailbox is the same
    // principal, so the replay is answered with the FULL order —
    // not the redacted { id } stub a stranger gets.
    const replay = await placeOrder(app, {
      idempotencyKey: 'replay-case-0001',
      customerEmail: 'guest@example.com',
      customerName: 'Someone Else',
      items: [{ menuItemId: 2, quantity: 3 }],
    });
    expect(replay.status).toBe(201);
    expect(replay.body.alreadyCreated).toBeUndefined();
    expect(replay.body.order.id).toBe(first.body.order.id);
    expect(replay.body.order.customerName).toBe('Guest One');
    expect(replay.body.order.customerEmail).toBe('Guest@Example.COM'); // the stored first-write wins
    expect(replay.body.order.items).toHaveLength(1);
    expect(repo.orders).toHaveLength(1);
  });
});

describe('favorites read — duplicate ids (fix 10 pin)', () => {
  it('GET /favorites preserves duplicate ids, in order', async () => {
    const repo = new FakeRepository();
    const app = buildApp(repo);
    const profile = repo.profiles.get('user-1')!;
    // A duplicated favorite can exist in the stored list (the toggle
    // endpoint dedupes on write, but stored data is only ever read
    // back through this batch lookup) — the read must mirror the
    // stored list faithfully, duplicates included, not silently
    // dedupe or reorder it.
    profile.favorites = [2, 1, 2];
    const res = await request(app).get('/api/v1/account/favorites').set('Authorization', 'Bearer token-user');
    expect(res.status).toBe(200);
    expect(res.body.items.map((i: { id: number }) => i.id)).toEqual([2, 1, 2]);
  });
});
