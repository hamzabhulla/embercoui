import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ApiError, notConfigured } from '../lib/errors';
import { optionalAuth, requireAuth, type AuthedRequest } from '../lib/auth';
import type { TokenVerifier } from '../lib/auth';
import { toMinorUnits } from '../lib/currency';
import { effectiveReservationFee } from '../lib/reservationFee';
import type { StripeService } from '../lib/stripe';
import { validateBody } from '../middleware/validate';
import type { Repository, ReservationDTO } from '../repositories/types';

const formLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many submissions — please try again in a few minutes' },
});

// 254 is the maximum length of a valid email address (RFC 5321) — anything
// longer is not a real address, just payload.
const email = z.string().trim().min(1, 'Email is required').max(254).email('Invalid email format');

/**
 * THE reservation rules — one schema for every surface that takes a
 * booking (the website form, Ember AI). Exported so no caller ever
 * re-derives a field rule of its own.
 */
export const reservationSchema = z.object({
  name: z.string().trim().min(1, 'Full name is required').max(120),
  email,
  phone: z.string().trim().min(7, 'Phone number is required').max(32),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date is required').refine((v) => {
    const [y, m, d] = v.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'Please choose a valid date').refine((v) => {
    // Not in the past. Reservation dates are plain local date strings, and
    // the string compare is exact for YYYY-MM-DD. "Today" is the server's
    // current UTC date — a booking for today is always allowed, anything
    // earlier names a day the kitchen can no longer honour. Malformed
    // values pass here so the checks above report them instead.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return true;
    return v >= new Date().toISOString().slice(0, 10);
  }, 'Please choose a date that is not in the past'),
  time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time is required').refine((v) => {
    const [h, m] = v.split(':').map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }, 'Please choose a valid time'),
  guests: z.coerce.number().int('Guests must be a whole number').min(1, 'Guests must be at least 1').max(20, 'For parties over 20, please contact us directly'),
});

const newsletterSchema = z.object({ email });
const contactSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  email,
  phone: z.string().trim().optional(),
  subject: z.string().trim().max(120).optional(),
  message: z.string().trim().min(1, 'Message is required').max(2000),
});
const reviewSchema = z.object({
  rating: z.coerce.number().int().min(1, 'Please choose a star rating').max(5),
  comment: z.string().trim().min(3, 'Please write a few words about your visit').max(1000),
  country: z.string().trim().max(80).optional(),
});

/** The card step a fee booking hands its guest, exactly as the form's response has always carried it. */
export interface ReservationFeePayment {
  clientSecret: string;
  paymentIntentId: string;
  amount: number;
  currency: string;
}

export interface ReservationCreation {
  reservation: ReservationDTO;
  /**
   * The fee's card step when one was set up; null for a free booking —
   * and for the race where the webhook settled the fee before the
   * intent could be stored, in which case `reservation` is the current
   * (paid) row and there is nothing left for the guest to pay.
   */
  feePayment: ReservationFeePayment | null;
}

/**
 * THE reservation creation flow — the one path every surface books
 * through (the website form, Ember AI), so a booking is a booking
 * however the guest makes it: same fee rule, same repository write,
 * same intent discipline. Failures behave exactly as the form route
 * always presented them — provider errors are rethrown AFTER the fee
 * compensation, and the one mid-flight race is an ApiError(409) —
 * callers decide how to present the failure to their guest.
 */
