import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase F — reservation fee control. Route behaviour runs against
// the FakeRepository + FakeStripeService; the repository pins run
// against the REAL Supabase repository over the shared PostgREST
// miniature (the same vi.mock seam as supabase-repository-writes) so
// the stored ROWS — columns sent, predicates carried, pre-0014
// degradation — are what get asserted there.
vi.mock('@supabase/supabase-js', async () => {
  const m = await import('./stubSupabase');
  return { createClient: m.stubSupabase.createClient };
});

import { stubSupabase as stub, type Row } from './stubSupabase';
import { createSupabaseRepository } from '../src/repositories/supabaseRepository';
import { createApp } from '../src/app';
import { effectiveReservationFee } from '../src/lib/reservationFee';
import { summarizeReservationDay, type ChatMessage, type ChatService } from '../src/lib/chat';
import type { PublicSettingsDTO, ReservationDTO } from '../src/repositories/types';
import { FakeRepository, dateFromToday, fakeVerifyToken, testEnv } from './fakeRepository';
import { FakeStripeService } from './fakeStripe';

const ADMIN = 'Bearer token-admin';

const bookingBody = {
  name: 'Fee Guest', email: 'fee@example.com', phone: '1234567',
  date: dateFromToday(7), time: '19:00', guests: 4,
};

function buildApp(opts: { withStripe?: boolean } = {}) {
  const repo = new FakeRepository();
  const stripe = opts.withStripe === false ? null : new FakeStripeService();
  const app = createApp({
    env: testEnv({ stripeConfigured: stripe != null, stripeSecretKey: stripe ? 'sk_test_fake' : null }),
    repo, verifyToken: fakeVerifyToken, stripe,
  });
  return { repo, stripe, app };
}

function setFee(repo: FakeRepository, patch: Partial<PublicSettingsDTO>) {
  repo.settings = { ...(repo.settings as PublicSettingsDTO), ...patch };
}

function feeWebhook(app: ReturnType<typeof createApp>, type: string, paymentIntentId: string) {
  return request(app)
    .post('/api/v1/payments/webhook')
    .set('stripe-signature', 'valid-sig')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ type, paymentIntentId, metadata: { type: 'reservation_fee' } }));
}

function plainWebhook(app: ReturnType<typeof createApp>, type: string, paymentIntentId: string, metadata?: Record<string, string>) {
  return request(app)
    .post('/api/v1/payments/webhook')
    .set('stripe-signature', 'valid-sig')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ type, paymentIntentId, ...(metadata ? { metadata } : {}) }));
}

async function bookWithFee(app: ReturnType<typeof createApp>, patch: Partial<typeof bookingBody> = {}) {
  const res = await request(app).post('/api/v1/reservations').send({ ...bookingBody, ...patch });
  expect(res.status).toBe(201);
  return res.body as {
    reservation: ReservationDTO;
    feePayment?: { clientSecret: string; paymentIntentId: string; amount: number; currency: string };
  };
}

// ---------------------------------------------------------------------
describe('effectiveReservationFee — the single rule', () => {
  const base = { reservationFeeEnabled: true, reservationFeeAmount: 5, currency: 'USD' };
  it('applies only when enabled AND amount > 0 AND a provider is configured', () => {
    expect(effectiveReservationFee(base, true)).toEqual({ amount: 5, currency: 'USD' });
    expect(effectiveReservationFee({ ...base, reservationFeeEnabled: false }, true)).toBeNull();
    expect(effectiveReservationFee(base, false)).toBeNull();
    expect(effectiveReservationFee({ ...base, reservationFeeAmount: 0 }, true)).toBeNull();
    expect(effectiveReservationFee({ ...base, reservationFeeAmount: -3 }, true)).toBeNull();
  });
  it('rounds the amount to the currency\'s own precision', () => {
    expect(effectiveReservationFee({ reservationFeeEnabled: true, reservationFeeAmount: 500, currency: 'JPY' }, true))
      .toEqual({ amount: 500, currency: 'JPY' });
    expect(effectiveReservationFee({ reservationFeeEnabled: true, reservationFeeAmount: 2.5, currency: 'KWD' }, true))
      .toEqual({ amount: 2.5, currency: 'KWD' });
    // Sub-precision dust rounds away — and to nothing, not to a charge.
    expect(effectiveReservationFee({ reservationFeeEnabled: true, reservationFeeAmount: 0.004, currency: 'USD' }, true)).toBeNull();
  });
});

