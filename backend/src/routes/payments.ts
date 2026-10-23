import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { ApiError, notConfigured, stripeNotConfigured } from '../lib/errors';
import type { RetrievedPaymentIntent, StripeService } from '../lib/stripe';
import { optionalAuth, type AuthedRequest, type TokenVerifier } from '../lib/auth';
import { validateBody } from '../middleware/validate';
import { cardMinimumMinorUnits, sanitizeCurrencyCode, toMinorUnits } from '../lib/currency';
import type { AuditEventInput, OrderDTO, Repository } from '../repositories/types';

interface PaymentDeps {
  repo: Repository | null;
  stripe: StripeService | null;
  verifyToken: TokenVerifier;
  /**
   * The corrected configured flag (mega-audit M2: secret key AND
   * webhook secret). When explicitly false, a raw service object
   * must not mint or settle anything — the provider cannot settle.
   * Unpassed preserves the historical service-presence behaviour.
   */
  stripeConfigured?: boolean;
}

const intentSchema = z.object({ orderId: z.string().min(1, 'Order id is required') });

/**
 * Stripe intent states in which the customer can still complete payment.
 * Of the terminal states, 'canceled' means the intent is dead and gets
 * exactly one replacement below. 'succeeded' is NOT dead — the customer
 * has paid and only the webhook is outstanding — so it is handled
 * explicitly in the stored-intent block and never replaced.
 */
const PAYABLE_INTENT_STATUSES = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing']);

export function paymentsRouter(deps: PaymentDeps) {
  const router = Router();

  router.post('/payments/create-intent', optionalAuth(deps), validateBody(intentSchema), async (req: AuthedRequest, res, next) => {
    try {
      if (!deps.repo) throw notConfigured();
      if (!deps.stripe || deps.stripeConfigured === false) throw stripeNotConfigured();
      const repo = deps.repo;
      const { orderId } = req.body as z.infer<typeof intentSchema>;
      const order = await repo.getOrder(orderId);
      if (!order) throw new ApiError(404, 'Order not found');
      // Account orders may only be paid by their owner (or staff/admin) —
      // the same privacy pattern as GET /orders/:id: strangers get a 404,
      // never a 403 that would confirm the order exists.
      if (order.userId) {
        const isOwner = req.user?.id === order.userId;
        const isStaff = req.user?.role === 'admin' || req.user?.role === 'staff' || req.user?.role === 'manager';
        if (!isOwner && !isStaff) throw new ApiError(404, 'Order not found');
      }
      if (order.status === 'cancelled') {
        throw new ApiError(400, 'This order has been cancelled and can no longer be paid');
      }
      if (order.paymentStatus === 'paid') throw new ApiError(400, 'This order has already been paid');
      // Charge in the currency the order was PLACED in (snapshotted on the
      // order), never the restaurant's current one — and convert with that
      // currency's real exponent (JPY totals stay whole, KWD gets ×1000).
      const currency = sanitizeCurrencyCode(order.currency);
      const amountMinor = toMinorUnits(order.total, currency);
      if (amountMinor < cardMinimumMinorUnits(currency)) {
        throw new ApiError(400, 'This order total is below the card payment minimum — please pay on delivery instead');
      }

      // Storing an intent is conditional at the data layer: the write
      // applies only while the order is still unpaid-or-in-flight and
      // not cancelled. If it reports "not stored", the order's state
      // moved on after the read above (a webhook landing mid-request
      // is the realistic race) — never hand out a client secret for an
      // intent that was never stored; re-read and answer for the
      // order's CURRENT state instead.
      const storeIntent = async (paymentIntentId: string): Promise<void> => {
        if (await repo.setOrderPaymentIntent(order.id, paymentIntentId)) return;
        const current = await repo.getOrder(order.id);
        if (!current) throw new ApiError(404, 'Order not found');
        if (current.paymentStatus === 'paid') throw new ApiError(400, 'This order has already been paid');
        if (current.status === 'cancelled') {
          throw new ApiError(400, 'This order has been cancelled and can no longer be paid');
        }
        throw new ApiError(409, 'This order changed while payment was being set up — please retry');
      };

      // Idempotency: an order keeps ONE live intent. If the stored intent
      // is still payable, hand back its client secret — minting a second
      // intent would orphan the first (a payment completed against it
      // could never be matched to this order by the webhook).
      if (order.paymentIntentId) {
        let existing: RetrievedPaymentIntent | null = null;
        try {
          existing = await deps.stripe.retrievePaymentIntent(order.paymentIntentId);
        } catch (err) {
          // The real Stripe SDK throws a plain (non-ApiError) error with
          // code 'resource_missing' when the stored intent no longer
          // exists — deleted, or a test-mode intent after the keys rotate
          // to live. That intent is DEAD: fall through to the replacement
          // branch below instead of 500ing on every retry. Any other
          // retrieve error still propagates.
          if ((err as { code?: unknown } | null)?.code !== 'resource_missing') throw err;
        }
        if (existing && PAYABLE_INTENT_STATUSES.has(existing.status) && existing.clientSecret) {
          res.json({ clientSecret: existing.clientSecret, paymentIntentId: existing.id });
          return;
        }
        if (existing && existing.status === 'succeeded') {
          // The customer HAS paid — only the webhook is outstanding, so
          // the DB flag above has not flipped yet. Never replace a
          // succeeded intent and never move the pointer: the pending
          // webhook reconciles by intent id, so pointing the order at a
          // fresh intent would leave the webhook lookup empty-handed
          // and strand a paid order at 'unpaid' forever. Answer exactly
          // like the already-paid guard above; the webhook settles it.
          throw new ApiError(400, 'This order has already been paid');
        }
        // The stored intent is dead (e.g. canceled): mint ONE replacement
        // and move the pointer. The idempotency key names the dead intent,
        // so a retried request reuses this same replacement.
        const replacement = await deps.stripe.createPaymentIntent({
          orderId: order.id,
          amountCents: amountMinor,
          currency: currency.toLowerCase(),
          idempotencyKey: `order-${order.id}-${order.paymentIntentId}`,
        });
        await storeIntent(replacement.id);
        res.json({ clientSecret: replacement.clientSecret, paymentIntentId: replacement.id });
        return;
      }

      const intent = await deps.stripe.createPaymentIntent({
        orderId: order.id,
        amountCents: amountMinor,
        currency: currency.toLowerCase(),
        idempotencyKey: `order-${order.id}`,
      });
      await storeIntent(intent.id);
      res.json({ clientSecret: intent.clientSecret, paymentIntentId: intent.id });
    } catch (err) { next(err); }
  });

  return router;
}

