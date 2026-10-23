import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { notConfigured } from '../lib/errors';
import { validateBody } from '../middleware/validate';
import type { Repository } from '../repositories/types';
import { createRateLimitStore, type RateLimitBackend } from '../lib/rateLimitStore';

/**
 * Failed admin sign-in reports (Phase C — Login Activity).
 *
 * A failed password never reaches this backend: the password check
 * happens inside Supabase Auth, so a wrong password dies there. The
 * only way a failure can appear in the activity log is for the
 * /admin/login page to REPORT it after the fact — which makes the
 * report unverified by construction: anyone can claim an attempt
 * happened for any email. The row is written to be read that way
 * (action 'auth.login_failed' — the marker lib/audit.ts and the
 * Security UI use to badge it "Unverified report", never a verified
 * fact), and it carries only the attempted email, the timestamp and
 * the request's IP/UA. Never a password, never a code.
 *
 * The endpoint is public (by definition there is no session yet)
 * and defended accordingly: a tight per-IP budget (5 per 10 minutes)
 * keeps it from becoming a log-spam hose, and the response is the
 * same whether or not the email belongs to a real account — no
 * lookup ever happens, so nothing about the address leaks.
 */
// 254 is the maximum length of a valid email address (RFC 5321).
const loginFailedSchema = z.object({
  email: z.string().trim().min(1, 'Email is required').max(254).email('Invalid email format'),
});

export function authEventsRouter(deps: { repo: Repository | null; rateLimitBackend?: RateLimitBackend | null }) {
  const router = Router();
  // Built per router (not module-level): the limiter's store belongs
  // to the app instance, so separate apps never share a budget —
  // unless they share the OPS-M1 backend, which is the point of it.
  const loginFailedLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: createRateLimitStore('failed-login:', deps.rateLimitBackend ?? null),
    message: { error: 'Too many reports — please try again in a few minutes' },
  });
  router.post('/auth/admin-login-failed', loginFailedLimiter, validateBody(loginFailedSchema), async (req, res, next) => {
    try {
      if (!deps.repo) throw notConfigured();
      const email = (req.body as z.infer<typeof loginFailedSchema>).email.toLowerCase();
      try {
        await deps.repo.insertAuditEvent({
          actorId: null,
          actorLabel: email,
          actorRole: null,
          action: 'auth.login_failed',
          entity: null,
          entityId: null,
          summary: 'Failed admin sign-in attempt (client report — unverified)',
          changes: null,
          ip: req.ip ?? null,
          userAgent: req.header('user-agent') ?? null,
        });
      } catch (err) {
        // Best-effort, like every audit write (insertAuditEvent itself
        // already drops the row when the table does not exist yet):
        // a logging failure must never change the answer.
        console.error('[ember] login-failed report write failed:', err instanceof Error ? err.message : err);
      }
      res.status(202).json({ received: true });
    } catch (err) { next(err); }
  });
  return router;
}