// ---------------------------------------------------------------------
describe('public settings — only the effective fee is exposed', () => {
  it('fee off: reservationFee is null and the raw controls never leak', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/api/v1/settings/public');
    expect(res.status).toBe(200);
    expect(res.body.settings.reservationFee).toBeNull();
    expect(res.body.settings).not.toHaveProperty('reservationFeeEnabled');
    expect(res.body.settings).not.toHaveProperty('reservationFeeAmount');
  });
  it('fee on + provider: the effective fee is exposed with amount and currency', async () => {
    const { repo, app } = buildApp();
    setFee(repo, { reservationFeeEnabled: true, reservationFeeAmount: 5 });
    const res = await request(app).get('/api/v1/settings/public');
    expect(res.body.settings.reservationFee).toEqual({ amount: 5, currency: 'USD' });
  });
  it('fee on but NO provider: still null — the public is never told about an unchargeable fee', async () => {
    const { repo, app } = buildApp({ withStripe: false });
    setFee(repo, { reservationFeeEnabled: true, reservationFeeAmount: 5 });
    const res = await request(app).get('/api/v1/settings/public');
    expect(res.body.settings.reservationFee).toBeNull();
  });
  it('fee on with a zero amount: null', async () => {
    const { repo, app } = buildApp();
    setFee(repo, { reservationFeeEnabled: true, reservationFeeAmount: 0 });
    const res = await request(app).get('/api/v1/settings/public');
    expect(res.body.settings.reservationFee).toBeNull();
  });
});

// ---------------------------------------------------------------------
describe('admin settings — fee validation, provider flag, audit diff', () => {
  it('rejects a negative, oversized or non-numeric fee with 400', async () => {
    const { app } = buildApp();
    const patch = (body: unknown) => request(app).patch('/api/v1/admin/settings').set('Authorization', ADMIN).send(body as object);
    expect((await patch({ reservationFeeAmount: -1 })).status).toBe(400);
    expect((await patch({ reservationFeeAmount: 10001 })).status).toBe(400);
    expect((await patch({ reservationFeeAmount: 'five' })).status).toBe(400);
    expect((await patch({ reservationFeeEnabled: 'yes' })).status).toBe(400);
  });
  it('saves the fee controls and reports the provider state', async () => {
    const { repo, app } = buildApp();
    const res = await request(app).patch('/api/v1/admin/settings').set('Authorization', ADMIN)
      .send({ reservationFeeEnabled: true, reservationFeeAmount: 7.5 });
    expect(res.status).toBe(200);
    expect(res.body.settings.reservationFeeEnabled).toBe(true);
    expect(res.body.settings.reservationFeeAmount).toBe(7.5);
    const got = await request(app).get('/api/v1/admin/settings').set('Authorization', ADMIN);
    expect(got.body.stripeConfigured).toBe(true);
    expect(got.body.settings.reservationFeeAmount).toBe(7.5);
    void repo;
  });
  it('reports stripeConfigured false when no provider is connected', async () => {
    const { app } = buildApp({ withStripe: false });
    const got = await request(app).get('/api/v1/admin/settings').set('Authorization', ADMIN);
    expect(got.body.stripeConfigured).toBe(false);
  });
  it('writes the fee fields into the settings.updated audit diff', async () => {
    const { repo, app } = buildApp();
    const res = await request(app).patch('/api/v1/admin/settings').set('Authorization', ADMIN)
      .send({ reservationFeeEnabled: true, reservationFeeAmount: 7.5 });
    expect(res.status).toBe(200);
    const event = repo.auditEvents.find((e) => e.action === 'settings.updated');
    expect(event).toBeDefined();
    expect(event?.changes).toMatchObject({
      reservationFeeEnabled: { from: false, to: true },
      reservationFeeAmount: { from: 0, to: 7.5 },
    });
  });
});

