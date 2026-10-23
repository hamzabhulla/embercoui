import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { createStripeService } from '../src/lib/stripe';
import type { ChatMessage, ChatService } from '../src/lib/chat';
import type { PublicSettingsDTO } from '../src/repositories/types';
import { FakeRepository, dateFromToday, fakeVerifyToken, testEnv } from './fakeRepository';
import { FakeStripeService } from './fakeStripe';

// Mega-audit M2 — stripeConfigured must mean "payments can actually
// settle": BOTH the secret key AND the webhook secret. These tests
// pin the KEY-ONLY deployment (secret key present, webhook secret
// absent → flag false) across every consumer: a raw Stripe service
// object is still handed to the app (the pre-fix index.ts wiring),
// and no surface may advertise a fee, mint an intent, or book a
// fee-bearing reservation off it. When both secrets are present,
// behaviour is exactly as before.

const ADMIN = 'Bearer token-admin';

const checkoutBody = {
  customerName: 'Jane Guest', customerEmail: 'jane@example.com',
  address: { line1: '1 Forest Way', city: 'Portland' },
  items: [{ menuItemId: 1, quantity: 1 }],
};

const bookingBody = {
  name: 'Fee Guest', email: 'fee@example.com', phone: '1234567',
  date: dateFromToday(7), time: '19:00', guests: 4,
};

function keyOnlyApp() {
  const repo = new FakeRepository();
  const stripe = new FakeStripeService();
  const app = createApp({
    env: testEnv({ stripeConfigured: false, stripeSecretKey: 'sk_test_fake', stripeWebhookSecret: null }),
    repo, verifyToken: fakeVerifyToken, stripe,
  });
  return { repo, stripe, app };
}

function setFee(repo: FakeRepository) {
  repo.settings = { ...(repo.settings as PublicSettingsDTO), reservationFeeEnabled: true, reservationFeeAmount: 5 };
}

class MarkerChat implements ChatService {
  async reply(_input: { system: string; messages: ChatMessage[] }): Promise<string> {
    return `Of course. [[BOOK: ${dateFromToday(7)} | 19:00 | 4 | Ayesha Khan | +92 300 1234567 | ayesha@example.com]]`;
  }
}

describe('key-only Stripe config (secret key, NO webhook secret)', () => {
  it('health reports stripeConfigured false', async () => {
    const { app } = keyOnlyApp();
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.stripeConfigured).toBe(false);
    expect(res.body.supabaseConfigured).toBe(true);
  });

  it('public settings expose NO reservation fee even with the toggle on and an amount set', async () => {
    const { repo, app } = keyOnlyApp();
    setFee(repo);
    const res = await request(app).get('/api/v1/settings/public');
    expect(res.status).toBe(200);
    expect(res.body.settings.reservationFee).toBeNull();
  });

  it('the admin settings provider flag reads false', async () => {
    const { app } = keyOnlyApp();
    const res = await request(app).get('/api/v1/admin/settings').set('Authorization', ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.stripeConfigured).toBe(false);
  });

  it('GEO llms output describes booking as free — no fee is claimed', async () => {
    const { repo, app } = keyOnlyApp();
    setFee(repo);
    const res = await request(app).get('/api/llms.txt');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Booking a table is free of charge unless the restaurant sets a booking fee.');
    expect(res.text).not.toContain('carries a fee of');
  });

  it('create-intent refuses honestly (503) and mints nothing, even though a raw service object exists', async () => {
    const { stripe, app } = keyOnlyApp();
    const orderRes = await request(app).post('/api/v1/orders').send(checkoutBody);
    expect(orderRes.status).toBe(201);
    const res = await request(app).post('/api/v1/payments/create-intent').send({ orderId: orderRes.body.order.id as string });
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Payments are not configured');
    expect(stripe.intents.size).toBe(0);
  });

  it('a website booking stays FREE — no fee snapshot, no fee intent minted', async () => {
    const { repo, stripe, app } = keyOnlyApp();
    setFee(repo);
    const res = await request(app).post('/api/v1/reservations').send(bookingBody);
    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(['reservation']);
    expect(res.body.reservation.feePaymentStatus).toBe('none');
    expect(res.body.reservation.feeAmount).toBeNull();
    expect(repo.reservations).toHaveLength(1);
    expect(stripe.intents.size).toBe(0);
  });

  it('an Ember AI booking stays FREE — no fee snapshot, no fee intent minted', async () => {
    const repo = new FakeRepository();
    setFee(repo);
    const stripe = new FakeStripeService();
    const app = createApp({
      env: testEnv({ stripeConfigured: false, stripeSecretKey: 'sk_test_fake', stripeWebhookSecret: null }),
      repo, verifyToken: fakeVerifyToken, chat: new MarkerChat(), stripe,
    });
    const res = await request(app).post('/api/v1/chat').send({ messages: [{ role: 'user', content: 'Yes please, book it' }] });
    expect(res.status).toBe(200);
    expect(repo.reservations).toHaveLength(1);
    expect(repo.reservations[0].feePaymentStatus).toBe('none');
    expect(repo.reservations[0].feeAmount).toBeNull();
    expect(stripe.intents.size).toBe(0);
  });
});

describe('both secrets present — behaviour unchanged', () => {
  it('the fee is effective in public settings and order intents still mint', async () => {
    const repo = new FakeRepository();
    setFee(repo);
    const stripe = new FakeStripeService();
    const app = createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken, stripe });
    const pub = await request(app).get('/api/v1/settings/public');
    expect(pub.body.settings.reservationFee).toEqual({ amount: 5, currency: 'USD' });
    const orderRes = await request(app).post('/api/v1/orders').send(checkoutBody);
    expect(orderRes.status).toBe(201);
    const intent = await request(app).post('/api/v1/payments/create-intent').send({ orderId: orderRes.body.order.id as string });
    expect(intent.status).toBe(200);
    expect(intent.body.clientSecret).toContain('_secret_test');
  });

  it('webhook verification is exactly as before: no webhook secret → 503, bad signature → 400', () => {
    const noSecret = createStripeService('sk_test_local_offline', null);
    expect(() => noSecret.constructEvent(Buffer.from('{}'), 'sig'))
      .toThrowError(expect.objectContaining({ status: 503 }));
    const withSecret = createStripeService('sk_test_local_offline', 'whsec_local');
    expect(() => withSecret.constructEvent(Buffer.from('{}'), 't=1,v1=deadbeef'))
      .toThrowError(expect.objectContaining({ status: 400, message: 'Invalid webhook signature' }));
  });
});
