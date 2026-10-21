import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';

// Production audit Fix 7 — abuse & validation hardening on order creation.
// This file gets its own app + repository so its request volume never eats
// the per-IP order budget of the other suites (each file runs a fresh app).
const repo = new FakeRepository();
const app = createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken });

const checkoutBody = {
  customerName: 'Jane Guest', customerEmail: 'jane@example.com',
  address: { line1: '1 Forest Way', city: 'Portland' },
  items: [
    { menuItemId: 1, quantity: 2 },
    { menuItemId: 2, quantity: 1 },
  ],
};
const postOrder = (body: Record<string, unknown>) => request(app).post('/api/v1/orders').send(body);
const lines = (n: number) => Array.from({ length: n }, () => ({ menuItemId: 1, quantity: 1 }));

describe('POST /orders — item and field caps', () => {
  it('rejects an order with more than 50 item lines', async () => {
    const res = await postOrder({ ...checkoutBody, items: lines(51) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Too many items in one order');
    expect(repo.orders).toHaveLength(0);
  });

  it('accepts an order with exactly 50 item lines', async () => {
    const res = await postOrder({ ...checkoutBody, items: lines(50) });
    expect(res.status).toBe(201);
    expect(res.body.order.items).toHaveLength(50);
    expect(res.body.order.total).toBe(50 * 24);
  });

  it('rejects a customer name over 120 characters', async () => {
    const res = await postOrder({ ...checkoutBody, customerName: 'x'.repeat(121) });
    expect(res.status).toBe(400);
    const ok = await postOrder({ ...checkoutBody, customerName: 'x'.repeat(120) });
    expect(ok.status).toBe(201);
  });
});

describe('POST /orders — kitchen open enforcement', () => {
  it('refuses orders while the kitchen is closed and stores nothing', async () => {
    await repo.updateSettings({ kitchenOpen: false });
    const before = repo.orders.length;
    const res = await postOrder(checkoutBody);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('The kitchen is currently closed — ordering will reopen soon');
    expect(repo.orders).toHaveLength(before);
  });

  it('accepts orders again once the kitchen reopens', async () => {
    await repo.updateSettings({ kitchenOpen: true });
    const res = await postOrder(checkoutBody);
    expect(res.status).toBe(201);
  });
});

describe('POST /orders — rate limit', () => {
  it('allows 30 orders per IP in 15 minutes and refuses the 31st', async () => {
    // A fresh app in production mode: createApp relaxes the order budget
    // under NODE_ENV=test (shared suites fire orders by the dozen), so this
    // test opts back into the real production budget — and, like the chat
    // limiter test, starts from a zero counter.
    const fresh = createApp({ env: testEnv({ nodeEnv: 'production' }), repo: new FakeRepository(), verifyToken: fakeVerifyToken });
    let last = 0;
    for (let i = 0; i < 31; i += 1) {
      last = (await request(fresh).post('/api/v1/orders').send(checkoutBody)).status;
    }
    expect(last).toBe(429);
  });
});

describe('malformed JSON bodies', () => {
  it('answers 400 (not 500) for a body that is not valid JSON', async () => {
    const res = await request(app)
      .post('/api/v1/orders')
      .set('Content-Type', 'application/json')
      .send('{"customerName": "Jane", ');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid JSON body');
  });
});
