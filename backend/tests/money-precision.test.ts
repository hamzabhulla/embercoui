import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';
import { FakeStripeService } from './fakeStripe';

// Audit-2 Fix 5 — money storage precision. Migration 0011 widens every
// money column from numeric(10, 2) to numeric(12, 3); the SQL cannot run
// in this suite, so these tests pin the half that CAN break in code:
// no path between the admin's price entry and the customer's receipt
// may round a 3-decimal currency to 2dp. The scenario runs entirely in
// KWD (ISO exponent 3) against the fake repository, which stores JS
// numbers at full precision — it stands in for the post-0011 column.
// (Pre-0011, a real Postgres rounds these values at storage; that is
// precisely why the owner must run the migration — see BUILD_LOG.)

const repo = new FakeRepository();
const stripe = new FakeStripeService();
const app = createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken, stripe });
const as = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);

let dishId = 0;
let percentOrderId = '';

describe('KWD (3-decimal currency) money precision', () => {
  it('switches the shop currency to KWD', async () => {
    const res = await as(request(app).patch('/api/v1/admin/settings').send({ currency: 'KWD' }), 'token-admin');
    expect(res.status).toBe(200);
    expect(res.body.settings.currency).toBe('KWD');
  });

  it('stores and serves a 1.005 menu price unrounded', async () => {
    const created = await as(request(app).post('/api/v1/admin/menu').send({
      name: 'Fils Dish', description: 'Priced to the fils', price: 1.005, image: 'x', category: 'Burgers', tags: [], isAvailable: true, sortOrder: 9,
    }), 'token-admin');
    expect(created.status).toBe(201);
    expect(created.body.item.price).toBe(1.005);
    dishId = created.body.item.id as number;

    const menu = await request(app).get('/api/v1/menu');
    const served = (menu.body.items as { id: number; price: number }[]).find((i) => i.id === dishId);
    expect(served?.price).toBe(1.005);
  });

  it('keeps exact 3-decimal totals through order create → read (percent coupon)', async () => {
    await as(request(app).post('/api/v1/admin/coupons').send({ code: 'FILS10', type: 'percent', value: 10 }), 'token-admin');
    const res = await request(app).post('/api/v1/orders').send({
      customerName: 'Khalid Guest', customerEmail: 'khalid@example.com',
      address: { line1: '1 Palm Street', city: 'Kuwait City' },
      items: [{ menuItemId: dishId, quantity: 3 }],
      couponCode: 'FILS10',
    });
    expect(res.status).toBe(201);
    // Minor-unit math at exponent 3: 3 × 1005 = 3015 fils; 10% of 3015
    // fils rounds (at the fils, not the cent) to 302; total 2713 fils.
    // A single 2dp round anywhere in the chain breaks every assertion.
    expect(res.body.order.currency).toBe('KWD');
    expect(res.body.order.items[0].unitPrice).toBe(1.005);
    expect(res.body.order.subtotal).toBe(3.015);
    expect(res.body.order.discount).toBe(0.302);
    expect(res.body.order.total).toBe(2.713);
    percentOrderId = res.body.order.id as string;

    const stored = repo.orders.find((o) => o.id === percentOrderId);
    expect(stored?.subtotal).toBe(3.015);
    expect(stored?.discount).toBe(0.302);
    expect(stored?.total).toBe(2.713);

    const reread = await request(app).get(`/api/v1/orders/${percentOrderId}`);
    expect(reread.status).toBe(200);
    expect(reread.body.order.subtotal).toBe(3.015);
    expect(reread.body.order.discount).toBe(0.302);
    expect(reread.body.order.total).toBe(2.713);
    expect(reread.body.order.items[0].unitPrice).toBe(1.005);
  });

  it('treats a fixed coupon value as 3-decimal money too', async () => {
    await as(request(app).post('/api/v1/admin/coupons').send({ code: 'HALFKWD', type: 'fixed', value: 0.5 }), 'token-admin');
    const res = await request(app).post('/api/v1/orders').send({
      customerName: 'Khalid Guest', customerEmail: 'khalid@example.com',
      address: { line1: '1 Palm Street', city: 'Kuwait City' },
      items: [{ menuItemId: dishId, quantity: 1 }],
      couponCode: 'HALFKWD',
    });
    expect(res.status).toBe(201);
    expect(res.body.order.subtotal).toBe(1.005);
    expect(res.body.order.discount).toBe(0.5);
    expect(res.body.order.total).toBe(0.505);
  });

  it('aggregates lifetime spend at 3dp, mirroring the real repository', async () => {
    const res = await as(request(app).post('/api/v1/orders').send({
      customerName: 'Test User', customerEmail: 'user@example.com',
      address: { line1: '2 Palm Street', city: 'Kuwait City' },
      items: [{ menuItemId: dishId, quantity: 1 }],
    }), 'token-user');
    expect(res.status).toBe(201);
    expect(res.body.order.total).toBe(1.005);
    // Mark the stored order paid directly in the fake (the webhook path
    // that normally does this is covered by the payments suite).
    const stored = repo.orders.find((o) => o.id === res.body.order.id);
    expect(stored).toBeDefined();
    stored!.paymentStatus = 'paid';

    const customers = await as(request(app).get('/api/v1/admin/customers'), 'token-admin');
    expect(customers.status).toBe(200);
    const user1 = (customers.body.customers as { id: string; orderCount: number; totalSpent: number }[])
      .find((c) => c.id === 'user-1');
    expect(user1?.orderCount).toBe(1);
    // The fake previously rounded this aggregate with a hardcoded
    // * 100 / 100 (2dp) where the real repository rounds at the
    // currency exponent — 1.005 came back as 1 (or 1.01). Exact 3dp now.
    expect(user1?.totalSpent).toBe(1.005);
  });
});