// ---------------------------------------------------------------------
describe('booking WITHOUT an effective fee — exactly as before', () => {
  it('default settings: 201 with only { reservation }, carrying no fee', async () => {
    const { repo, app } = buildApp();
    const res = await request(app).post('/api/v1/reservations').send(bookingBody);
    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(['reservation']);
    expect(res.body.reservation.feePaymentStatus).toBe('none');
    expect(res.body.reservation.feeAmount).toBeNull();
    expect(res.body.reservation.feeCurrency).toBeNull();
    expect(repo.reservations).toHaveLength(1);
  });
  it('toggle ON but no provider: the booking stays free and claims no charge', async () => {
    const { repo, app } = buildApp({ withStripe: false });
    setFee(repo, { reservationFeeEnabled: true, reservationFeeAmount: 5 });
    const res = await request(app).post('/api/v1/reservations').send(bookingBody);
    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(['reservation']);
    expect(res.body.reservation.feePaymentStatus).toBe('none');
  });
  it('toggle ON with a zero amount: free', async () => {
    const { repo, app } = buildApp();
    setFee(repo, { reservationFeeEnabled: true, reservationFeeAmount: 0 });
    const res = await request(app).post('/api/v1/reservations').send(bookingBody);
    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(['reservation']);
  });
});

// ---------------------------------------------------------------------
describe('booking WITH an effective fee', () => {
  it('creates a pending fee booking + a correctly-routed intent (USD, 2-decimal)', async () => {
    const { repo, stripe, app } = buildApp();
    setFee(repo, { reservationFeeEnabled: true, reservationFeeAmount: 5 });
    const body = await bookWithFee(app);
    expect(body.reservation.feeAmount).toBe(5);
    expect(body.reservation.feeCurrency).toBe('USD');
    expect(body.reservation.feePaymentStatus).toBe('pending');
    expect(body.feePayment).toMatchObject({ amount: 5, currency: 'USD' });
    expect(body.feePayment?.clientSecret).toBe(`${body.feePayment?.paymentIntentId}_secret_test`);
    // The intent itself: correct minor units, lowercased currency,
    // and the metadata the webhook routes on.
    const intent = stripe?.intents.get(body.feePayment?.paymentIntentId as string);
    expect(intent?.amountCents).toBe(500);
    expect(intent?.currency).toBe('usd');
    expect(intent?.metadata).toEqual({ type: 'reservation_fee', reservationId: body.reservation.id });
    expect(intent?.idempotencyKey).toBe(`reservation-fee-${body.reservation.id}`);
    // The intent is stored against the reservation (conditionally).
    expect(repo.reservationFeeIntentIds.get(body.reservation.id)).toBe(body.feePayment?.paymentIntentId);
  });
  it('converts with the currency exponent — JPY 500 is 500 minor units, not 50000', async () => {
    const { repo, stripe, app } = buildApp();
    setFee(repo, { currency: 'JPY', reservationFeeEnabled: true, reservationFeeAmount: 500 });
    const body = await bookWithFee(app);
    expect(body.feePayment).toMatchObject({ amount: 500, currency: 'JPY' });
    expect(stripe?.intents.get(body.feePayment?.paymentIntentId as string)?.amountCents).toBe(500);
    expect(body.reservation.feeCurrency).toBe('JPY');
  });
  it('an intent that cannot be minted fails the fee — the row never pretends to await payment', async () => {
    class BrokenFeeStripe extends FakeStripeService {
      override async createReservationFeePaymentIntent(): Promise<never> {
        throw new Error('stripe is down');
      }
    }
    const repo = new FakeRepository();
    const app = createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken, stripe: new BrokenFeeStripe() });
    setFee(repo, { reservationFeeEnabled: true, reservationFeeAmount: 5 });
    const res = await request(app).post('/api/v1/reservations').send(bookingBody);
    expect(res.status).toBe(500);
    expect(repo.reservations).toHaveLength(1);
    expect(repo.reservations[0].feePaymentStatus).toBe('failed');
  });
  it('a compensation that ALSO fails is logged — and the original error still answers (final deep audit L3)', async () => {
    class BrokenFeeStripe extends FakeStripeService {
      override async createReservationFeePaymentIntent(): Promise<never> {
        throw new Error('stripe is down');
      }
    }
    class BrokenCompensationRepo extends FakeRepository {
      override async failReservationFee(): Promise<never> {
        throw new Error('database unreachable');
      }
    }
    const repo = new BrokenCompensationRepo();
    const app = createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken, stripe: new BrokenFeeStripe() });
    setFee(repo, { reservationFeeEnabled: true, reservationFeeAmount: 5 });
    const logged: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logged.push(args); });
    let status = 0;
    try {
      status = (await request(app).post('/api/v1/reservations').send(bookingBody)).status;
    } finally {
      spy.mockRestore();
    }
    // The guest is told about the ORIGINAL failure (the charge could
    // not be set up) — the compensation's own failure never masks it.
    expect(status).toBe(500);
    // …but the failed compensation is NOT silent: it is logged with
    // the reservation id and the compensation's error.
    const flat = logged.map((a) => a.map(String).join(' ')).join('\n');
    expect(flat).toContain('reservation fee compensation failed');
    expect(flat).toContain(repo.reservations[0].id);
    expect(flat).toContain('database unreachable');
  });
});

