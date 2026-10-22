import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { FakeRepository, fakeVerifyToken, testEnv } from './fakeRepository';
import { FakeStripeService } from './fakeStripe';

// Payment state-machine hardening (production audit, Fix 2):
//  - webhook transitions are guarded ('paid' is terminal; 'failed' only
//    from unpaid/pending) so out-of-order Stripe events can't corrupt an
//    order's payment state;
//  - create-intent is owner-checked, refuses cancelled/paid orders, and
//    reuses the order's live intent instead of minting orphans.
const repo = new FakeRepository();
const stripe = new FakeStripeService();
const app = createApp({ env: testEnv(), repo, verifyToken: fakeVerifyToken, stripe });

const checkoutBody = {
  customerName: 'Jane Guest', customerEmail: 'jane@example.com',
  address: { line1: '1 Forest Way', city: 'Portland' },
  items: [{ menuItemId: 1, quantity: 2 }],
};

async function createOrder(token?: string) {
  let req = request(app).post('/api/v1/orders').send(checkoutBody);
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  const res = await req;
  expect(res.status).toBe(201);
  return res.body.order as { id: string; userId: string | null; paymentStatus: string; paymentIntentId: string | null };
}

function createIntent(orderId: string, token?: string) {
  let req = request(app).post('/api/v1/payments/create-intent').send({ orderId });
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  return req;
}

function webhook(type: string, paymentIntentId: string) {
  return request(app)
    .post('/api/v1/payments/webhook')
    .set('stripe-signature', 'valid-sig')
    .set('Content-Type', 'application/json')
    .send(JSON.stringify({ type, paymentIntentId }));
}

describe('webhook payment state machine', () => {
  it('a failed event arriving AFTER succeeded leaves the order paid', async () => {
    const order = await createOrder();
    const intent = await createIntent(order.id);
    expect(intent.status).toBe(200);
    const pi = intent.body.paymentIntentId as string;

    expect((await webhook('payment_intent.succeeded', pi)).status).toBe(200);
    expect((await repo.getOrder(order.id))?.paymentStatus).toBe('paid');

    // Stripe does not guarantee delivery order — the late failure must be
    // absorbed by the guard, not flip the order back.
    expect((await webhook('payment_intent.payment_failed', pi)).status).toBe(200);
    expect((await repo.getOrder(order.id))?.paymentStatus).toBe('paid');
  });

  it('succeeded arriving after failed marks the order paid (card retry recovery)', async () => {
    const order = await createOrder();
    const intent = await createIntent(order.id);
    const pi = intent.body.paymentIntentId as string;

    expect((await webhook('payment_intent.payment_failed', pi)).status).toBe(200);
    expect((await repo.getOrder(order.id))?.paymentStatus).toBe('failed');

    expect((await webhook('payment_intent.succeeded', pi)).status).toBe(200);
    expect((await repo.getOrder(order.id))?.paymentStatus).toBe('paid');
  });

  it('duplicate succeeded deliveries are harmless', async () => {
    const order = await createOrder();
    const intent = await createIntent(order.id);
    const pi = intent.body.paymentIntentId as string;

    expect((await webhook('payment_intent.succeeded', pi)).status).toBe(200);
    const dup = await webhook('payment_intent.succeeded', pi);
    expect(dup.status).toBe(200);
    expect(dup.body).toEqual({ received: true });
    expect((await repo.getOrder(order.id))?.paymentStatus).toBe('paid');
  });

  it('an event for an unknown payment intent acks 200 and changes no order state', async () => {
    const order = await createOrder();
    const res = await webhook('payment_intent.succeeded', 'pi_totally_unknown');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    const after = await repo.getOrder(order.id);
    expect(after?.paymentStatus).toBe(order.paymentStatus);
    expect(after?.paymentIntentId).toBeNull();
  });
});

