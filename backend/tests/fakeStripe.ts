import { ApiError } from '../src/lib/errors';
import type { StripeService } from '../src/lib/stripe';

export class FakeStripeService implements StripeService {
  intents = new Map<string, { orderId: string; amountCents: number; currency: string }>();
  private seq = 0;

  async createPaymentIntent(input: { orderId: string; amountCents: number; currency: string }) {
    const id = `pi_${++this.seq}`;
    this.intents.set(id, input);
    return { id, clientSecret: `${id}_secret_test` };
  }

  constructEvent(payload: Buffer, signature: string) {
    if (signature !== 'valid-sig') throw new ApiError(400, 'Invalid webhook signature');
    const parsed = JSON.parse(payload.toString('utf8')) as { type: string; paymentIntentId: string };
    return { type: parsed.type, paymentIntentId: parsed.paymentIntentId };
  }
}