// ---------------------------------------------------------------------
describe('fee webhook routing + capacity', () => {
  it('succeeded marks the fee paid — idempotently — and only then does the booking hold seats', async () => {
    const { repo, app } = buildApp();
    setFee(repo, { reservationFeeEnabled: true, reservationFeeAmount: 5 });
    const body = await bookWithFee(app, { date: dateFromToday(1) });
    const pi = body.feePayment?.paymentIntentId as string;
    const dto = () => repo.reservations.find((r) => r.id === body.reservation.id) as ReservationDTO;
    // Before payment: the slot summary counts NOTHING for this booking.
    expect(summarizeReservationDay(dateFromToday(1), 'Tomorrow', [dto()], 40).slots).toEqual([]);
    expect((await feeWebhook(app, 'payment_intent.succeeded', pi)).status).toBe(200);
    expect(dto().feePaymentStatus).toBe('paid');
    // After payment: the booking's 4 guests hold their slot.
    expect(summarizeReservationDay(dateFromToday(1), 'Tomorrow', [dto()], 40).slots).toEqual([{ time: '19:00', guests: 4 }]);
    // Replay changes nothing.
    expect((await feeWebhook(app, 'payment_intent.succeeded', pi)).status).toBe(200);
    expect(dto().feePaymentStatus).toBe('paid');
    // A late failure never un-pays it.
    expect((await feeWebhook(app, 'payment_intent.payment_failed', pi)).status).toBe(200);
    expect(dto().feePaymentStatus).toBe('paid');
  });
  it('payment_failed marks the fee failed and the booking holds no seats; a later success recovers it', async () => {
    const { repo, app } = buildApp();
    setFee(repo, { reservationFeeEnabled: true, reservationFeeAmount: 5 });
    const body = await bookWithFee(app, { date: dateFromToday(1) });
    const pi = body.feePayment?.paymentIntentId as string;
    const dto = () => repo.reservations.find((r) => r.id === body.reservation.id) as ReservationDTO;
    expect((await feeWebhook(app, 'payment_intent.payment_failed', pi)).status).toBe(200);
    expect(dto().feePaymentStatus).toBe('failed');
    expect(summarizeReservationDay(dateFromToday(1), 'Tomorrow', [dto()], 40).slots).toEqual([]);
    // Card retry recovery: succeeded after failed settles it.
    expect((await feeWebhook(app, 'payment_intent.succeeded', pi)).status).toBe(200);
    expect(dto().feePaymentStatus).toBe('paid');
  });
  it('an unknown fee intent is acked 200 and changes nothing', async () => {
    const { repo, app } = buildApp();
    const res = await feeWebhook(app, 'payment_intent.succeeded', 'pi_not_ours');
    expect(res.status).toBe(200);
    expect(repo.reservations).toHaveLength(0);
  });
  it('ORDER intents behave exactly as before: no metadata type → the order flow settles them', async () => {
    const { repo, app } = buildApp();
    const orderRes = await request(app).post('/api/v1/orders').send({
      customerName: 'Jane Guest', customerEmail: 'jane@example.com',
      address: { line1: '1 Forest Way', city: 'Portland' },
      items: [{ menuItemId: 1, quantity: 1 }],
    });
    expect(orderRes.status).toBe(201);
    const orderId = orderRes.body.order.id as string;
    const intentRes = await request(app).post('/api/v1/payments/create-intent').send({ orderId });
    expect(intentRes.status).toBe(200);
    const pi = intentRes.body.paymentIntentId as string;
    expect((await plainWebhook(app, 'payment_intent.succeeded', pi)).status).toBe(200);
    expect((await repo.getOrder(orderId))?.paymentStatus).toBe('paid');
  });
  it('a FOREIGN metadata type leaves even a matching order intent untouched', async () => {
    const { repo, app } = buildApp();
    const orderRes = await request(app).post('/api/v1/orders').send({
      customerName: 'Jane Guest', customerEmail: 'jane@example.com',
      address: { line1: '1 Forest Way', city: 'Portland' },
      items: [{ menuItemId: 1, quantity: 1 }],
    });
    const orderId = orderRes.body.order.id as string;
    const intentRes = await request(app).post('/api/v1/payments/create-intent').send({ orderId });
    const pi = intentRes.body.paymentIntentId as string;
    const res = await plainWebhook(app, 'payment_intent.succeeded', pi, { type: 'donation' });
    expect(res.status).toBe(200);
    expect((await repo.getOrder(orderId))?.paymentStatus).not.toBe('paid');
  });
  it('the admin board payload carries the fee state', async () => {
    const { repo, app } = buildApp();
    setFee(repo, { reservationFeeEnabled: true, reservationFeeAmount: 5 });
    const body = await bookWithFee(app);
    const list = await request(app).get('/api/v1/admin/reservations').set('Authorization', ADMIN);
    expect(list.status).toBe(200);
    const row = (list.body.reservations as ReservationDTO[]).find((r) => r.id === body.reservation.id);
    expect(row).toMatchObject({ feeAmount: 5, feeCurrency: 'USD', feePaymentStatus: 'pending' });
    await feeWebhook(app, 'payment_intent.succeeded', body.feePayment?.paymentIntentId as string);
    const after = await request(app).get('/api/v1/admin/reservations').set('Authorization', ADMIN);
    const paidRow = (after.body.reservations as ReservationDTO[]).find((r) => r.id === body.reservation.id);
    expect(paidRow?.feePaymentStatus).toBe('paid');
  });
});

