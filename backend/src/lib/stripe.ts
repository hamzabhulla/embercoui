import Stripe from 'stripe';
import { ApiError } from './errors';

export interface StripeEventLike {
  type: string;
  paymentIntentId: string | null;
}

export interface StripeService {
  createPaymentIntent(input: { orderId: string; amountCents: number; currency: string }): Promise<{ id: string; clientSecret: string }>;
  constructEvent(payload: Buffer, signature: string): StripeEventLike;
}

export function createStripeService(secretKey: string, webhookSecret: string | null): StripeService {
  const stripe = new Stripe(secretKey);
  return {
    async createPaymentIntent({ orderId, amountCents, currency }) {
      const intent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency,
        metadata: { orderId },
        automatic_payment_methods: { enabled: true },
      });
      if (!intent.client_secret) throw new ApiError(500, 'Stripe did not return a client secret');
      return { id: intent.id, clientSecret: intent.client_secret };
    },
    constructEvent(payload, signature) {
      if (!webhookSecret) throw new ApiError(503, 'Stripe webhook is not configured');
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
      } catch {
        throw new ApiError(400, 'Invalid webhook signature');
      }
      const obj = event.data.object as { id?: string; object?: string; payment_intent?: string | null };
      const paymentIntentId =
        obj.object === 'payment_intent' ? (obj.id ?? null) : (obj.payment_intent ?? null);
      return { type: event.type, paymentIntentId };
    },
  };
}