/**
 * Honest handling for money that genuinely arrived on a CANCELLED
 * order/reservation (mega-audit M1): the guarded repository
 * transitions refuse to mark it paid (so it is never counted as
 * revenue and never holds seats), but the charge is REAL — the owner
 * must be able to see it and refund it. This records a server-side
 * audit event in Security & Activity: no human actor (actorId null —
 * audit_events.actor_id deliberately has no FK and null-actor rows
 * are precedented), labelled truthfully as the Stripe webhook, with
 * a `<entity>.<past-tense>` action that lands in the 'change'
 * category (anything not auth.*). Best-effort by design, following
 * lib/audit.ts's swallow-after-log philosophy: a failed marker write
 * (including the pre-0012 database, where insertAuditEvent degrades
 * to a no-op) must never fail the webhook response — Stripe still
 * gets its 200 ack. The loud console trace fires either way.
 */
async function recordPaymentOnCancelled(repo: Repository, input: AuditEventInput): Promise<void> {
  console.warn(`[payments] webhook payment_intent.succeeded settled a payment on cancelled ${input.entity} ${input.entityId} — not counted as revenue; the owner must refund it via the Stripe dashboard`);
  try {
    await repo.insertAuditEvent(input);
  } catch (err) {
    console.error('[payments] webhook payment-on-cancelled marker failed:', err instanceof Error ? err.message : err);
  }
}