// ---------------------------------------------------------------------
class CapturingChat implements ChatService {
  systems: string[] = [];
  async reply(input: { system: string; messages: ChatMessage[] }): Promise<string> {
    this.systems.push(input.system);
    return 'Certainly.';
  }
}

function chatApp(repo: FakeRepository, withProvider: boolean) {
  const chat = new CapturingChat();
  const app = createApp({
    env: testEnv({ stripeConfigured: withProvider, stripeSecretKey: withProvider ? 'sk_test_fake' : null }),
    repo, verifyToken: fakeVerifyToken, chat,
    stripe: withProvider ? new FakeStripeService() : null,
  });
  return { chat, app };
}

const ask = (app: ReturnType<typeof createApp>) =>
  request(app).post('/api/v1/chat').send({ messages: [{ role: 'user', content: 'Do I pay to book a table?' }] });

describe('Ember AI grounding — the fee fact reads the live effective state', () => {
  it('no fee: booking is stated free of charge, with no fee mentioned', async () => {
    const repo = new FakeRepository();
    const { chat, app } = chatApp(repo, true);
    expect((await ask(app)).status).toBe(200);
    const system = chat.systems[chat.systems.length - 1];
    expect(system).toContain('free of charge');
    expect(system).toContain('no booking fee');
    expect(system).not.toContain('booking fee of');
  });
  it('fee in force: the prompt states the exact fee and the online card charge — and never "free"', async () => {
    const repo = new FakeRepository();
    setFee(repo, { reservationFeeEnabled: true, reservationFeeAmount: 5 });
    const { chat, app } = chatApp(repo, true);
    expect((await ask(app)).status).toBe(200);
    const system = chat.systems[chat.systems.length - 1];
    expect(system).toContain('booking fee of USD 5.00');
    expect(system).toContain('charged online by card');
    expect(system).not.toContain('free of charge');
    expect(system).not.toContain('no booking fee');
    expect(system).not.toContain('free table booking');
  });
  it('toggle on but NO provider: the prompt still promises free booking — the AI never claims an unchargeable fee', async () => {
    const repo = new FakeRepository();
    setFee(repo, { reservationFeeEnabled: true, reservationFeeAmount: 5 });
    const { chat, app } = chatApp(repo, false);
    expect((await ask(app)).status).toBe(200);
    const system = chat.systems[chat.systems.length - 1];
    expect(system).toContain('free of charge');
    expect(system).not.toContain('booking fee of');
  });
  it('an unpaid fee booking does not hold seats in the prompt; once paid, it does', async () => {
    const repo = new FakeRepository();
    setFee(repo, { reservationFeeEnabled: true, reservationFeeAmount: 5 });
    const { chat, app } = chatApp(repo, true);
    const body = await bookWithFee(app, { date: dateFromToday(1), guests: 6 });
    expect((await ask(app)).status).toBe(200);
    expect(chat.systems[chat.systems.length - 1]).not.toContain('19:00 — 6 of 40 seats taken');
    await feeWebhook(app, 'payment_intent.succeeded', body.feePayment?.paymentIntentId as string);
    expect((await ask(app)).status).toBe(200);
    expect(chat.systems[chat.systems.length - 1]).toContain('19:00 — 6 of 40 seats taken');
  });
});

