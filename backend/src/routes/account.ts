import { Router } from 'express';
import { z } from 'zod';
import { ApiError, notConfigured } from '../lib/errors';
import { audit } from '../lib/audit';
import { requireAuth, type AuthedRequest } from '../lib/auth';
import type { TokenVerifier } from '../lib/auth';
import { validateBody } from '../middleware/validate';
import type { Repository, ReservationDTO, ReservationRequestDTO } from '../repositories/types';

const addressSchema = z
  .object({
    label: z.string().trim().max(40).optional(),
    line1: z.string().trim().min(1, 'Address line is required'),
    city: z.string().trim().min(1, 'City is required'),
    postalCode: z.string().trim().max(20).optional(),
    phone: z.string().trim().max(30).optional(),
    isDefault: z.boolean().optional(),
  });

const profilePatchSchema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(80).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  addresses: z.array(addressSchema).max(10).optional(),
  favorites: z.array(z.number().int()).max(200).optional(),
});

const favoriteSchema = z.object({ menuItemId: z.number().int('Invalid menu item') });

// ── Reservation change requests (Phase G, migration 0015) ────────────
// The proposal fields carry the SAME rules as the public reservation
// form (backend/src/routes/forms.ts), each made optional: a real
// calendar date that is not in the past, a valid time of day, guests
// within the form's own bounds. The message is capped like the other
// free-text forms. A request must SAY something — at least one
// proposed value or a non-empty note — enforced by the refine.
const changeDateField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Please choose a valid date')
  .refine((v) => {
    const [y, m, d] = v.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'Please choose a valid date')
  .refine((v) => {
    // Not in the past — same rule (and same UTC "today") as the form.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return true;
    return v >= new Date().toISOString().slice(0, 10);
  }, 'Please choose a date that is not in the past');
const changeTimeField = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Please choose a valid time')
  .refine((v) => {
    const [h, m] = v.split(':').map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }, 'Please choose a valid time');
const reservationChangeSchema = z
  .object({
    proposedDate: changeDateField.nullable().optional(),
    proposedTime: changeTimeField.nullable().optional(),
    proposedGuests: z
      .number()
      .int('Guests must be a whole number')
      .min(1, 'Guests must be at least 1')
      .max(20, 'For parties over 20, please contact us directly')
      .nullable()
      .optional(),
    message: z.string().trim().max(1000, 'Please keep the note under 1000 characters').optional(),
  })
  .superRefine((data, ctx) => {
    const hasProposal = data.proposedDate != null || data.proposedTime != null || data.proposedGuests != null;
    const hasMessage = (data.message ?? '').trim().length > 0;
    if (!hasProposal && !hasMessage) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tell us what you would like to change — a new date, time or party size, or a short note',
      });
    }
  });

/**
 * The Phase G visibility rule, enforced here on the server for every
 * account reservations read/write: a booking is the caller's when it
 * is LINKED to their account, or when it is a guest booking whose
 * email matches the account's email (trimmed, case-insensitive —
 * the same rule the repository's list applies). Anything else is
 * indistinguishable from a booking that does not exist.
 */
function reservationVisibleTo(reservation: ReservationDTO, user: { id: string; email: string | null }): boolean {
  if (reservation.userId === user.id) return true;
  const mine = (user.email ?? '').trim().toLowerCase();
  const theirs = (reservation.email ?? '').trim().toLowerCase();
  return mine.length > 0 && theirs.length > 0 && mine === theirs;
}

