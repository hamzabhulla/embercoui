import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import {
  cardMinimumMinorUnits, currencyExponent, isValidCurrencyCode, toMinorUnits,
} from '../src/lib/currency';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';
import { FakeStripeService } from './fakeStripe';

const repo = new FakeRepository();
const stripe = new FakeStripeService();
const app = createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken, stripe });

const ADMIN_TOKEN = ['Bearer', 'token-admin'].join(' ');
const asAdmin = (r: request.Test) => r.set('Authorization', ADMIN_TOKEN);
const patchSettings = (body: Record<string, unknown>) => asAdmin(request(app).patch('/api/v1/admin/settings').send(body));
const setCurrency = (currency: string) => patchSettings({ currency });

const checkoutBody = {
  customerName: 'Jane Guest', customerEmail: 'jane@example.com',
  address: { line1: '1 Forest Way', city: 'Portland' },
  items: [
    { menuItemId: 1, quantity: 2 },
    { menuItemId: 2, quantity: 1 },
  ],
};

describe('currency math (ISO 4217 exponents)', () => {
  it('uses the real minor-unit exponent per currency', () => {
    expect(currencyExponent('USD')).toBe(2);
    expect(currencyExponent('EUR')).toBe(2);
    expect(currencyExponent('PKR')).toBe(2);
    expect(currencyExponent('JPY')).toBe(0);
    expect(currencyExponent('KRW')).toBe(0);
    expect(currencyExponent('KWD')).toBe(3);
    expect(currencyExponent('BHD')).toBe(3);
    expect(toMinorUnits(86, 'USD')).toBe(8600);
    expect(toMinorUnits(86, 'JPY')).toBe(86);
    expect(toMinorUnits(86, 'KWD')).toBe(86000);
    expect(cardMinimumMinorUnits('USD')).toBe(50);
    expect(cardMinimumMinorUnits('JPY')).toBe(50);
    expect(cardMinimumMinorUnits('KWD')).toBe(500);
  });
  it('validates against real ISO codes, not just any 3 letters', () => {
    expect(isValidCurrencyCode('USD')).toBe(true);
    expect(isValidCurrencyCode('pkr')).toBe(true);
    expect(isValidCurrencyCode('XXX')).toBe(true); // real ISO code: "no currency"
    expect(isValidCurrencyCode('ZZZ')).toBe(false);
    expect(isValidCurrencyCode('FOO')).toBe(false);
    expect(isValidCurrencyCode('US')).toBe(false);
  });
});

describe('settings currency', () => {
  it('defaults to USD', async () => {
    const res = await request(app).get('/api/v1/settings/public');
    expect(res.body.settings.currency).toBe('USD');
  });
  it("accepts 'pkr' and stores/returns it normalized as 'PKR'", async () => {
    const res = await setCurrency('pkr');
    expect(res.status).toBe(200);
    expect(res.body.settings.currency).toBe('PKR');
    const pub = await request(app).get('/api/v1/settings/public');
    expect(pub.body.settings.currency).toBe('PKR');
  });
  it('rejects bogus codes with a clear 400 and keeps the old currency', async () => {
    for (const bogus of ['ZZZ', 'FOO', 'US', 'EURO', '12A']) {
      const res = await setCurrency(bogus);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/currency/i);
    }
    const pub = await request(app).get('/api/v1/settings/public');
    expect(pub.body.settings.currency).toBe('PKR');
  });
});

describe('order currency snapshot', () => {
  it('snapshots the current settings currency onto the order', async () => {
    // Settings are still PKR from the previous describe block.
    const res = await request(app).post('/api/v1/orders').send(checkoutBody);
    expect(res.status).toBe(201);
    expect(res.body.order.currency).toBe('PKR');
    // Prices are major units of the current currency — totals unchanged.
    expect(res.body.order.subtotal).toBe(86);
    expect(res.body.order.total).toBe(86);
    const stored = await repo.getOrder(res.body.order.id as string);
    expect(stored?.currency).toBe('PKR');
  });
  it("does not rewrite an existing order's currency when settings change", async () => {
    const created = await request(app).post('/api/v1/orders').send(checkoutBody);
    const id = created.body.order.id as string;
    expect(created.body.order.currency).toBe('PKR');
    await setCurrency('USD');
    const stored = await repo.getOrder(id);
    expect(stored?.currency).toBe('PKR');
  });
});