// ---------------------------------------------------------------------
// Repository pins — the REAL repository over the PostgREST stub.
const realRepo = createSupabaseRepository('https://stub.invalid', 'stub-key');
const rows = (table: string): Row[] => stub.tables.get(table) ?? [];

function stubSettingsRow(patch: Row = {}): Row {
  return {
    id: 1, kitchen_open: true, wait_min: 20, wait_max: 30, currency: 'USD', restaurant_name: 'Ember & Co.',
    phone: null, email: null, address: null, whatsapp_number: null, reservation_slot_capacity: 40,
    opening_hours: {}, site_locations: null, ...patch,
  };
}
function stubReservationRow(patch: Row = {}): Row {
  return {
    id: 'res-stub-1', user_id: null, name: 'Seed Guest', email: 'seed@example.com', phone: '555',
    reservation_date: '2026-12-24', reservation_time: '19:00', guests: 2, status: 'pending',
    source: 'website', notes: null, created_at: '2026-01-01T00:00:00.000Z', ...patch,
  };
}

describe('repository — settings sanitizer (0014)', () => {
  beforeEach(() => stub.reset());
  it('a pre-0014 settings row (no fee columns) reads as fee OFF / amount 0', async () => {
    stub.seed('restaurant_settings', [stubSettingsRow()]);
    const settings = await realRepo.getSettings();
    expect(settings.reservationFeeEnabled).toBe(false);
    expect(settings.reservationFeeAmount).toBe(0);
  });
  it('stored fee values map through; garbage is clamped, never trusted', async () => {
    stub.seed('restaurant_settings', [stubSettingsRow({ reservation_fee_enabled: true, reservation_fee_amount: 7.5 })]);
    const on = await realRepo.getSettings();
    expect(on.reservationFeeEnabled).toBe(true);
    expect(on.reservationFeeAmount).toBe(7.5);
    stub.seed('restaurant_settings', [stubSettingsRow({ reservation_fee_enabled: 'yes', reservation_fee_amount: -4 })]);
    const garbage = await realRepo.getSettings();
    expect(garbage.reservationFeeEnabled).toBe(false);
    expect(garbage.reservationFeeAmount).toBe(0);
  });
  it('pre-0014 update degradation: a fee patch retries without the missing columns and still saves', async () => {
    stub.setMissingColumns('restaurant_settings', ['reservation_fee_enabled', 'reservation_fee_amount']);
    stub.seed('restaurant_settings', [stubSettingsRow()]);
    const saved = await realRepo.updateSettings({ restaurantName: 'Degraded Diner', reservationFeeEnabled: true, reservationFeeAmount: 9 });
    expect(rows('restaurant_settings')[0].restaurant_name).toBe('Degraded Diner');
    expect(rows('restaurant_settings')[0]).not.toHaveProperty('reservation_fee_enabled');
    expect(saved.reservationFeeEnabled).toBe(false);
    expect(saved.reservationFeeAmount).toBe(0);
  });
  it('pre-0014 insert degradation: a first save inserts the singleton without the fee columns', async () => {
    stub.setMissingColumns('restaurant_settings', ['reservation_fee_enabled', 'reservation_fee_amount']);
    stub.seed('restaurant_settings', []);
    await realRepo.updateSettings({ restaurantName: 'First Save', reservationFeeEnabled: true, reservationFeeAmount: 9 });
    expect(rows('restaurant_settings')).toHaveLength(1);
    expect(rows('restaurant_settings')[0].restaurant_name).toBe('First Save');
    expect(rows('restaurant_settings')[0]).not.toHaveProperty('reservation_fee_amount');
  });
  it('post-0014: the fee patch persists to its columns', async () => {
    stub.seed('restaurant_settings', [stubSettingsRow()]);
    await realRepo.updateSettings({ reservationFeeEnabled: true, reservationFeeAmount: 9 });
    expect(rows('restaurant_settings')[0].reservation_fee_enabled).toBe(true);
    expect(rows('restaurant_settings')[0].reservation_fee_amount).toBe(9);
  });
});