export function accountRouter(deps: { repo: Repository | null; verifyToken: TokenVerifier }) {
  const router = Router();
  router.use(requireAuth(deps));
  const repo = () => {
    if (!deps.repo) throw notConfigured();
    return deps.repo;
  };

  router.get('/profile', (req: AuthedRequest, res) => {
    res.json({ profile: { ...req.user!.profile, email: req.user!.email } });
  });

  router.patch('/profile', validateBody(profilePatchSchema), async (req: AuthedRequest, res, next) => {
    try {
      const patch = req.body as z.infer<typeof profilePatchSchema>;
      const profile = await repo().updateProfile(req.user!.id, patch);
      res.json({ profile: { ...profile, email: req.user!.email } });
    } catch (err) { next(err); }
  });

  router.get('/orders', async (req: AuthedRequest, res, next) => {
    try {
      res.json({ orders: await repo().listOrdersForUser(req.user!.id) });
    } catch (err) { next(err); }
  });

  router.get('/reservations', async (req: AuthedRequest, res, next) => {
    try {
      const { reservations, requests } = await repo().listReservationsForUser(req.user!.id, req.user!.email);
      const byReservation = new Map<string, ReservationRequestDTO[]>();
      for (const request of requests ?? []) {
        const list = byReservation.get(request.reservationId) ?? [];
        list.push(request);
        byReservation.set(request.reservationId, list);
      }
      res.json({
        reservations: reservations.map((r) => ({ ...r, requests: byReservation.get(r.id) ?? [] })),
        // Pre-0015 the bookings above are complete and exact; only
        // the change-request half of the feature is not live yet.
        requestsDegraded: requests === null,
      });
    } catch (err) { next(err); }
  });

  router.post('/reservations/:id/requests', validateBody(reservationChangeSchema), async (req: AuthedRequest, res, next) => {
    try {
      const r = repo();
      const reservation = await r.getReservation(req.params.id);
      // Ownership first, and a booking that is not the caller's is
      // answered exactly like one that does not exist — no leak.
      if (!reservation || !reservationVisibleTo(reservation, req.user!)) {
        throw new ApiError(404, 'Reservation not found');
      }
      // Only a live booking can be changed: the account page offers
      // the form on pending/confirmed reservations only, and the API
      // mirrors that gate — a request against a cancelled or
      // completed booking is refused and nothing is persisted.
      // (Requests made while the booking WAS live stay handleable by
      // the admin inbox even if the booking has since closed.)
      if (reservation.status === 'cancelled' || reservation.status === 'completed') {
        throw new ApiError(409, 'This reservation is no longer active, so it cannot be changed online — please call us and we will gladly help');
      }
      const body = req.body as z.infer<typeof reservationChangeSchema>;
      const created = await r.createReservationRequest({
        reservationId: reservation.id,
        requesterUserId: req.user!.id,
        requesterEmail: req.user!.email,
        proposedDate: body.proposedDate ?? null,
        proposedTime: body.proposedTime ?? null,
        proposedGuests: body.proposedGuests ?? null,
        message: (body.message ?? '').trim(),
      });
      if (!created) {
        // Pre-0015: nowhere for the request to live — say so
        // honestly instead of pretending it was taken.
        throw new ApiError(503, 'Change requests are not available online yet — please call us and we will gladly arrange it');
      }
      // Change History (Phase C): the customer's own step is logged
      // like every other. Per the audit posture the message BODY is
      // never logged — only that a note was attached; the proposal
      // values themselves are booking data, not secrets, and land as
      // from → to against the booking they refer to.
      await audit(deps, req, {
        action: 'reservation_request.created',
        entity: 'reservation_request',
        entityId: created.id,
        summary: `Change requested for the reservation on ${reservation.date} at ${reservation.time}`,
        changes: {
          reservation: { from: null, to: reservation.id },
          ...(created.proposedDate ? { date: { from: reservation.date, to: created.proposedDate } } : {}),
          ...(created.proposedTime ? { time: { from: reservation.time, to: created.proposedTime } } : {}),
          ...(created.proposedGuests != null ? { guests: { from: reservation.guests, to: created.proposedGuests } } : {}),
          messageAttached: { from: false, to: created.message.length > 0 },
        },
      });
      res.status(201).json({ request: created });
    } catch (err) { next(err); }
  });

  router.get('/favorites', async (req: AuthedRequest, res, next) => {
    try {
      // One batched lookup for the whole list (audit-2 fix 8) — the
      // per-id loop was an unbounded sequential N+1. The repository
      // preserves the favorites order and skips missing/unavailable
      // dishes, exactly as the loop did.
      const items = await repo().getMenuItemsByIds(req.user!.profile.favorites);
      res.json({ items });
    } catch (err) { next(err); }
  });

  router.post('/favorites', validateBody(favoriteSchema), async (req: AuthedRequest, res, next) => {
    try {
      const { menuItemId } = req.body as z.infer<typeof favoriteSchema>;
      const current = req.user!.profile.favorites;
      if (!current.includes(menuItemId)) {
        const item = await repo().getMenuItem(menuItemId);
        if (!item) throw new ApiError(400, 'That dish is not available');
      }
      const favorites = current.includes(menuItemId)
        ? current.filter((f) => f !== menuItemId)
        : [...current, menuItemId];
      const profile = await repo().updateProfile(req.user!.id, { favorites });
      res.json({ favorites: profile.favorites });
    } catch (err) { next(err); }
  });

  return router;
}