describe('payment intent currency', () => {
  it('charges a JPY order in whole yen — exponent 0, currency jpy', async () => {
    await setCurrency('JPY');
    const created = await request(app).post('/api/v1/orders').send(checkoutBody);
    expect(created.body.order.currency).toBe('JPY');
    const res = await request(app).post('/api/v1/payments/create-intent').send({ orderId: created.body.order.id });
    expect(res.status).toBe(200);
    const intent = stripe.intents.get(res.body.paymentIntentId);
    expect(intent?.currency).toBe('jpy');
    expect(intent?.amountCents).toBe(86); // NOT 8600 — yen has no minor unit
  });
  it('charges a KWD order with exponent 3', async () => {
    await setCurrency('KWD');
    const created = await request(app).post('/api/v1/orders').send(checkoutBody);
    const res = await request(app).post('/api/v1/payments/create-intent').send({ orderId: created.body.order.id });
    expect(res.status).toBe(200);
    const intent = stripe.intents.get(res.body.paymentIntentId);
    expect(intent?.currency).toBe('kwd');
    expect(intent?.amountCents).toBe(86000);
  });
  it("charges in the ORDER's currency even after settings move on", async () => {
    await setCurrency('EUR');
    const created = await request(app).post('/api/v1/orders').send(checkoutBody);
    await setCurrency('USD');
    const res = await request(app).post('/api/v1/payments/create-intent').send({ orderId: created.body.order.id });
    expect(res.status).toBe(200);
    const intent = stripe.intents.get(res.body.paymentIntentId);
    expect(intent?.currency).toBe('eur');
    expect(intent?.amountCents).toBe(8600);
  });
});

describe('reports never mix currencies', () => {
  it('dashboard + finance aggregate only the current currency; counts stay global', async () => {
    // A paid USD order, seeded directly (48 USD).
    const seeded = await repo.createOrder({
      userId: 'user-1', customerName: 'Test User', customerEmail: 'user@example.com', customerPhone: null,
      address: null, notes: null, couponCode: null, currency: 'USD',
      items: [{ menuItemId: 1, name: 'Ember Classic', unitPrice: 24, quantity: 2 }],
      subtotal: 48, deliveryFee: 0, discount: 0, total: 48,
    });
    await repo.setOrderPaymentIntent(seeded.id, 'pi_seed_currency');
    await repo.markOrderPaidByPaymentIntent('pi_seed_currency');

    await setCurrency('USD');
    const dashUsd = await asAdmin(request(app).get('/api/v1/admin/dashboard'));
    expect(dashUsd.body.currency).toBe('USD');
    expect(dashUsd.body.stats.revenue).toBe(48);
    const totalOrders = dashUsd.body.stats.totalOrders as number;
    expect(totalOrders).toBeGreaterThan(1); // includes the unpaid PKR/JPY/KWD/EUR orders

    const finUsd = await asAdmin(request(app).get('/api/v1/admin/finance'));
    expect(finUsd.body.currency).toBe('USD');
    expect(finUsd.body.totalRevenue).toBe(48);
    expect(finUsd.body.totalPaidOrders).toBe(1);

    // Switch the restaurant to PKR: the USD money must vanish from reports,
    // while non-money counts stay exactly as global as before.
    await setCurrency('PKR');
    const dashPkr = await asAdmin(request(app).get('/api/v1/admin/dashboard'));
    expect(dashPkr.body.currency).toBe('PKR');
    expect(dashPkr.body.stats.revenue).toBe(0);
    expect(dashPkr.body.stats.totalOrders).toBe(totalOrders);

    const finPkr = await asAdmin(request(app).get('/api/v1/admin/finance'));
    expect(finPkr.body.currency).toBe('PKR');
    expect(finPkr.body.totalRevenue).toBe(0);
    expect(finPkr.body.totalPaidOrders).toBe(0);
    expect(finPkr.body.byDay).toHaveLength(0);
    expect(finPkr.body.byMonth).toHaveLength(0);

    // A paid KWD order: 3-decimal amounts must survive report rounding
    // exactly (the old hard-coded x100 rounding turned 25.596 into 25.60).
    const kwd = await repo.createOrder({
      userId: 'user-1', customerName: 'Test User', customerEmail: 'user@example.com', customerPhone: null,
      address: null, notes: null, couponCode: null, currency: 'KWD',
      items: [{ menuItemId: 1, name: 'Ember Classic', unitPrice: 25.596, quantity: 1 }],
      subtotal: 25.596, deliveryFee: 0, discount: 0, total: 25.596,
    });
    await repo.setOrderPaymentIntent(kwd.id, 'pi_seed_kwd');
    await repo.markOrderPaidByPaymentIntent('pi_seed_kwd');
    await setCurrency('KWD');
    const dashKwd = await asAdmin(request(app).get('/api/v1/admin/dashboard'));
    expect(dashKwd.body.currency).toBe('KWD');
    expect(dashKwd.body.stats.revenue).toBe(25.596);
    const finKwd = await asAdmin(request(app).get('/api/v1/admin/finance'));
    expect(finKwd.body.totalRevenue).toBe(25.596);
    expect(finKwd.body.averageOrderValue).toBe(25.596);
    expect(finKwd.body.byDay[0].revenue).toBe(25.596);

    await setCurrency('USD');
  });
});