export async function createReservationWithFee(
  deps: { repo: Repository; stripe: StripeService | null },
  input: { userId: string | null; name: string; email: string; phone: string; date: string; time: string; guests: number },
): Promise<ReservationCreation> {
  const repo = deps.repo;
  // Fee compensation (marking a fee booking 'failed' when its
  // payment could not be set up) is best-effort: it must never mask
  // the original failure, which is what the guest is told about.
  // But a SILENT swallow would hide a booking left stuck 'pending'
  // from the operator — so a failed compensation is logged, the
  // same posture as the audit / auth-event best-effort paths.
  const failFeeWithLog = async (reservationId: string) => {
    try {
      await repo.failReservationFee(reservationId);
    } catch (err) {
      console.error(`[ember] reservation fee compensation failed for reservation ${reservationId}:`, err instanceof Error ? err.message : err);
    }
  };

  // The fee a guest pays is computed HERE, from the live settings
  // and whether a card provider actually exists — the caller's input
  // carries no fee fields and none would be trusted if it did. No
  // effective fee → the booking is exactly the pre-fee one.
  const settings = await repo.getSettings();
  const fee = effectiveReservationFee(settings, deps.stripe != null);
  // Build the repository input field by field instead of spreading
  // the caller's object: the explicit literal is a ReservationInput
  // under any TS config (z.infer types only keep their properties
  // required under strict configs, and not every toolchain that
  // compiles this file preserves them), and it documents exactly
  // what the repository receives.
  const reservation = await repo.createReservation({
    userId: input.userId,
    name: input.name,
    email: input.email,
    phone: input.phone,
    date: input.date,
    time: input.time,
    guests: input.guests,
    fee,
  });
  if (!fee) return { reservation, feePayment: null };
  // Fee booking, the order flow's Fix 1 discipline in one request:
  // the row exists owing its fee ('pending'), the intent is minted
  // against it (idempotency-keyed by the reservation, so a retried
  // submit Stripe-side dedupes), and the intent is stored
  // CONDITIONALLY — only while the fee is still pending. The
  // webhook is the only path that ever marks the fee paid, and
  // only a paid fee booking holds its slot.
  const stripe = deps.stripe as StripeService;
  let intent: Awaited<ReturnType<StripeService['createReservationFeePaymentIntent']>>;
  try {
    intent = await stripe.createReservationFeePaymentIntent({
      reservationId: reservation.id,
      amountCents: toMinorUnits(fee.amount, fee.currency),
      currency: fee.currency.toLowerCase(),
      idempotencyKey: `reservation-fee-${reservation.id}`,
    });
  } catch (err) {
    // The row exists but its charge can never be set up: fail the
    // fee (best effort) so the booking reads honestly — it holds
    // no seats — instead of awaiting a payment that cannot start.
    await failFeeWithLog(reservation.id);
    throw err;
  }
  let stored: boolean;
  try {
    stored = await repo.setReservationFeePaymentIntent(reservation.id, intent.id);
  } catch (err) {
    await failFeeWithLog(reservation.id);
    throw err;
  }
  if (!stored) {
    // The fee's state moved on between create and store (a webhook
    // settling it instantly is the only realistic race). Answer
    // for the CURRENT state, never hand out a client secret for
    // an intent that was never stored.
    const current = await repo.getReservation(reservation.id);
    if (current && current.feePaymentStatus === 'paid') {
      return { reservation: current, feePayment: null };
    }
    throw new ApiError(409, 'Your booking changed while payment was being set up — please try again');
  }
  return {
    reservation,
    feePayment: {
      clientSecret: intent.clientSecret,
      paymentIntentId: intent.id,
      amount: fee.amount,
      currency: fee.currency,
    },
  };
}

export function formsRouter(deps: { repo: Repository | null; verifyToken: TokenVerifier; stripe?: StripeService | null; stripeConfigured?: boolean }) {
  const router = Router();
  const repo = () => {
    if (!deps.repo) throw notConfigured();
    return deps.repo;
  };

  router.post('/reservations', formLimiter, optionalAuth(deps), validateBody(reservationSchema), async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body as z.infer<typeof reservationSchema>;
      // Creation itself lives in createReservationWithFee (shared
      // with Ember AI); this handler only maps its outcome onto the
      // form's response shape — { reservation } for a free booking,
      // { reservation, feePayment } when a fee's card step is owed.
      const { reservation, feePayment } = await createReservationWithFee(
        // Mega-audit M2 coherence: the fee predicate inside the flow
        // reads the SERVICE's presence, so a raw service must not be
        // handed over when the (corrected) configured flag says the
        // provider cannot settle (key-only) — the booking stays free
        // exactly as the public settings/chat/GEO surfaces report.
        // Default (flag unpassed) preserves the historical behaviour.
        { repo: repo(), stripe: (deps.stripeConfigured ?? true) ? (deps.stripe ?? null) : null },
        {
          userId: req.user?.id ?? null,
          name: body.name,
          email: body.email,
          phone: body.phone,
          date: body.date,
          time: body.time,
          guests: body.guests,
        },
      );
      if (!feePayment) {
        res.status(201).json({ reservation });
        return;
      }
      res.status(201).json({ reservation, feePayment });
    } catch (err) { next(err); }
  });

  router.post('/newsletter', formLimiter, validateBody(newsletterSchema), async (req, res, next) => {
    try {
      const { email: rawEmail } = req.body as z.infer<typeof newsletterSchema>;
      const result = await repo().addNewsletterSubscriber(rawEmail.toLowerCase());
      res.json({ subscribed: true, alreadySubscribed: result.alreadySubscribed });
    } catch (err) { next(err); }
  });

  router.post('/contact', formLimiter, validateBody(contactSchema), async (req, res, next) => {
    try {
      await repo().createContactMessage(req.body);
      res.status(201).json({ received: true });
    } catch (err) { next(err); }
  });

  router.post('/reviews', formLimiter, requireAuth(deps), validateBody(reviewSchema), async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body as z.infer<typeof reviewSchema>;
      const name = req.user!.profile.fullName || req.user!.email?.split('@')[0] || 'Guest';
      const review = await repo().createReview({
        userId: req.user!.id, name, rating: body.rating, comment: body.comment, country: body.country ?? null,
      });
      res.status(201).json({ review, message: 'Thank you — your review was submitted for moderation.' });
    } catch (err) { next(err); }
  });

  return router;
}