/** Mounted in app.ts BEFORE the JSON parser — Stripe needs the raw body. */
export function createWebhookHandler(deps: Pick<PaymentDeps, 'repo' | 'stripe' | 'stripeConfigured'>): RequestHandler {
  return async (req, res, next) => {
    try {
      if (!deps.stripe || deps.stripeConfigured === false) throw stripeNotConfigured();
      if (!deps.repo) throw notConfigured();
      const signature = req.header('stripe-signature');
      if (!signature) throw new ApiError(400, 'Missing Stripe signature');
      const event = deps.stripe.constructEvent(req.body as Buffer, signature);
      const isPaymentEvent = event.type === 'payment_intent.succeeded' || event.type === 'payment_intent.payment_failed';
      if (event.paymentIntentId && isPaymentEvent) {
        // Routing is by the intent's metadata (lib/stripe.ts):
        // 'reservation_fee' is a Phase F booking fee; NO type is the
        // order flow's shape (its intents carry only { orderId });
        // any other type is a foreign purpose sharing this Stripe
        // account — acked and left completely untouched.
        const intentType = event.metadata?.type;
        if (intentType === 'reservation_fee') {
          // The webhook is the ONLY path that marks a fee paid.
          const reservation = event.type === 'payment_intent.succeeded'
            ? await deps.repo.markReservationFeePaidByPaymentIntent(event.paymentIntentId)
            : await deps.repo.markReservationFeeFailedByPaymentIntent(event.paymentIntentId);
          if (reservation === null) {
            // No reservation references this intent (created outside
            // this system, or the row is gone). Ack with 200 anyway —
            // Stripe must not retry forever — but leave a trace so the
            // payment can be reconciled by hand.
            console.warn(`[payments] webhook ${event.type} referenced unknown reservation fee intent ${event.paymentIntentId}`);
          } else if (event.type === 'payment_intent.succeeded' && reservation.status === 'cancelled' && reservation.feePaymentStatus !== 'paid') {
            // The fee's money arrived but the booking is cancelled:
            // the guarded transition refused to mark it paid. Record
            // it for the owner (M1 analogue) — never silently.
            await recordPaymentOnCancelled(deps.repo, {
              actorId: null,
              actorLabel: 'Stripe webhook',
              actorRole: null,
              action: 'reservation.payment_on_cancelled',
              entity: 'reservation',
              entityId: reservation.id,
              summary: `Booking fee of ${reservation.feeCurrency ?? ''} ${reservation.feeAmount ?? ''} received for a cancelled reservation — not counted as revenue. Refund the payment from the Stripe dashboard.`,
              changes: null,
              ip: null,
              userAgent: null,
            });
          }
        } else if (!intentType) {
          let order: OrderDTO | null = null;
          if (event.type === 'payment_intent.succeeded') {
            // The webhook is the ONLY path that marks an order paid.
            order = await deps.repo.markOrderPaidByPaymentIntent(event.paymentIntentId);
          } else {
            order = await deps.repo.markOrderPaymentFailedByPaymentIntent(event.paymentIntentId);
          }
          if (order === null) {
            // No order references this intent (created outside this system,
            // or the order row is gone). Ack with 200 anyway — Stripe must
            // not retry forever — but leave a server-side trace so the
            // payment can be reconciled by hand.
            console.warn(`[payments] webhook ${event.type} referenced unknown payment intent ${event.paymentIntentId}`);
          } else if (event.type === 'payment_intent.succeeded' && order.status === 'cancelled' && order.paymentStatus !== 'paid') {
            // The money genuinely arrived but the order is cancelled:
            // the guarded transition refused to mark it paid, so it is
            // NOT revenue. Record it for the owner instead of letting
            // it vanish (mega-audit M1) — the refund path is the
            // Stripe dashboard, exactly as the admin cancel copy says.
            await recordPaymentOnCancelled(deps.repo, {
              actorId: null,
              actorLabel: 'Stripe webhook',
              actorRole: null,
              action: 'order.payment_on_cancelled',
              entity: 'order',
              entityId: order.id,
              summary: `Payment of ${order.currency} ${order.total} received for a cancelled order — not counted as revenue. Refund the payment from the Stripe dashboard.`,
              changes: null,
              ip: null,
              userAgent: null,
            });
          }
        }
      }
      res.json({ received: true });
    } catch (err) { next(err); }
  };
}
