import { ApiError } from '../src/lib/errors';
import type { StripeService } from '../src/lib/stripe';

interface FakeIntentRecord {
  orderId: string;
  amountCents: number;
  currency: string;
  idempotencyKey: string;
  status: string;
}

export class FakeStripeService implements StripeService {
  intents = new Map<string, FakeIntentRecord>();
  /** Idempotency keys that already produced an intent — Stripe dedupes creates on the key. */
  private byIdempotencyKey = new Map<string, string>();
  private seq = 0;

  async createPaymentIntent(input: { orderId: string; amountCents: number; currency: string; idempotencyKey: string }) {
    const existingId = this.byIdempotencyKey.get(input.idempotencyKey);
    if (existingId) return { id: existingId, clientSecret: `${existingId}_secret_test` };
    const id = `pi_${++this.seq}`;
    this.intents.set(id, { ...input, status: 'requires_payment_method' });
    this.byIdempotencyKey.set(input.idempotencyKey, id);
    return { id, clientSecret: `${id}_secret_test` };
  }

  async retrievePaymentIntent(id: string) {
    const intent = this.intents.get(id);
    if (!intent) {
      // Mimic the real Stripe SDK's missing-resource failure: a plain
      // Error carrying code 'resource_missing' — NOT an ApiError. The
      // create-intent route keys its dead-intent recovery off this code.
      const err = new Error(`No such payment_intent: '${id}'`) as Error & { code: string };
      err.code = 'resource_missing';
      throw err;
    }
    return { id, clientSecret: `${id}_secret_test`, status: intent.status };
  }

  /** Test helper: force a stored intent into another lifecycle state (e.g. 'canceled'). */
  setIntentStatus(id: string, status: string) {
    const intent = this.intents.get(id);
    if (intent) intent.status = status;
  }

  constructEvent(payload: Buffer, signature: string) {
    if (signature !== 'valid-sig') throw new ApiError(400, 'Invalid webhook signature');
    const parsed = JSON.parse(payload.toString('utf8')) as { type: string; paymentIntentId: string };
    return { type: parsed.type, paymentIntentId: parsed.paymentIntentId };
  }
}
