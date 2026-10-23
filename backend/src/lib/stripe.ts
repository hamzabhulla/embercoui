import Stripe from 'stripe';
import { ApiError } from './errors';

export interface StripeEventLike {
  type: string;
  paymentIntentId: string | null;
  /**
   * The intent's Stripe metadata, when the event carries a payment
   * intent. The webhook routes on it: `type: 'reservation_fee'`
   * marks one of OUR fee intents (lib/reservationFee.ts flow); no
   * type at all is the order flow's shape (metadata { orderId });
   * any other type is a foreign purpose sharing the Stripe account
   * and is left untouched.
   */
  metadata: Record<string, string>;
}

export interface CreatedPaymentIntent {
  id: string;
  clientSecret: string;
}

export interface RetrievedPaymentIntent {
  id: string;
  clientSecret: string | null;
  /** Stripe lifecycle status, e.g. 'requires_payment_method', 'processing', 'succeeded', 'canceled'. */
  status: string;
}

export interface StripeService {
  createPaymentIntent(input: { orderId: string; amountCents: number; currency: string; idempotencyKey: string }): Promise<CreatedPaymentIntent>;
  /** A reservation-fee intent (Phase F): the metadata is what routes its webhook events to the fee flow. */
  createReservationFeePaymentIntent(input: { reservationId: string; amountCents: number; currency: string; idempotencyKey: string }): Promise<CreatedPaymentIntent>;
  retrievePaymentIntent(id: string): Promise<RetrievedPaymentIntent>;
  constructEvent(payload: Buffer, signature: string): StripeEventLike;
}

export function createStripeService(secretKey: string, webhookSecret: string | null): StripeService {
  // Bounded HTTP timeout (the SDK default is 80 s — far past the
  // 30 s function cap): a hung Stripe call must fail honestly inside
  // the function's lifetime, chat booking execution included (OPS-M2).
  const stripe = new Stripe(secretKey, { timeout: 10_000 });
  return {
    async createPaymentIntent({ orderId, amountCents, currency, idempotencyKey }) {
      const intent = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency,
          metadata: { orderId },
          automatic_payment_methods: { enabled: true },
        },
        // Stripe dedupes creates carrying the same key for 24h, so a
        // retried request can never mint a second intent for one order.
        { idempotencyKey }
      );
      if (!intent.client_secret) throw new ApiError(500, 'Stripe did not return a client secret');
      return { id: intent.id, clientSecret: intent.client_secret };
    },
    async createReservationFeePaymentIntent({ reservationId, amountCents, currency, idempotencyKey }) {
      const intent = await stripe.paymentIntents.create(
        {
          amount: amountCents,
          currency,
          metadata: { type: 'reservation_fee', reservationId },
          automatic_payment_methods: { enabled: true },
        },
        // Same 24h dedupe as the order flow: a retried booking submit
        // can never mint a second fee intent for one reservation.
        { idempotencyKey }
      );
      if (!intent.client_secret) throw new ApiError(500, 'Stripe did not return a client secret');
      return { id: intent.id, clientSecret: intent.client_secret };
    },
    async retrievePaymentIntent(id) {
      const intent = await stripe.paymentIntents.retrieve(id);
      return { id: intent.id, clientSecret: intent.client_secret, status: intent.status };
    },
    constructEvent(payload, signature) {
      if (!webhookSecret) throw new ApiError(503, 'Stripe webhook is not configured');
      let event: Stripe.Event;
      try {
        event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
      } catch {
        throw new ApiError(400, 'Invalid webhook signature');
      }
      const obj = event.data.object as {
        id?: string; object?: string; payment_intent?: string | null;
        metadata?: Record<string, string> | null;
      };
      const paymentIntentId =
        obj.object === 'payment_intent' ? (obj.id ?? null) : (obj.payment_intent ?? null);
      // Metadata exists on the payment intent object itself (the only
      // object our payment_intent.* events carry); anything else —
      // charges, missing or malformed values — reads as no metadata,
      // which the webhook treats as the order flow's shape.
      const metadata = obj.object === 'payment_intent' && obj.metadata && typeof obj.metadata === 'object'
        ? obj.metadata
        : {};
      return { type: event.type, paymentIntentId, metadata };
    },
  };
}