describe('repository — reservation fee rows + transitions (0014)', () => {
  beforeEach(() => stub.reset());
  it('a pre-0014 reservation row reads as fee none/null', async () => {
    stub.seed('reservations', [stubReservationRow()]);
    const dto = await realRepo.getReservation('res-stub-1');
    expect(dto).toMatchObject({ feeAmount: null, feeCurrency: null, feePaymentStatus: 'none' });
  });
  it('an out-of-vocabulary stored fee status reads as none', async () => {
    stub.seed('reservations', [stubReservationRow({ fee_amount: 5, fee_currency: 'USD', fee_payment_status: 'weird' })]);
    const dto = await realRepo.getReservation('res-stub-1');
    expect(dto?.feePaymentStatus).toBe('none');
  });
  it('createReservation WITH a fee stores the snapshot + pending state; WITHOUT one names no fee columns', async () => {
    const withFee = await realRepo.createReservation({
      userId: null, name: 'A', email: 'a@example.com', phone: '1', date: '2026-12-24', time: '19:00', guests: 2,
      fee: { amount: 5, currency: 'USD' },
    });
    expect(withFee).toMatchObject({ feeAmount: 5, feeCurrency: 'USD', feePaymentStatus: 'pending' });
    expect(rows('reservations')[0]).toMatchObject({ fee_amount: 5, fee_currency: 'USD', fee_payment_status: 'pending' });
    stub.reset();
    await realRepo.createReservation({
      userId: null, name: 'B', email: 'b@example.com', phone: '1', date: '2026-12-24', time: '19:00', guests: 2,
    });
    expect(rows('reservations')[0]).not.toHaveProperty('fee_amount');
    expect(rows('reservations')[0]).not.toHaveProperty('fee_payment_status');
  });
  it('setReservationFeePaymentIntent stores only while pending', async () => {
    stub.seed('reservations', [stubReservationRow({ fee_amount: 5, fee_currency: 'USD', fee_payment_status: 'pending' })]);
    expect(await realRepo.setReservationFeePaymentIntent('res-stub-1', 'pi_fee_1')).toBe(true);
    expect(rows('reservations')[0].fee_payment_intent_id).toBe('pi_fee_1');
    stub.seed('reservations', [stubReservationRow({ fee_amount: 5, fee_currency: 'USD', fee_payment_status: 'paid', fee_payment_intent_id: 'pi_old' })]);
    expect(await realRepo.setReservationFeePaymentIntent('res-stub-1', 'pi_new')).toBe(false);
    expect(rows('reservations')[0].fee_payment_intent_id).toBe('pi_old');
  });
  it('guarded transitions: paid from pending/failed and terminal; failed from pending only; unknown intent → null', async () => {
    stub.seed('reservations', [stubReservationRow({ fee_amount: 5, fee_currency: 'USD', fee_payment_status: 'pending', fee_payment_intent_id: 'pi_fee_2' })]);
    expect((await realRepo.markReservationFeeFailedByPaymentIntent('pi_fee_2'))?.feePaymentStatus).toBe('failed');
    // A succeeded event after the failure is a card retry — it settles.
    expect((await realRepo.markReservationFeePaidByPaymentIntent('pi_fee_2'))?.feePaymentStatus).toBe('paid');
    // Terminal: replays and late failures change nothing.
    expect((await realRepo.markReservationFeePaidByPaymentIntent('pi_fee_2'))?.feePaymentStatus).toBe('paid');
    expect((await realRepo.markReservationFeeFailedByPaymentIntent('pi_fee_2'))?.feePaymentStatus).toBe('paid');
    expect(await realRepo.markReservationFeePaidByPaymentIntent('pi_unknown')).toBeNull();
  });
  it('pre-0014: fee webhook lookups degrade to null instead of throwing', async () => {
    stub.setMissingColumns('reservations', ['fee_amount', 'fee_currency', 'fee_payment_status', 'fee_payment_intent_id']);
    stub.seed('reservations', [stubReservationRow()]);
    expect(await realRepo.markReservationFeePaidByPaymentIntent('pi_anything')).toBeNull();
    expect(await realRepo.markReservationFeeFailedByPaymentIntent('pi_anything')).toBeNull();
    expect(await realRepo.setReservationFeePaymentIntent('res-stub-1', 'pi_anything')).toBe(false);
    await expect(realRepo.failReservationFee('res-stub-1')).resolves.toBeUndefined();
  });
});