describe('create-intent hardening', () => {
  it('refuses payment for a cancelled order', async () => {
    const order = await createOrder();
    await repo.updateOrderStatus(order.id, 'cancelled');
    const intentsBefore = stripe.intents.size;
    const res = await createIntent(order.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cancelled/);
    // Refused BEFORE any intent was minted.
    expect(stripe.intents.size).toBe(intentsBefore);
  });

  it('a second create-intent returns the SAME intent and leaves the pointer unchanged', async () => {
    const order = await createOrder();
    const first = await createIntent(order.id);
    expect(first.status).toBe(200);
    const intentsBefore = stripe.intents.size;

    const second = await createIntent(order.id);
    expect(second.status).toBe(200);
    expect(second.body.paymentIntentId).toBe(first.body.paymentIntentId);
    expect(second.body.clientSecret).toBe(first.body.clientSecret);
    // No new intent was minted and the order still points at the first one.
    expect(stripe.intents.size).toBe(intentsBefore);
    expect((await repo.getOrder(order.id))?.paymentIntentId).toBe(first.body.paymentIntentId);
  });

  it('mints a replacement when the stored intent is in a terminal state', async () => {
    const order = await createOrder();
    const first = await createIntent(order.id);
    stripe.setIntentStatus(first.body.paymentIntentId as string, 'canceled');

    const second = await createIntent(order.id);
    expect(second.status).toBe(200);
    expect(second.body.paymentIntentId).not.toBe(first.body.paymentIntentId);
    expect((await repo.getOrder(order.id))?.paymentIntentId).toBe(second.body.paymentIntentId);
  });

  it('enforces ownership: stranger and anonymous get 404, owner and staff get 200', async () => {
    const mine = await createOrder('token-user');
    expect(mine.userId).toBe('user-1');

    expect((await createIntent(mine.id, 'token-user2')).status).toBe(404);
    expect((await createIntent(mine.id)).status).toBe(404);
    expect((await createIntent(mine.id, 'token-user')).status).toBe(200);
    expect((await createIntent(mine.id, 'token-staff')).status).toBe(200);
    expect((await createIntent(mine.id, 'token-admin')).status).toBe(200);
  });

  it('a guest order can still be paid without auth', async () => {
    const guest = await createOrder();
    expect(guest.userId).toBeNull();
    const res = await createIntent(guest.id);
    expect(res.status).toBe(200);
    expect(res.body.clientSecret).toContain('_secret_test');
  });

  it('refuses create-intent for an already-paid order', async () => {
    const order = await createOrder();
    const intent = await createIntent(order.id);
    await webhook('payment_intent.succeeded', intent.body.paymentIntentId as string);
    expect((await repo.getOrder(order.id))?.paymentStatus).toBe('paid');
    const res = await createIntent(order.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already been paid/);
  });

  it('recovers when the stored intent no longer exists at Stripe (resource_missing)', async () => {
    const order = await createOrder();
    // Stored pointer to an intent Stripe has never heard of — deleted, or
    // a test-mode intent after the keys rotated to live. The real SDK
    // throws a non-ApiError with code 'resource_missing' on retrieve; the
    // route must treat that as a dead intent, not a 500.
    await repo.setOrderPaymentIntent(order.id, 'pi_gone_missing');
    const intentsBefore = stripe.intents.size;

    const res = await createIntent(order.id);
    expect(res.status).toBe(200);
    expect(res.body.paymentIntentId).not.toBe('pi_gone_missing');
    expect(res.body.clientSecret).toContain('_secret_test');
    // Exactly one replacement was minted and the order now points at it.
    expect(stripe.intents.size).toBe(intentsBefore + 1);
    expect((await repo.getOrder(order.id))?.paymentIntentId).toBe(res.body.paymentIntentId);

    // The replacement is live: a retry reuses it instead of minting again.
    const retry = await createIntent(order.id);
    expect(retry.status).toBe(200);
    expect(retry.body.paymentIntentId).toBe(res.body.paymentIntentId);
    expect(stripe.intents.size).toBe(intentsBefore + 1);
  });

  it('returns 404 for a nonexistent order id', async () => {
    const intentsBefore = stripe.intents.size;
    const res = await createIntent('no-such-order-id');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Order not found');
    expect(stripe.intents.size).toBe(intentsBefore);
  });
});

describe('create-intent with a SUCCEEDED stored intent (webhook still in flight)', () => {
  it('refuses with the already-paid response, mints nothing, leaves pointer and status untouched', async () => {
    const order = await createOrder();
    const first = await createIntent(order.id);
    const pi = first.body.paymentIntentId as string;
    // The customer completed payment against this intent. Stripe shows
    // it succeeded, but the webhook has not landed, so the DB still
    // says 'pending'. Re-entering checkout must NOT fall into the
    // dead-intent replacement branch: moving the pointer would orphan
    // the pending webhook's lookup and strand a paid order at 'unpaid'.
    stripe.setIntentStatus(pi, 'succeeded');
    const intentsBefore = stripe.intents.size;

    const res = await createIntent(order.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already been paid/);
    expect(res.body.clientSecret).toBeUndefined();
    // No replacement was minted and the order still points at the
    // succeeded intent, still awaiting its webhook.
    expect(stripe.intents.size).toBe(intentsBefore);
    const after = await repo.getOrder(order.id);
    expect(after?.paymentIntentId).toBe(pi);
    expect(after?.paymentStatus).toBe('pending');
  });

  it('the webhook for that original intent still settles the order to paid afterwards', async () => {
    const order = await createOrder();
    const first = await createIntent(order.id);
    const pi = first.body.paymentIntentId as string;
    stripe.setIntentStatus(pi, 'succeeded');
    expect((await createIntent(order.id)).status).toBe(400);

    expect((await webhook('payment_intent.succeeded', pi)).status).toBe(200);
    expect((await repo.getOrder(order.id))?.paymentStatus).toBe('paid');
  });
});

