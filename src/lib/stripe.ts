import { loadStripe, type Stripe } from '@stripe/stripe-js';

const publishableKey = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

export const isStripeConfigured = Boolean(publishableKey);

/** Stripe.js singleton (publishable key is browser-safe). Null when unset. */
export const stripePromise: Promise<Stripe | null> | null = publishableKey
  ? loadStripe(publishableKey)
  : null;
