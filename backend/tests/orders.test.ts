import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';
import { FakeStripeService } from './fakeStripe';

const repo = new FakeRepository();
const stripe = new FakeStripeService();
const app = createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken, stripe });
const noStripe = createApp({ env: testEnv({ stripeConfigured: false, stripeSecretKey: null }), repo, verifyToken: fakeVerifyToken, stripe: null });

const checkoutBody = {
  customerName: 'Jane Guest', customerEmail: 'jane@example.com',
  address: { line1: '1 Forest Way', city: 'Portland' },
  items: [
    { menuItemId: 1, quantity: 2 },
    { menuItemId: 2, quantity: 1 },
  ],
};

async function createOrder(extra: Record<string, unknown> = {}, token?: string) {
  let req = request(app).post('/api/v1/orders').send({ ...checkoutBody, ...extra });
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  return req;
}

describe('POST /orders — server-side pricing', () => {
  it('recalculates totals from the database, ignoring client claims', async () => {
    const res = await createOrder({ subtotal: 0.01, total: 0.01, items: checkoutBody.items.map((i) => ({ ...i, price: 0.01 })) });
    expect(res.status).toBe(201);
    // 2 × $24 + 1 × $38 from the fake menu — never the client's numbers.
    expect(res.body.order.subtotal).toBe(86);
    expect(res.body.order.total).toBe(86);
    expect(res.body.order.deliveryFee).toBe(0);
    expect(res.body.order.paymentStatus).toBe('unpaid');
    expect(res.body.order.items).toHaveLength(2);
    expect(res.body.order.items[0]).toMatchObject({ name: 'Ember Classic', unitPrice: 24, quantity: 2 });
  });
  it('rejects unavailable items', async () => {
    const res = await createOrder({ items: [{ menuItemId: 3, quantity: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no longer available/);
  });
  it('rejects an empty cart', async () => {
    const res = await createOrder({ items: [] });
    expect(res.status).toBe(400);
  });
  it('applies a valid percent coupon', async () => {
    const res = await createOrder({ couponCode: 'welcome10' });
    expect(res.status).toBe(201);
    expect(res.body.order.discount).toBe(8.6);
    expect(res.body.order.total).toBe(77.4);
    expect(res.body.order.couponCode).toBe('WELCOME10');
  });
  it('rejects expired coupons', async () => {
    const res = await createOrder({ couponCode: 'OLD50' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('This coupon code is not valid');
  });
  it('attaches the account when signed in', async () => {
    const res = await createOrder({}, 'token-user');
    expect(res.status).toBe(201);
    expect(res.body.order.userId).toBe('user-1');
  });
});

describe('POST /orders — idempotency (migration 0006)', () => {
  it('returns the original order for a repeated key — exactly one order is stored', async () => {
    const before = repo.orders.length;
    const first = await createOrder({ idempotencyKey: 'checkout-attempt-0001' });
    const retry = await createOrder({ idempotencyKey: 'checkout-attempt-0001' });
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.order.id).toBe(first.body.order.id);
    expect(repo.orders.length).toBe(before + 1);
    // The returned order is complete — items included, totals intact.
    expect(retry.body.order.items).toHaveLength(2);
    expect(retry.body.order.total).toBe(86);
    // The key itself is internal — never exposed on the order DTO.
    expect(retry.body.order).not.toHaveProperty('idempotencyKey');
    expect(retry.body.order).not.toHaveProperty('idempotency_key');
  });

  it('creates separate orders for different keys', async () => {
    const before = repo.orders.length;
    const a = await createOrder({ idempotencyKey: 'checkout-attempt-0002' });
    const b = await createOrder({ idempotencyKey: 'checkout-attempt-0003' });
    expect(a.body.order.id).not.toBe(b.body.order.id);
    expect(repo.orders.length).toBe(before + 2);
  });

  it('behaves as before when no key is sent (every submit creates an order)', async () => {
    const before = repo.orders.length;
    const a = await createOrder();
    const b = await createOrder();
    expect(a.body.order.id).not.toBe(b.body.order.id);
    expect(repo.orders.length).toBe(before + 2);
  });

  it('first write wins: a key reused with DIFFERENT cart contents still returns the original order', async () => {
    const before = repo.orders.length;
    const first = await createOrder({ idempotencyKey: 'checkout-attempt-0004' });
    const retry = await createOrder({
      idempotencyKey: 'checkout-attempt-0004',
      items: [{ menuItemId: 2, quantity: 5 }],
    });
    expect(retry.status).toBe(201);
    expect(retry.body.order.id).toBe(first.body.order.id);
    expect(retry.body.order.total).toBe(first.body.order.total);
    expect(retry.body.order.items).toEqual(first.body.order.items);
    expect(repo.orders.length).toBe(before + 1);
  });

  it('rejects keys outside the sane length bounds', async () => {
    expect((await createOrder({ idempotencyKey: 'short' })).status).toBe(400);
    expect((await createOrder({ idempotencyKey: 'x'.repeat(81) })).status).toBe(400);
    expect((await createOrder({ idempotencyKey: 'x'.repeat(80) })).status).toBe(201);
  });
});

describe('GET /orders/:id privacy', () => {
  it('tracks guest orders by id', async () => {
    const created = await createOrder();
    const res = await request(app).get(`/api/v1/orders/${created.body.order.id}`);
    expect(res.status).toBe(200);
  });
  it('hides account orders from other customers (404) but not staff/admin/owner', async () => {
    const created = await createOrder({}, 'token-user');
    const id = created.body.order.id as string;
    expect((await request(app).get(`/api/v1/orders/${id}`).set('Authorization', 'Bearer token-user')).status).toBe(200);
    expect((await request(app).get(`/api/v1/orders/${id}`).set('Authorization', 'Bearer token-user2')).status).toBe(404);
    expect((await request(app).get(`/api/v1/orders/${id}`)).status).toBe(404);
    expect((await request(app).get(`/api/v1/orders/${id}`).set('Authorization', 'Bearer token-staff')).status).toBe(200);
    expect((await request(app).get(`/api/v1/orders/${id}`).set('Authorization', 'Bearer token-admin')).status).toBe(200);
  });
  it('404s unknown orders', async () => {
    expect((await request(app).get('/api/v1/orders/nope')).status).toBe(404);
  });
});

describe('payments', () => {
  it('creates an intent for the server-computed total', async () => {
    const created = await createOrder();
    const res = await request(app).post('/api/v1/payments/create-intent').send({ orderId: created.body.order.id });
    expect(res.status).toBe(200);
    expect(res.body.clientSecret).toContain('_secret_test');
    const intent = stripe.intents.get(res.body.paymentIntentId);
    expect(intent?.amountCents).toBe(8600);
    const order = await repo.getOrder(created.body.order.id);
    expect(order?.paymentStatus).toBe('pending');
  });
  it('503s when Stripe is not configured', async () => {
    const created = await request(noStripe).post('/api/v1/orders').send(checkoutBody);
    const res = await request(noStripe).post('/api/v1/payments/create-intent').send({ orderId: created.body.order.id });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Payments are not configured');
  });
  it('marks paid ONLY via a correctly-signed webhook', async () => {
    const created = await createOrder();
    const orderId = created.body.order.id as string;
    const intentRes = await request(app).post('/api/v1/payments/create-intent').send({ orderId });
    const paymentIntentId = intentRes.body.paymentIntentId as string;

    // Bad signature → 400, order untouched.
    const bad = await request(app)
      .post('/api/v1/payments/webhook')
      .set('stripe-signature', 'forged')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'payment_intent.succeeded', paymentIntentId }));
    expect(bad.status).toBe(400);
    expect((await repo.getOrder(orderId))?.paymentStatus).toBe('pending');

    // Good signature → paid.
    const good = await request(app)
      .post('/api/v1/payments/webhook')
      .set('stripe-signature', 'valid-sig')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'payment_intent.succeeded', paymentIntentId }));
    expect(good.status).toBe(200);
    expect((await repo.getOrder(orderId))?.paymentStatus).toBe('paid');

    // A second intent for a paid order is refused.
    const again = await request(app).post('/api/v1/payments/create-intent').send({ orderId });
    expect(again.status).toBe(400);
  });
  it('marks failed payments via webhook and still acks unknown intents', async () => {
    const created = await createOrder();
    const orderId = created.body.order.id as string;
    const intentRes = await request(app).post('/api/v1/payments/create-intent').send({ orderId });
    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('stripe-signature', 'valid-sig')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'payment_intent.payment_failed', paymentIntentId: intentRes.body.paymentIntentId }));
    expect(res.status).toBe(200);
    expect((await repo.getOrder(orderId))?.paymentStatus).toBe('failed');

    const unknown = await request(app)
      .post('/api/v1/payments/webhook')
      .set('stripe-signature', 'valid-sig')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'payment_intent.succeeded', paymentIntentId: 'pi_unknown' }));
    expect(unknown.status).toBe(200);
    expect(unknown.body).toEqual({ received: true });
  });
});