describe('setOrderPaymentIntent conditional write (data layer)', () => {
  it('stores the intent on an unpaid order', async () => {
    const order = await createOrder();
    await expect(repo.setOrderPaymentIntent(order.id, 'pi_manual')).resolves.toBe(true);
    const after = await repo.getOrder(order.id);
    expect(after?.paymentIntentId).toBe('pi_manual');
    expect(after?.paymentStatus).toBe('pending');
  });

  it('does not touch a paid order — neither pointer nor status regresses', async () => {
    const order = await createOrder();
    const intent = await createIntent(order.id);
    const pi = intent.body.paymentIntentId as string;
    await webhook('payment_intent.succeeded', pi);
    expect((await repo.getOrder(order.id))?.paymentStatus).toBe('paid');

    await expect(repo.setOrderPaymentIntent(order.id, 'pi_intruder')).resolves.toBe(false);
    const after = await repo.getOrder(order.id);
    expect(after?.paymentIntentId).toBe(pi);
    expect(after?.paymentStatus).toBe('paid');
  });

  it('does not touch a cancelled order', async () => {
    const order = await createOrder();
    await repo.updateOrderStatus(order.id, 'cancelled');
    await expect(repo.setOrderPaymentIntent(order.id, 'pi_intruder')).resolves.toBe(false);
    const after = await repo.getOrder(order.id);
    expect(after?.paymentIntentId).toBeNull();
    expect(after?.paymentStatus).toBe('unpaid');
  });
});

describe('create-intent when the intent store is refused (state moved mid-request)', () => {
  // Each test drives its own repo/app pair whose setOrderPaymentIntent
  // is wrapped to land a state change in the window between the
  // route's read of the order and its store of the minted intent.
  function racingApp(wrap: (r: FakeRepository) => void) {
    const r = new FakeRepository();
    const s = new FakeStripeService();
    wrap(r);
    return { repo: r, app: createApp({ env: testEnv(), repo: r, verifyToken: fakeVerifyToken, stripe: s }) };
  }

  async function createOrderOn(appInstance: ReturnType<typeof createApp>) {
    const res = await request(appInstance).post('/api/v1/orders').send(checkoutBody);
    expect(res.status).toBe(201);
    return res.body.order as { id: string };
  }

  it('answers 409 when the store is refused and the order is neither paid nor cancelled', async () => {
    const { app: racing } = racingApp((r) => {
      r.setOrderPaymentIntent = async () => false;
    });
    const order = await createOrderOn(racing);
    const res = await request(racing).post('/api/v1/payments/create-intent').send({ orderId: order.id });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/changed.*retry/);
    // No client secret is handed out for an intent that was never stored.
    expect(res.body.clientSecret).toBeUndefined();
  });

  it('answers already-paid when a webhook settles the order between read and store', async () => {
    const { app: racing } = racingApp((r) => {
      const real = r.setOrderPaymentIntent.bind(r);
      r.setOrderPaymentIntent = async (orderId: string, paymentIntentId: string) => {
        const o = await r.getOrder(orderId);
        if (o) o.paymentStatus = 'paid';
        return real(orderId, paymentIntentId);
      };
    });
    const order = await createOrderOn(racing);
    const res = await request(racing).post('/api/v1/payments/create-intent').send({ orderId: order.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already been paid/);
    expect(res.body.clientSecret).toBeUndefined();
  });

  it('answers cancelled when the order is cancelled between read and store', async () => {
    const { app: racing } = racingApp((r) => {
      const real = r.setOrderPaymentIntent.bind(r);
      r.setOrderPaymentIntent = async (orderId: string, paymentIntentId: string) => {
        await r.updateOrderStatus(orderId, 'cancelled');
        return real(orderId, paymentIntentId);
      };
    });
    const order = await createOrderOn(racing);
    const res = await request(racing).post('/api/v1/payments/create-intent').send({ orderId: order.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cancelled/);
    expect(res.body.clientSecret).toBeUndefined();
  });
});
