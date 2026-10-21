import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { notConfigured } from '../lib/errors';
import { optionalAuth, requireAuth, type AuthedRequest } from '../lib/auth';
import type { TokenVerifier } from '../lib/auth';
import { validateBody } from '../middleware/validate';
import type { Repository } from '../repositories/types';

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

const reservationSchema = z.object({
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

export function formsRouter(deps: { repo: Repository | null; verifyToken: TokenVerifier }) {
  const router = Router();
  const repo = () => {
    if (!deps.repo) throw notConfigured();
    return deps.repo;
  };

  router.post('/reservations', formLimiter, optionalAuth(deps), validateBody(reservationSchema), async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body as z.infer<typeof reservationSchema>;
      const reservation = await repo().createReservation({ ...body, userId: req.user?.id ?? null });
      res.status(201).json({ reservation });
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