describe('POST /coupons/validate', () => {
  it('validates active coupons and hides invalid ones', async () => {
    const ok = await request(app).post('/api/v1/coupons/validate').send({ code: 'WELCOME10' });
    expect(ok.body).toEqual({ valid: true, coupon: { code: 'WELCOME10', type: 'percent', value: 10 } });
    const bad = await request(app).post('/api/v1/coupons/validate').send({ code: 'OLD50' });
    expect(bad.body).toEqual({ valid: false });
  });
});

describe('phase 3 audit additions', () => {
  it('rejects out-of-range quantities', async () => {
    for (const quantity of [0, 51, 1.5, -1]) {
      const res = await createOrder({ items: [{ menuItemId: 1, quantity }] });
      expect(res.status).toBe(400);
    }
    const ok = await createOrder({ items: [{ menuItemId: 1, quantity: 50 }] });
    expect(ok.status).toBe(201);
    expect(ok.body.order.total).toBe(1200);
  });
  it('applies fixed coupons and rejects inactive ones', async () => {
    const fixed = await createOrder({ couponCode: 'FIXED5' });
    expect(fixed.status).toBe(201);
    expect(fixed.body.order.discount).toBe(5);
    expect(fixed.body.order.total).toBe(81);
    const inactive = await createOrder({ couponCode: 'DISABLED20' });
    expect(inactive.status).toBe(400);
  });
  it('charges the discounted total to the card', async () => {
    const created = await createOrder({ couponCode: 'WELCOME10' });
    const res = await request(app).post('/api/v1/payments/create-intent').send({ orderId: created.body.order.id });
    expect(res.status).toBe(200);
    expect(stripe.intents.get(res.body.paymentIntentId)?.amountCents).toBe(7740);
  });
  it('404s intents for unknown orders', async () => {
    const res = await request(app).post('/api/v1/payments/create-intent').send({ orderId: 'order-nope' });
    expect(res.status).toBe(404);
  });
  it('400s webhooks without a signature header', async () => {
    const res = await request(app)
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ type: 'payment_intent.succeeded', paymentIntentId: 'pi_1' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing Stripe signature');
  });
  it('refuses card payment for totals under the Stripe minimum', async () => {
    const created = await createOrder({ items: [{ menuItemId: 1, quantity: 1 }], couponCode: 'ALMOSTFREE' });
    expect(created.status).toBe(201);
    expect(created.body.order.total).toBe(0);
    const res = await request(app).post('/api/v1/payments/create-intent').send({ orderId: created.body.order.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/below the card payment minimum/);
  });

});
