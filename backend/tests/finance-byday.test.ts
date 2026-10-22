import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import type { OrderDTO } from '../src/repositories/types';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';
import { FakeStripeService } from './fakeStripe';
import { FakeStorageService } from './fakeStorage';

// Audit Fix 16 — finance byDay continuity. The daily series must be a
// continuous calendar window (30 days ending at the most recent paid
// order's day) with zero-filled gaps, not just the days that had sales.

const as = (r: request.Test, token: string) => r.set('Authorization', `Bearer ${token}`);
const ADMIN = 'token-admin';

let seq = 0;
function makeOrder(patch: Partial<OrderDTO> = {}): OrderDTO {
  const n = ++seq;
  return {
    id: `fin-order-${n}`, userId: 'user-1', customerName: 'Seed Customer',
    customerEmail: 'seed@example.com', customerPhone: null, status: 'delivered',
    paymentStatus: 'paid', paymentIntentId: null, currency: 'USD',
    subtotal: 10, deliveryFee: 0, discount: 0, total: 10, couponCode: null,
    address: null, notes: null, items: [],
    createdAt: '2026-03-30T12:00:00.000Z', updatedAt: '2026-03-30T12:00:00.000Z', ...patch,
  };
}

function setup() {
  const repo = new FakeRepository();
  const app = createApp({
    env: testEnv(), repo, verifyToken: fakeVerifyToken,
    stripe: new FakeStripeService(), storage: new FakeStorageService(),
  });
  return { repo, app };
}

describe('GET /api/v1/admin/finance byDay continuity', () => {
  it('zero-fills the days between the first and last day of the window', async () => {
    const { repo, app } = setup();
    // Paid orders ONLY on the window's last day (Mar 30) and first day
    // (Mar 1) — plus noise that must NOT fill or extend the series: an
    // unpaid order mid-window and a paid order in another currency.
    repo.orders.push(makeOrder({ total: 20, createdAt: '2026-03-30T09:15:00.000Z' }));
    repo.orders.push(makeOrder({ total: 10, createdAt: '2026-03-01T18:45:00.000Z' }));
    repo.orders.push(makeOrder({ total: 99, paymentStatus: 'unpaid', createdAt: '2026-03-15T10:00:00.000Z' }));
    repo.orders.push(makeOrder({ total: 77, currency: 'PKR', createdAt: '2026-03-15T10:00:00.000Z' }));

    const res = await as(request(app).get('/api/v1/admin/finance'), ADMIN);
    expect(res.status).toBe(200);
    // Totals cover the paid USD orders only, exactly as before.
    expect(res.body.totalPaidOrders).toBe(2);
    expect(res.body.totalRevenue).toBe(30);

    const byDay = res.body.byDay as { date: string; revenue: number; orders: number }[];
    expect(byDay).toHaveLength(30);
    // Newest first, ending at the most recent paid order's day.
    expect(byDay[0]).toEqual({ date: '2026-03-30', revenue: 20, orders: 1 });
    expect(byDay[29]).toEqual({ date: '2026-03-01', revenue: 10, orders: 1 });
    // Every day in between is present, in order, with zeros — including
    // Mar 15, whose only orders were unpaid / foreign-currency.
    for (let i = 1; i < 29; i += 1) {
      expect(byDay[i].revenue).toBe(0);
      expect(byDay[i].orders).toBe(0);
      expect(byDay[i].date < byDay[i - 1].date).toBe(true);
    }
    expect(byDay.find((d) => d.date === '2026-03-15')).toEqual({ date: '2026-03-15', revenue: 0, orders: 0 });
  });

  it('keeps an empty byDay when there are no paid orders', async () => {
    const { app } = setup();
    const res = await as(request(app).get('/api/v1/admin/finance'), ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.totalPaidOrders).toBe(0);
    expect(res.body.byDay).toEqual([]);
  });
});
