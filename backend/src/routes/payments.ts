import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { ApiError, notConfigured, stripeNotConfigured } from '../lib/errors';
import type { StripeService } from '../lib/stripe';
import { validateBody } from '../middleware/validate';
import type { Repository } from '../repositories/types';

interface PaymentDeps {
  repo: Repository | null;
  stripe: StripeService | null;
}

const intentSchema = z.object({ orderId: z.string().min(1, 'Order id is required') });

export function paymentsRouter(deps: PaymentDeps) {
  const router = Router();

  router.post('/payments/create-intent', validateBody(intentSchema), async (req, res, next) => {
    try {
      if (!deps.repo) throw notConfigured();
      if (!deps.stripe) throw stripeNotConfigured();
      const { orderId } = req.body as z.infer<typeof intentSchema>;
      const order = await deps.repo.getOrder(orderId);
      if (!order) throw new ApiError(404, 'Order not found');
      if (order.paymentStatus === 'paid') throw new ApiError(400, 'This order has already been paid');
      if (Math.round(order.total * 100) < 50) {
        throw new ApiError(400, 'This order total is below the card payment minimum — please pay on delivery instead');
      }
      const intent = await deps.stripe.createPaymentIntent({
        orderId: order.id,
        amountCents: Math.round(order.total * 100),
        currency: 'usd',
      });
      await deps.repo.setOrderPaymentIntent(order.id, intent.id);
      res.json({ clientSecret: intent.clientSecret, paymentIntentId: intent.id });
    } catch (err) { next(err); }
  });

  return router;
}

/** Mounted in app.ts BEFORE the JSON parser — Stripe needs the raw body. */
export function createWebhookHandler(deps: PaymentDeps): RequestHandler {
  return async (req, res, next) => {
    try {
      if (!deps.stripe) throw stripeNotConfigured();
      if (!deps.repo) throw notConfigured();
      const signature = req.header('stripe-signature');
      if (!signature) throw new ApiError(400, 'Missing Stripe signature');
      const event = deps.stripe.constructEvent(req.body as Buffer, signature);
      if (event.paymentIntentId) {
        if (event.type === 'payment_intent.succeeded') {
          // The webhook is the ONLY path that marks an order paid.
          await deps.repo.markOrderPaidByPaymentIntent(event.paymentIntentId);
        } else if (event.type === 'payment_intent.payment_failed') {
          await deps.repo.markOrderPaymentFailedByPaymentIntent(event.paymentIntentId);
        }
      }
      res.json({ received: true });
    } catch (err) { next(err); }
  };
}
