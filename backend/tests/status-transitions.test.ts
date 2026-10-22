import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';
import { FakeStripeService } from './fakeStripe';
import { FakeStorageService } from './fakeStorage';

/**
 * Production audit Fix 8 (M4): order + reservation status changes are
 * state-machine checked on the server. Legal moves walk forward (or to
 * cancelled before the point of no return); terminal states are final;
 * same-status is an allowed no-op; a PAID order can never be cancelled
 * silently (no refund path exists). Seeding below drives the fake repo
 * directly — enforcement lives in the admin routes, so every assertion
 * here goes through HTTP.
 */
const repo = new FakeRepository();
const app = createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken, stripe: new FakeStripeService(), storage: new FakeStorageService() });
const as = (r: request.Test, token = 'token-admin') => r.set('Authorization', ['Bearer', token].join(' '));
const patchOrder = (id: string, status: string) => as(request(app).patch(`/api/v1/admin/orders/${id}/status`).send({ status }));
const patchReservation = (id: string, status: string) => as(request(app).patch(`/api/v1/admin/reservations/${id}/status`).send({ status }));

let seq = 0;
async function makeOrder() {
  seq += 1;
  return repo.createOrder({
    userId: null, customerName: `Walker ${seq}`, customerEmail: `walker${seq}@example.com`, customerPhone: null,
    address: null, notes: null, couponCode: null, currency: 'USD',
    items: [{ menuItemId: 1, name: 'Ember Classic', unitPrice: 24, quantity: 1 }],
    subtotal: 24, deliveryFee: 0, discount: 0, total: 24,
  });
}
async function makeReservation() {
  seq += 1;
  return repo.createReservation({
    userId: null, name: `Guest ${seq}`, email: `guest${seq}@example.com`, phone: '1234567',
    date: '2026-12-24', time: '19:00', guests: 2,
  });
}

describe('order status transitions (Fix 8)', () => {
  it('walks the full legal chain end-to-end', async () => {
    const order = await makeOrder();
    for (const status of ['confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered']) {
      const res = await patchOrder(order.id, status);
      expect(res.status).toBe(200);
      expect(res.body.order.status).toBe(status);
    }
    expect((await repo.getOrder(order.id))?.status).toBe('delivered');
    // Terminal, but a same-status re-send is an allowed no-op.
    const noop = await patchOrder(order.id, 'delivered');
    expect(noop.status).toBe(200);
  });

  it('rejects delivered → pending and leaves state unchanged', async () => {
    const order = await makeOrder();
    await repo.updateOrderStatus(order.id, 'pending', 'delivered');
    const res = await patchOrder(order.id, 'pending');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Cannot move an order');
    expect((await repo.getOrder(order.id))?.status).toBe('delivered');
  });

  it('rejects cancelled → delivered (cancelled is terminal)', async () => {
    const order = await makeOrder();
    expect((await patchOrder(order.id, 'cancelled')).status).toBe(200);
    const res = await patchOrder(order.id, 'delivered');
    expect(res.status).toBe(400);
    expect((await repo.getOrder(order.id))?.status).toBe('cancelled');
  });

  it('rejects out_for_delivery → cancelled (already with the courier)', async () => {
    const order = await makeOrder();
    await repo.updateOrderStatus(order.id, 'pending', 'out_for_delivery');
    const res = await patchOrder(order.id, 'cancelled');
    expect(res.status).toBe(400);
    expect((await repo.getOrder(order.id))?.status).toBe('out_for_delivery');
  });

  it('rejects skipping steps (pending → preparing)', async () => {
    const order = await makeOrder();
    const res = await patchOrder(order.id, 'preparing');
    expect(res.status).toBe(400);
    expect((await repo.getOrder(order.id))?.status).toBe('pending');
  });

  it('allows a same-status no-op mid-chain', async () => {
    const order = await makeOrder();
    await repo.updateOrderStatus(order.id, 'pending', 'confirmed');
    const res = await patchOrder(order.id, 'confirmed');
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('confirmed');
  });

  it('refuses to cancel a PAID order (refund first), state unchanged', async () => {
    const order = await makeOrder();
    await repo.setOrderPaymentIntent(order.id, `pi_paid_${order.id}`);
    await repo.markOrderPaidByPaymentIntent(`pi_paid_${order.id}`);
    const res = await patchOrder(order.id, 'cancelled');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/refund/i);
    expect((await repo.getOrder(order.id))?.status).toBe('pending');
    // …but the paid order can still move FORWARD normally.
    expect((await patchOrder(order.id, 'confirmed')).status).toBe(200);
  });

  it('allows cancelling an unpaid order and a payment-pending order', async () => {
    const unpaid = await makeOrder();
    expect((await patchOrder(unpaid.id, 'cancelled')).status).toBe(200);

    const pendingPayment = await makeOrder();
    await repo.setOrderPaymentIntent(pendingPayment.id, `pi_pend_${pendingPayment.id}`);
    expect((await repo.getOrder(pendingPayment.id))?.paymentStatus).toBe('pending');
    expect((await patchOrder(pendingPayment.id, 'cancelled')).status).toBe(200);
  });
});

describe('reservation status transitions (Fix 8)', () => {
  it('walks pending → confirmed → completed, then locks', async () => {
    const r = await makeReservation();
    expect((await patchReservation(r.id, 'confirmed')).status).toBe(200);
    const done = await patchReservation(r.id, 'completed');
    expect(done.status).toBe(200);
    expect(done.body.reservation.status).toBe('completed');
    const back = await patchReservation(r.id, 'pending');
    expect(back.status).toBe(400);
    expect(back.body.error).toContain('Cannot move a reservation');
    // Same-status no-op still allowed on the terminal state.
    expect((await patchReservation(r.id, 'completed')).status).toBe(200);
  });

  it('rejects cancelled → confirmed and pending → completed (skip)', async () => {
    const r = await makeReservation();
    expect((await patchReservation(r.id, 'completed')).status).toBe(400);
    expect((await patchReservation(r.id, 'cancelled')).status).toBe(200);
    const res = await patchReservation(r.id, 'confirmed');
    expect(res.status).toBe(400);
    const stored = (await repo.adminListReservations()).find((x) => x.id === r.id);
    expect(stored?.status).toBe('cancelled');
  });

  it('allows confirmed → cancelled and same-status no-ops', async () => {
    const r = await makeReservation();
    expect((await patchReservation(r.id, 'pending')).status).toBe(200);
    expect((await patchReservation(r.id, 'confirmed')).status).toBe(200);
    expect((await patchReservation(r.id, 'cancelled')).status).toBe(200);
  });

  it('still 404s an unknown reservation', async () => {
    expect((await patchReservation('res-nope', 'confirmed')).status).toBe(404);
  });
});
