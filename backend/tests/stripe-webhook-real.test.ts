import { createHmac } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createStripeService } from '../src/lib/stripe';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';

// Audit-2 Fix 10 (H-5) — the webhook's signature verification runs the
// REAL Stripe SDK path (createStripeService → stripe.webhooks.
// constructEvent), not FakeStripeService's 'valid-sig' shortcut.
// Payloads are signed exactly as Stripe signs them —
// HMAC-SHA256 over `${timestamp}.${payload}` with the webhook secret,
// header `t=…,v1=…` — entirely offline: constructEvent is pure local
// cryptography. The repository stays the fake; only the verification
// seam is real, which is the seam that was never exercised.

const WEBHOOK_SECRET = 'whsec_test_local_signing_secret';

const stripe = createStripeService('sk_test_local_offline', WEBHOOK_SECRET);
const repo = new FakeRepository();
const app = createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken, stripe });

function sign(payload: string, secret: string, timestampSec?: number): string {
  const t = timestampSec ?? Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`, 'utf8').digest('hex');
  return `t=${t},v1=${v1}`;
}

function eventPayload(type: string, object: Record<string, unknown>): string {
  return JSON.stringify({ id: 'evt_test_1', object: 'event', type, data: { object } });
}

async function seedOrderWithIntent(intentId: string) {
  const res = await request(app).post('/api/v1/orders').send({
    customerName: 'Jane Guest', customerEmail: 'jane@example.com',
    address: { line1: '1 Forest Way', city: 'Portland' },
    items: [{ menuItemId: 1, quantity: 1 }],
  });
  expect(res.status).toBe(201);
  const orderId = res.body.order.id as string;
  await repo.setOrderPaymentIntent(orderId, intentId);
  return orderId;
}

function postWebhook(payload: string, signature?: string) {
  let req = request(app).post('/api/v1/payments/webhook').set('Content-Type', 'application/json');
  if (signature !== undefined) req = req.set('stripe-signature', signature);
  return req.send(payload);
}

describe('real Stripe webhook verification', () => {
  it('a correctly signed payment_intent.succeeded is accepted and settles the order', async () => {
    const orderId = await seedOrderWithIntent('pi_real_succeeded');
    const payload = eventPayload('payment_intent.succeeded', { id: 'pi_real_succeeded', object: 'payment_intent', status: 'succeeded' });
    const res = await postWebhook(payload, sign(payload, WEBHOOK_SECRET));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect((await repo.getOrder(orderId))?.paymentStatus).toBe('paid');
  });

  it('a correctly signed payment_intent.payment_failed marks the order failed', async () => {
    const orderId = await seedOrderWithIntent('pi_real_failed');
    const payload = eventPayload('payment_intent.payment_failed', { id: 'pi_real_failed', object: 'payment_intent', status: 'requires_payment_method' });
    const res = await postWebhook(payload, sign(payload, WEBHOOK_SECRET));
    expect(res.status).toBe(200);
    expect((await repo.getOrder(orderId))?.paymentStatus).toBe('failed');
  });

  it('a tampered body (signed payload differs from sent payload) is rejected 400', async () => {
    const orderId = await seedOrderWithIntent('pi_real_tampered');
    const signedPayload = eventPayload('payment_intent.succeeded', { id: 'pi_real_tampered', object: 'payment_intent' });
    const tamperedPayload = eventPayload('payment_intent.payment_failed', { id: 'pi_real_tampered', object: 'payment_intent' });
    const res = await postWebhook(tamperedPayload, sign(signedPayload, WEBHOOK_SECRET));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid webhook signature');
    expect((await repo.getOrder(orderId))?.paymentStatus).toBe('pending'); // untouched
  });

  it('a signature made with the WRONG secret is rejected 400', async () => {
    const orderId = await seedOrderWithIntent('pi_real_wrong_secret');
    const payload = eventPayload('payment_intent.succeeded', { id: 'pi_real_wrong_secret', object: 'payment_intent' });
    const res = await postWebhook(payload, sign(payload, 'whsec_some_other_secret'));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid webhook signature');
    expect((await repo.getOrder(orderId))?.paymentStatus).toBe('pending');
  });

  it('a stale timestamp (outside the SDK tolerance) is rejected 400 even with a valid HMAC', async () => {
    const orderId = await seedOrderWithIntent('pi_real_stale');
    const payload = eventPayload('payment_intent.succeeded', { id: 'pi_real_stale', object: 'payment_intent' });
    const oneHourAgo = Math.floor(Date.now() / 1000) - 3600;
    const res = await postWebhook(payload, sign(payload, WEBHOOK_SECRET, oneHourAgo));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid webhook signature');
    expect((await repo.getOrder(orderId))?.paymentStatus).toBe('pending');
  });

  it('a missing signature header is rejected 400 before verification', async () => {
    const payload = eventPayload('payment_intent.succeeded', { id: 'pi_whatever', object: 'payment_intent' });
    const res = await postWebhook(payload);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing Stripe signature');
  });

  it('a correctly signed event for an UNKNOWN intent is acked 200 (Stripe must not retry forever)', async () => {
    const payload = eventPayload('payment_intent.succeeded', { id: 'pi_not_ours', object: 'payment_intent' });
    const res = await postWebhook(payload, sign(payload, WEBHOOK_SECRET));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it('a signed non-payment-intent event is acked but settles nothing (type filter)', async () => {
    const orderId = await seedOrderWithIntent('pi_real_charge_event');
    // A charge event carries the intent id on data.object.payment_intent;
    // the handler must not treat it as a payment_intent lifecycle event.
    const payload = eventPayload('charge.succeeded', { id: 'ch_1', object: 'charge', payment_intent: 'pi_real_charge_event' });
    const res = await postWebhook(payload, sign(payload, WEBHOOK_SECRET));
    expect(res.status).toBe(200);
    expect((await repo.getOrder(orderId))?.paymentStatus).toBe('pending');
  });
});

describe('constructEvent mapping (real SDK, unit level)', () => {
  it('maps a payment_intent object to its own id', () => {
    const payload = eventPayload('payment_intent.succeeded', { id: 'pi_unit_1', object: 'payment_intent' });
    const event = stripe.constructEvent(Buffer.from(payload, 'utf8'), sign(payload, WEBHOOK_SECRET));
    expect(event).toEqual({ type: 'payment_intent.succeeded', paymentIntentId: 'pi_unit_1', metadata: {} });
  });

  it('maps other objects to their payment_intent field', () => {
    const payload = eventPayload('charge.succeeded', { id: 'ch_1', object: 'charge', payment_intent: 'pi_unit_2' });
    const event = stripe.constructEvent(Buffer.from(payload, 'utf8'), sign(payload, WEBHOOK_SECRET));
    expect(event).toEqual({ type: 'charge.succeeded', paymentIntentId: 'pi_unit_2', metadata: {} });
  });

  it('carries a payment intent\'s metadata through (the webhook routes fee intents on it)', () => {
    const payload = eventPayload('payment_intent.succeeded', {
      id: 'pi_unit_fee', object: 'payment_intent',
      metadata: { type: 'reservation_fee', reservationId: 'res-unit-1' },
    });
    const event = stripe.constructEvent(Buffer.from(payload, 'utf8'), sign(payload, WEBHOOK_SECRET));
    expect(event).toEqual({
      type: 'payment_intent.succeeded', paymentIntentId: 'pi_unit_fee',
      metadata: { type: 'reservation_fee', reservationId: 'res-unit-1' },
    });
  });

  it('throws the route-facing 400 ApiError on a bad signature', () => {
    const payload = eventPayload('payment_intent.succeeded', { id: 'pi_unit_3', object: 'payment_intent' });
    expect(() => stripe.constructEvent(Buffer.from(payload, 'utf8'), 't=1,v1=deadbeef'))
      .toThrowError(expect.objectContaining({ status: 400, message: 'Invalid webhook signature' }));
  });
});
