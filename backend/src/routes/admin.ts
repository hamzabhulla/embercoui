import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { ApiError, notConfigured } from '../lib/errors';
import { aalOf, requireAuth, requireRole } from '../lib/auth';
import type { AuthedRequest, TokenVerifier } from '../lib/auth';
import { validateBody } from '../middleware/validate';
import { assertImageUpload, type StorageService } from '../lib/storage';
import { isValidCurrencyCode, roundMajorUnits } from '../lib/currency';
import { isLegalOrderTransition, isLegalReservationTransition } from '../lib/statusTransitions';
import {
  PERMISSION_LEVELS, SECTION_KEYS, effectivePermissionsFor, levelAtLeast, resolvePermissions,
} from '../lib/permissions';
import { MFA_REQUIRED_CODE, effectiveMfaRequired, mfaStateFor } from '../lib/mfa';
import type { AuthAdminService } from '../lib/authAdmin';
import { audit, auditCategoryOf, auditVerifiedOf } from '../lib/audit';
import type {
  AuditEventDTO, AuditEventFilter, OrderStatus, PageParams, PartialPermissionMap, PermissionLevel, PermissionMap, PublicSettingsDTO, Repository,
  ReservationDTO, ReservationListFilter, ReservationRequestListFilter, ReservationRequestStatus, SectionKey,
} from '../repositories/types';

// Paged admin lists (audit Fix 9): the screens page with limit/offset
// and report the exact total, so nothing silently truncates at
// PostgREST's 1000-row cap. Non-numeric or negative values are a client
// error (400); a limit above the max is clamped, not rejected.
const DEFAULT_PAGE_LIMIT = 100;
const MAX_PAGE_LIMIT = 500;
function parsePage(req: Request): PageParams {
  const parse = (raw: unknown, name: string, fallback: number): number => {
    if (raw === undefined) return fallback;
    if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
      throw new ApiError(400, `Invalid ${name} — use a non-negative integer`);
    }
    return Number(raw);
  };
  const limit = parse(req.query.limit, 'limit', DEFAULT_PAGE_LIMIT);
  if (limit < 1) throw new ApiError(400, 'Invalid limit — use a positive integer');
  const offset = parse(req.query.offset, 'offset', 0);
  return { limit: Math.min(limit, MAX_PAGE_LIMIT), offset };
}

const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'] as const;
const RESERVATION_STATUSES = ['pending', 'confirmed', 'cancelled', 'completed'] as const;

const statusSchema = z.object({ status: z.enum(ORDER_STATUSES) });
const reservationStatusSchema = z.object({ status: z.enum(RESERVATION_STATUSES) });
const RESERVATION_REQUEST_STATUSES = ['pending', 'approved', 'declined', 'handled'] as const;
// Reservation edit (Phase G) — the Apply flow's save. Date/time rules
// mirror the create schemas above; every field is optional (a patch),
// but a body that changes nothing and approves nothing is a client
// error. `requestId` links the save to a customer's change request:
// saving through Apply marks that request approved in the same
// operation. `reply` is the optional note the customer reads back
// with the approval.
const reservationEditSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date is required').refine((v) => {
      const [y, m, d] = v.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
    }, 'Please choose a valid date').refine((v) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return true;
      return v >= new Date().toISOString().slice(0, 10);
    }, 'Please choose a date that is not in the past').optional(),
    time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time is required').refine((v) => {
      const [h, m] = v.split(':').map(Number);
      return h >= 0 && h <= 23 && m >= 0 && m <= 59;
    }, 'Please choose a valid time').optional(),
    guests: z.number().int().min(1, 'Guests must be at least 1').max(20, 'For parties over 20, please contact us directly').optional(),
    requestId: z.string().trim().min(1).max(64).optional(),
    reply: z.string().trim().max(1000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.date === undefined && data.time === undefined && data.guests === undefined && data.requestId === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Nothing to save — change the date, time or guests first' });
    }
  });
// Closing a change request (Phase G). A DECLINE must carry a reply —
// the guest is owed a reason, in writing, in their account; a silent
// no is not an answer. Marking handled (sorted out by phone, say)
// makes the reply optional.
const requestDeclineSchema = z.object({
  reply: z.string().trim().min(1, 'Please add a short note for the guest — a decline deserves a reason').max(1000),
});
const requestHandledSchema = z.object({
  reply: z.string().trim().max(1000).optional(),
});
const menuSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: z.string().trim().max(500).default(''),
  price: z.number().min(0, 'Price cannot be negative'),
  image: z.string().trim().max(1000).default(''),
  category: z.string().trim().min(1, 'Category is required').max(60),
  tags: z.array(z.string().trim().max(30)).max(10).default([]),
  isAvailable: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
});
const couponObject = z.object({
  code: z.string().trim().min(3, 'Code must be at least 3 characters').max(40),
  type: z.enum(['percent', 'fixed']),
  value: z.number().min(0, 'Value cannot be negative'),
  isActive: z.boolean().default(true),
  expiresAt: z.string().datetime().nullable().default(null),
});
const couponSchema = couponObject.superRefine((data, ctx) => {
  if (data.type === 'percent' && data.value > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'A percent coupon cannot exceed 100%' });
  }
});
const roleSchema = z.object({ role: z.enum(['customer', 'admin', 'staff', 'manager']) });
// Permission maps (Phase A): exactly the twelve section keys, each an
// optional level; .strict() rejects unknown sections outright instead
// of silently storing configuration the owner never made. The stored
// map is sparse — sections the owner never set fall through to the
// role default / built-in at resolution time (lib/permissions.ts).
const permissionMapSchema = z
  .object(Object.fromEntries(SECTION_KEYS.map((s) => [s, z.enum(PERMISSION_LEVELS).optional()])))
  .strict();
const permissionsBodySchema = z.object({ permissions: permissionMapSchema });
// Two-factor requirement toggle (Phase B): the tri-state itself —
// true = required, false = not required, null = follow the role
// default. Anything else (missing, a string) is a 400, never a guess.
const mfaRequiredBodySchema = z.object({ mfaRequired: z.boolean().nullable() });
// Per-location website contacts (migration 0010). Every field is a
// nullable string; an empty string means "no override for this
// location" and normalizes to null, so the website falls back to the
// global Restaurant profile value. Unknown keys are stripped, never
// rejected — the admin form and the API may grow fields independently.
const locationField = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional();
const locationEmailField = z
  .string()
  .trim()
  .max(254)
  .transform((s) => (s === '' ? null : s))
  .refine((v) => v === null || z.string().email().safeParse(v).success, 'Invalid email format')
  .nullable()
  .optional();
const siteLocationsSchema = z
  .object({
    footer: z
      .object({
        phone: locationField(30),
        email: locationEmailField,
        address: locationField(300),
      })
      .optional(),
    contact: z
      .object({
        phone: locationField(30),
        email: locationEmailField,
        address: locationField(300),
        hours: locationField(160),
        mapLocation: locationField(300),
        // The admin map picker's pin. Range-checked per axis; the pair
        // rule below keeps a half-pin (or a half-clear) from ever being
        // stored — the Contact page treats anything but a full pair as
        // "no pin".
        mapLat: z.number().min(-90).max(90).nullable().optional(),
        mapLng: z.number().min(-180).max(180).nullable().optional(),
      })
      .superRefine((c, ctx) => {
        const hasLat = c.mapLat !== undefined;
        const hasLng = c.mapLng !== undefined;
        if (!hasLat && !hasLng) return; // the patch never mentions the pin
        const validPair = hasLat && hasLng && ((c.mapLat === null && c.mapLng === null) || (c.mapLat !== null && c.mapLng !== null));
        if (!validPair) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Map pin needs both latitude and longitude (or both cleared)',
            path: ['mapLat'],
          });
        }
      })
      .optional(),
    reservation: z
      .object({
        phone: locationField(30),
        address: locationField(300),
        hours: locationField(160),
        locationLabel: locationField(120),
      })
      .optional(),
  })
  .optional();
// Global contact fields follow the SAME clear-field rule as the
// per-location fields above (audit-2 fix 8): a blank value CLEARS the
// field to null; a non-empty value is validated. Before, the same
// "clear this field" gesture behaved inconsistently — phone '' was
// stored verbatim while email '' failed validation with a 400.
const clearableWhatsapp = z
  .string()
  .trim()
  .max(25)
  .transform((s) => (s === '' ? null : s))
  .refine((v) => v === null || (() => { const d = v.replace(/\D/g, ''); return d.length >= 7 && d.length <= 15; })(), 'WhatsApp number must contain 7–15 digits (with country code)')
  .nullable()
  .optional();
const settingsSchema = z.object({
  kitchenOpen: z.boolean().optional(),
  waitMin: z.number().int().min(0).max(240).optional(),
  waitMax: z.number().int().min(0).max(240).optional(),
  currency: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .refine((s) => isValidCurrencyCode(s), 'Unsupported currency code — use an ISO 4217 code like USD, EUR or PKR')
    .optional(),
  restaurantName: z.string().trim().min(1).max(120).optional(),
  phone: locationField(30),
  email: locationEmailField,
  address: locationField(300),
  whatsappNumber: clearableWhatsapp,
  reservationSlotCapacity: z.number().int().min(1).max(500).optional(),
  reservationFeeEnabled: z.boolean().optional(),
  // Flat per reservation in the restaurant's currency. 0 is valid
  // (an enabled-but-zero fee is simply not effective); the cap keeps
  // a typo from becoming a four-figure "booking fee" in any currency.
  reservationFeeAmount: z.number().min(0, 'Reservation fee cannot be negative').max(10000, 'Reservation fee is too large').optional(),
  openingHours: z.record(z.unknown()).optional(),
  siteLocations: siteLocationsSchema,
});
// Walk-in / phone bookings created from the admin panel. Email is optional
// (walk-ins don't always leave one); date/time rules mirror the public form.
const adminReservationSchema = z.object({
  name: z.string().trim().min(1, 'Full name is required').max(120),
  email: z.union([z.string().trim().max(254).email('Invalid email format'), z.literal('')]).optional(),
  phone: z.string().trim().min(7, 'Phone number is required').max(32),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date is required').refine((v) => {
    const [y, m, d] = v.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'Please choose a valid date').refine((v) => {
    // Same rule as the public form: not in the past. "Today" is the
    // server's current UTC date (bookings for today always pass) and the
    // string compare is exact for YYYY-MM-DD.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return true;
    return v >= new Date().toISOString().slice(0, 10);
  }, 'Please choose a date that is not in the past'),
  time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, 'Time is required').refine((v) => {
    const [h, m] = v.split(':').map(Number);
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  }, 'Please choose a valid time'),
  guests: z.number().int().min(1, 'Guests must be at least 1').max(20, 'For parties over 20, please contact us directly'),
  notes: z.string().trim().max(500).optional(),
  status: z.enum(['pending', 'confirmed']).default('confirmed'),
});
const uploadSchema = z.object({
  filename: z.string().min(1).max(120),
  contentType: z.string().min(1),
  dataBase64: z.string().min(1),
});

interface AdminDeps {
  repo: Repository | null;
  verifyToken: TokenVerifier;
  storage: StorageService | null;
  /** Supabase Auth Admin API (Phase B) — the owner's MFA factor reset. */
  authAdmin: AuthAdminService | null;
  /**
   * Whether a card provider is configured in this deployment. The
   * Settings screen needs it to say honestly when the reservation
   * fee toggle cannot take effect yet (Phase F).
   */
  stripeConfigured?: boolean;
}

export function adminRouter(deps: AdminDeps) {
  const router = Router();
  router.use(requireAuth(deps));
  router.use(requireRole('admin', 'manager', 'staff'));
  const repo = () => {
    if (!deps.repo) throw notConfigured();
    return deps.repo;
  };

  // ------------------------------------------------------------------
  // Route → section mapping (Phase A — owner-controlled permissions).
  // Every admin route is governed by ONE section: reads need 'view',
  // mutations need 'manage', resolved per request from the caller's
  // effective map (lib/permissions.ts). Endpoints marked OWNER are
  // gated by the admin ROLE, never by a section — permission and role
  // editing is the owner's alone and can never be granted away (a
  // manager holding staff:manage still gets a 403 there).
  //
  //   GET   /me                          any privileged role (returns the effective map)
  //   GET   /dashboard                   dashboard:view — blocks below are per-section
  //   GET   /orders                      orders:view
  //   PATCH /orders/:id/status           orders:manage
  //   GET   /menu                        menu:view
  //   POST  /menu                        menu:manage
  //   PATCH /menu/:id                    menu:manage
  //   DELETE /menu/:id                   menu:manage
  //   POST  /menu/upload                 menu:manage
  //   GET   /reservations                reservations:view
  //   POST  /reservations                reservations:manage
  //   PATCH /reservations/:id/status     reservations:manage
  //   PATCH /reservations/:id            reservations:manage (Phase G edit;
  //                                      with a requestId it is the Apply
  //                                      save and approves that request)
  //   GET   /reservation-requests        reservations:view  (Phase G inbox)
  //   POST  /reservation-requests/:id/decline   reservations:manage
  //   POST  /reservation-requests/:id/handled   reservations:manage
  //   GET   /customers                   customers:view
  //   GET   /reviews                     reviews:view
  //   PATCH /reviews/:id                 reviews:manage
  //   DELETE /reviews/:id                reviews:manage
  //   GET   /newsletter                  newsletter:view
  //   GET   /newsletter.csv              newsletter:view
  //   GET   /coupons                     coupons:view
  //   POST  /coupons                     coupons:manage
  //   PATCH /coupons/:id                 coupons:manage
  //   DELETE /coupons/:id                coupons:manage
  //   GET   /finance                     finance:view
  //   GET   /staff                       staff:view
  //   PATCH /staff/:id/role              OWNER
  //   PUT   /staff/:id/permissions       OWNER
  //   PUT   /staff/:id/mfa-required      OWNER
  //   POST  /staff/:id/mfa/reset         OWNER
  //   GET   /permissions/roles           OWNER
  //   PUT   /permissions/roles/:role     OWNER
  //   GET   /settings                    settings:view
  //   PATCH /settings                    settings:manage
  //   POST  /session-events              any privileged role (Phase C — Login
  //                                      Activity; written from the verified
  //                                      token, registered above the MFA gate
  //                                      like /me)
  //   GET   /security/events             security:view (Phase C)
  //   GET   /security/events.csv         security:view (Phase C)
  //   The audit log is append-only: NO route creates (outside the
  //   server-side hooks), updates or deletes audit rows — for any
  //   role, the owner included.
  //
  // Phase B adds a second, orthogonal gate: two-factor verification.
  // When the caller's effective mfa_required is in force (lib/mfa.ts —
  // per-person flag over role default; pre-0013 entirely off), every
  // route below must be reached with an aal2 token or it answers 403
  // with code MFA_REQUIRED. GET /me is the single exception: it stays
  // reachable at aal1 and reports the caller's own mfa state so the
  // frontend can run the enrollment/challenge flow — and it returns
  // nothing beyond identity, permissions and that state.
  // ------------------------------------------------------------------

  // The caller's effective permissions, resolved once per request and
  // cached on it: /admin/me, requireSection and the dashboard assembly
  // all read the same map.
  async function permissionsOf(req: AuthedRequest): Promise<PermissionMap> {
    const cached = req as AuthedRequest & { permissions?: PermissionMap };
    if (!cached.permissions) {
      cached.permissions = await effectivePermissionsFor(repo(), req.user!.profile);
    }
    return cached.permissions;
  }

  function requireSection(section: SectionKey, level: PermissionLevel) {
    return async (req: AuthedRequest, _res: Response, next: NextFunction) => {
      try {
        if (!req.user) throw new ApiError(401, 'Authentication required');
        const permissions = await permissionsOf(req);
        if (!levelAtLeast(permissions[section], level)) {
          throw new ApiError(403, 'Insufficient permissions');
        }
        next();
      } catch (err) { next(err); }
    };
  }

  // Per-field { from, to } diff between two maps, for audit changes.
  function diffPermissionMaps(
    before: PartialPermissionMap,
    after: PartialPermissionMap,
  ): Record<string, { from: unknown; to: unknown }> {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const section of SECTION_KEYS) {
      const from = before[section] ?? null;
      const to = after[section] ?? null;
      if (from !== to) changes[section] = { from, to };
    }
    return changes;
  }

  // Per-field { from, to } diff over selected keys of two records,
  // for the Phase C mutation audit hooks. Values are deep-compared
  // (JSON), so only fields that ACTUALLY changed land in the diff —
  // and an empty diff means the write was a no-op, for which the
  // hooks write no audit row at all.
  function diffFields(
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    keys: readonly string[],
  ): Record<string, { from: unknown; to: unknown }> {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of keys) {
      const from = before[key] ?? null;
      const to = after[key] ?? null;
      if (JSON.stringify(from) !== JSON.stringify(to)) changes[key] = { from, to };
    }
    return changes;
  }

  router.get('/me', async (req, res, next) => {
    try {
      const user = (req as AuthedRequest).user!;
      const permissions = await permissionsOf(req as AuthedRequest);
      // The caller's own identity, effective permissions and MFA
      // state — deliberately nothing else: this is the ONE admin
      // response an MFA-unsatisfied caller can read, and it must not
      // become a side door into admin data.
      res.json({
        id: user.id, email: user.email, role: user.role, permissions,
        mfa: mfaStateFor(user.profile, user.aal),
      });
    } catch (err) { next(err); }
  });

  // Session events (Phase C — Login Activity). The sign-in page
  // reports the three moments of an admin session; the row is written
  // from the VERIFIED token's identity (lib/audit.ts takes the actor
  // from req.user, never from the body — the strict schema makes a
  // body carrying actor/ip/timestamp fields a 400, not a spoof). The
  // event names the moment, nothing more:
  //   login        — right after password sign-in succeeds;
  //   mfa_verified — right after the MFA challenge/enrollment verify;
  //   logout       — from the sign-out action, before the token goes.
  // Registered with /me, ABOVE the MFA gate: 'login' and 'logout' are
  // reported by callers whose aal is legitimately still aal1 (the
  // login is what starts the MFA flow; a mid-flow sign-out must still
  // be recorded). 'mfa_verified' is the exception: the handler below
  // records it ONLY from an aal2 token, because the row is presented
  // as verified server truth — a password-only session asserting it
  // would be a forgery. Failed sign-ins never reach this router — the
  // password dies inside Supabase — and are reported separately as
  // UNVERIFIED client reports (routes/authEvents.ts).
  const sessionEventSchema = z.object({ event: z.enum(['login', 'mfa_verified', 'logout']) }).strict();
  const SESSION_EVENTS = {
    login: { action: 'auth.login', summary: 'Admin sign-in' },
    mfa_verified: { action: 'auth.mfa_verified', summary: 'Two-factor verification completed' },
    logout: { action: 'auth.logout', summary: 'Admin sign-out' },
  } as const;
  router.post('/session-events', validateBody(sessionEventSchema), async (req, res, next) => {
    try {
      const { event } = req.body as z.infer<typeof sessionEventSchema>;
      // mfa_verified is a VERIFIED claim about the session — the
      // Security page presents it as server truth — so it is only
      // recordable from a token that is itself at aal2 (the claim
      // the token VERIFIER read from the verified token, lib/auth.ts;
      // never anything the body, a header or the query carries). An
      // aal1 report is refused outright rather than written as a
      // lesser row: there is no honest "unverified mfa_verified"
      // state, and the real reporters (the MFA flow, the lock
      // screen) report only after their verify has lifted the
      // session to aal2. login/logout stay recordable at aal1 —
      // that is the whole reason this route sits above the gate.
      if (event === 'mfa_verified' && aalOf((req as AuthedRequest).user!) !== 'aal2') {
        throw new ApiError(403, 'Two-factor verification can only be recorded for a session that has completed it');
      }
      const mapped = SESSION_EVENTS[event];
      await audit(deps, req, { action: mapped.action, entity: 'session', summary: mapped.summary });
      res.status(202).json({ recorded: true });
    } catch (err) { next(err); }
  });

  // The MFA gate (Phase B). Registered AFTER /me, so /me stays
  // reachable for the enrollment/challenge flow; every route below
  // passes through here first. The aal it judges is the one the token
  // VERIFIER read from the server-verified token (lib/auth.ts) — never
  // a client-supplied claim. Customers never reach this router at all
  // (requireRole above), so the gate only ever judges privileged
  // accounts. Pre-0013 the requirement resolves to "not in force" for
  // everyone and this is a pass-through — today's behavior.
  function requireMfaSatisfied(req: AuthedRequest, _res: Response, next: NextFunction) {
    if (!req.user) return next(new ApiError(401, 'Authentication required'));
    const state = mfaStateFor(req.user.profile, req.user.aal);
    if (state.required && !state.satisfied) {
      return next(new ApiError(403, 'Two-factor authentication required', MFA_REQUIRED_CODE));
    }
    return next();
  }
  router.use(requireMfaSatisfied);

  router.get('/dashboard', requireSection('dashboard', 'view'), async (req, res, next) => {
    try {
      const r = repo();
      const permissions = await permissionsOf(req as AuthedRequest);
      const [orders, customers, reservations, settings] = await Promise.all([
        r.adminListOrders(), r.adminListCustomers(), r.adminListReservations(), r.getSettings(),
      ]);
      const currency = settings.currency;
      // Revenue is money: only orders denominated in the CURRENT currency
      // may be summed — never silently add different currencies together.
      // Counts (orders/customers/reservations) are not money and stay global.
      const revenue = orders
        .filter((o) => o.paymentStatus === 'paid' && o.currency === currency)
        .reduce((s, o) => s + o.total, 0);
      const byStatus = Object.fromEntries(ORDER_STATUSES.map((s) => [s, orders.filter((o) => o.status === s).length]));
      // Section-assembled stats (Phase A): a block is included only when
      // the caller may view the section it belongs to — order figures
      // ride on orders, revenue on finance, the customer count on
      // customers, pending reservations on reservations. The frontend
      // renders whichever blocks arrive.
      const stats: Record<string, unknown> = {};
      if (levelAtLeast(permissions.finance, 'view')) stats.revenue = roundMajorUnits(revenue, currency);
      if (levelAtLeast(permissions.orders, 'view')) {
        stats.totalOrders = orders.length;
        stats.pendingOrders = byStatus.pending ?? 0;
        stats.ordersByStatus = byStatus;
      }
      if (levelAtLeast(permissions.customers, 'view')) stats.customers = customers.length;
      if (levelAtLeast(permissions.reservations, 'view')) {
        stats.pendingReservations = reservations.filter((x) => x.status === 'pending').length;
      }
      res.json({
        currency,
        stats,
        ...(levelAtLeast(permissions.orders, 'view') ? { recentOrders: orders.slice(0, 8) } : {}),
      });
    } catch (err) { next(err); }
  });

  router.get('/orders', requireSection('orders', 'view'), async (req, res, next) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      if (status && !(ORDER_STATUSES as readonly string[]).includes(status)) {
        throw new ApiError(400, 'Unknown order status');
      }
      const page = parsePage(req);
      const { items, total } = await repo().adminListOrders(status, page);
      res.json({ orders: items, total, limit: page.limit, offset: page.offset });
    } catch (err) { next(err); }
  });

  router.patch('/orders/:id/status', requireSection('orders', 'manage'), validateBody(statusSchema), async (req, res, next) => {
    try {
      const r = repo();
      const target = req.body.status as OrderStatus;
      // Transition rules (audit Fix 8): judge the move against the
      // order's CURRENT state, not just the enum. The write is
      // CONDITIONAL on that state (audit-2 fix 8): the repository
      // applies it only while the order is still in the status read
      // here, so a concurrent transition (another admin, a
      // double-submit) can no longer be silently overwritten.
      const current = await r.getOrder(req.params.id);
      if (!current) throw new ApiError(404, 'Order not found');
      // Snapshot the status BEFORE the write (same shared-reference
      // hazard as the role handler): a repository may hand back the
      // stored object itself, which the write then mutates — reading
      // current.status afterwards could yield the NEW value and the
      // audit diff / no-op detection below would silently vanish.
      const previousStatus = current.status;
      if (target !== current.status) {
        if (!isLegalOrderTransition(current.status, target)) {
          throw new ApiError(400, `Cannot move an order from '${current.status}' to '${target}'`);
        }
        // A paid order must never be cancelled silently: there is no
        // refund path in the system, so the money would be stranded.
        if (target === 'cancelled' && current.paymentStatus === 'paid') {
          throw new ApiError(400, 'Cannot cancel a paid order — refund the payment first, or contact support for help');
        }
      }
      const updated = await r.updateOrderStatus(req.params.id, current.status, target);
      if (!updated) {
        // No row matched the condition: either the order vanished
        // (404) or its state moved on since the read — answer with
        // the CURRENT state and an honest 409, never a fake success.
        const latest = await r.getOrder(req.params.id);
        if (!latest) throw new ApiError(404, 'Order not found');
        res.status(409).json({ error: 'Order changed — refresh and try again', order: latest });
        return;
      }
      // Change History (Phase C): a real transition is recorded with
      // its from → to; a no-op write (target already current) and the
      // 409 path above record nothing — nothing changed.
      if (target !== previousStatus) {
        await audit(deps, req, {
          action: 'order.status_changed',
          entity: 'order',
          entityId: req.params.id,
          summary: `Order status: ${previousStatus} → ${target}`,
          changes: { status: { from: previousStatus, to: target } },
        });
      }
      res.json({ order: updated });
    } catch (err) { next(err); }
  });

  router.get('/menu', requireSection('menu', 'view'), async (_req, res, next) => {
    try { res.json({ items: await repo().listAllMenuItems() }); } catch (err) { next(err); }
  });

  router.post('/menu', requireSection('menu', 'manage'), validateBody(menuSchema), async (req, res, next) => {
    try {
      const item = await repo().createMenuItem(req.body);
      await audit(deps, req, {
        action: 'menu_item.created',
        entity: 'menu_item',
        entityId: String(item.id),
        summary: `Menu item "${item.name}" created`,
        changes: {
          name: { from: null, to: item.name },
          price: { from: null, to: item.price },
          category: { from: null, to: item.category },
        },
      });
      res.status(201).json({ item });
    } catch (err) { next(err); }
  });

  router.patch('/menu/:id', requireSection('menu', 'manage'), validateBody(menuSchema.partial()), async (req, res, next) => {
    try {
      const r = repo();
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw new ApiError(400, 'Invalid menu item id');
      // The BEFORE state, for the audit diff: this handler never held
      // it, so read the item once (the admin list read — it includes
      // unavailable items, unlike the public getMenuItem) and
      // SNAPSHOT it — the write may mutate the very object the read
      // returned (shared-reference hazard), which would erase the
      // diff. (tags is the one array field: copy it too.)
      const found = (await r.listAllMenuItems()).find((m) => m.id === id) ?? null;
      const before = found ? { ...found, tags: [...found.tags] } : null;
      const item = await r.updateMenuItem(id, req.body);
      if (!item) throw new ApiError(404, 'Menu item not found');
      if (before) {
        const changes = diffFields(
          before as unknown as Record<string, unknown>,
          item as unknown as Record<string, unknown>,
          Object.keys(req.body as Record<string, unknown>),
        );
        if (Object.keys(changes).length > 0) {
          await audit(deps, req, {
            action: 'menu_item.updated',
            entity: 'menu_item',
            entityId: String(id),
            summary: `Menu item "${item.name}" updated`,
            changes,
          });
        }
      }
      res.json({ item });
    } catch (err) { next(err); }
  });

  router.delete('/menu/:id', requireSection('menu', 'manage'), async (req, res, next) => {
    try {
      const r = repo();
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw new ApiError(400, 'Invalid menu item id');
      // The item's name for the audit summary — after the delete the
      // row is gone, so read it first (same admin list read as PATCH).
      const before = (await r.listAllMenuItems()).find((m) => m.id === id) ?? null;
      const deleted = await r.deleteMenuItem(id);
      if (!deleted) throw new ApiError(404, 'Menu item not found');
      await audit(deps, req, {
        action: 'menu_item.deleted',
        entity: 'menu_item',
        entityId: String(id),
        summary: `Menu item "${before?.name ?? `#${id}`}" deleted`,
      });
      res.json({ deleted: true });
    } catch (err) { next(err); }
  });

  router.post('/menu/upload', requireSection('menu', 'manage'), validateBody(uploadSchema), async (req, res, next) => {
    try {
      if (!deps.storage) throw new ApiError(503, 'Image storage is not configured');
      const { filename, contentType, dataBase64 } = req.body as z.infer<typeof uploadSchema>;
      const data = Buffer.from(dataBase64, 'base64');
      assertImageUpload(contentType, data);
      const { publicUrl } = await deps.storage.uploadMenuImage({ filename, contentType, data });
      res.status(201).json({ url: publicUrl });
    } catch (err) { next(err); }
  });

  router.get('/reservations', requireSection('reservations', 'view'), async (req, res, next) => {
    try {
      const page = parsePage(req);
      // Optional filters (audit-2 fix 3): `date` (YYYY-MM-DD) pins the
      // list to one day so the day board can page that date's complete
      // set; `status` gives stat chips an exact total via limit=1.
      // Same validation posture as the orders status filter: a malformed
      // value is a client error (400), never silently ignored.
      const filter: ReservationListFilter = {};
      if (typeof req.query.date === 'string') {
        // Shape AND calendar validity: the regex alone accepts
        // nonexistent dates (2026-02-30) that PostgREST would reject
        // as a date literal — round-trip the components through a
        // real Date so the route and the database agree (400 here).
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(req.query.date);
        const parts = m ? { y: +m[1], mo: +m[2], d: +m[3] } : null;
        const dt = parts ? new Date(Date.UTC(parts.y, parts.mo - 1, parts.d)) : null;
        // Date.UTC maps years 0–99 onto 1900–1999, which would fail the
        // round-trip for REAL early dates (0099-06-15) that PostgREST
        // accepts. Pin all three components with setUTCFullYear so the
        // check is exact for every year (and 0000-02-29 — year 0 is a
        // leap year — still resolves to itself, not to March 1).
        if (dt && parts) dt.setUTCFullYear(parts.y, parts.mo - 1, parts.d);
        if (!parts || !dt || dt.getUTCFullYear() !== parts.y || dt.getUTCMonth() !== parts.mo - 1 || dt.getUTCDate() !== parts.d) {
          throw new ApiError(400, 'Invalid date — use YYYY-MM-DD');
        }
        filter.date = req.query.date;
      }
      if (typeof req.query.status === 'string' && req.query.status) {
        if (!(RESERVATION_STATUSES as readonly string[]).includes(req.query.status)) {
          throw new ApiError(400, 'Unknown reservation status');
        }
        filter.status = req.query.status as ReservationDTO['status'];
      }
      const { items, total } = await repo().adminListReservations(filter, page);
      res.json({ reservations: items, total, limit: page.limit, offset: page.offset });
    } catch (err) { next(err); }
  });

  router.post('/reservations', requireSection('reservations', 'manage'), validateBody(adminReservationSchema), async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof adminReservationSchema>;
      const reservation = await repo().adminCreateReservation({
        name: body.name,
        email: body.email ? body.email : null,
        phone: body.phone,
        date: body.date,
        time: body.time,
        guests: body.guests,
        notes: body.notes ? body.notes : null,
        status: body.status,
      });
      await audit(deps, req, {
        action: 'reservation.created',
        entity: 'reservation',
        entityId: reservation.id,
        summary: `Reservation created for ${reservation.name} — ${reservation.date} at ${reservation.time}, ${reservation.guests} guest${reservation.guests === 1 ? '' : 's'}`,
        changes: {
          status: { from: null, to: reservation.status },
          date: { from: null, to: reservation.date },
          time: { from: null, to: reservation.time },
          guests: { from: null, to: reservation.guests },
        },
      });
      res.status(201).json({ reservation });
    } catch (err) { next(err); }
  });

  router.patch('/reservations/:id/status', requireSection('reservations', 'manage'), validateBody(reservationStatusSchema), async (req, res, next) => {
    try {
      const r = repo();
      const target = req.body.status as ReservationDTO['status'];
      // Same enforcement as orders (audit Fix 8): current state first,
      // then the transition table. The current row is fetched by id
      // (audit Fix 9) — scanning the admin list silently lost rows once
      // the list outgrew a single page. The write is CONDITIONAL on
      // the status read here (audit-2 fix 8), exactly like orders.
      const current = await r.getReservation(req.params.id);
      if (!current) throw new ApiError(404, 'Reservation not found');
      // Snapshot before the write (shared-reference hazard — see the
      // orders handler): the audit hook below compares against this,
      // never against the possibly-mutated row.
      const previousStatus = current.status;
      if (target !== current.status && !isLegalReservationTransition(current.status, target)) {
        throw new ApiError(400, `Cannot move a reservation from '${current.status}' to '${target}'`);
      }
      const updated = await r.updateReservationStatus(req.params.id, current.status, target);
      if (!updated) {
        const latest = await r.getReservation(req.params.id);
        if (!latest) throw new ApiError(404, 'Reservation not found');
        res.status(409).json({ error: 'Reservation changed — refresh and try again', reservation: latest });
        return;
      }
      if (target !== previousStatus) {
        await audit(deps, req, {
          action: 'reservation.status_changed',
          entity: 'reservation',
          entityId: req.params.id,
          summary: `Reservation status: ${previousStatus} → ${target}`,
          changes: { status: { from: previousStatus, to: target } },
        });
      }
      res.json({ reservation: updated });
    } catch (err) { next(err); }
  });

  router.patch('/reservations/:id', requireSection('reservations', 'manage'), validateBody(reservationEditSchema), async (req: AuthedRequest, res, next) => {
    try {
      const r = repo();
      const body = req.body as z.infer<typeof reservationEditSchema>;
      const current = await r.getReservation(req.params.id);
      if (!current) throw new ApiError(404, 'Reservation not found');
      // A save carrying a change-request id IS the Apply action: the
      // approval happens because this edit was saved, so the link is
      // validated BEFORE anything is written — a stale, foreign or
      // already-handled request id must never approve by accident,
      // and opening Apply without saving changes nothing at all.
      let linked = null as Awaited<ReturnType<Repository['getReservationRequest']>>;
      if (body.requestId) {
        linked = await r.getReservationRequest(body.requestId);
        if (!linked || linked.reservationId !== current.id) {
          throw new ApiError(400, 'That change request does not belong to this reservation');
        }
        if (linked.status !== 'pending') {
          throw new ApiError(409, 'That change request has already been handled');
        }
      }
      // Snapshot BEFORE the write (the Phase C shared-reference
      // hazard): the diff below compares against these values, never
      // against a row object the write may have mutated in place.
      const before = { date: current.date, time: current.time, guests: current.guests };
      const updated = await r.adminUpdateReservation(current.id, {
        date: body.date, time: body.time, guests: body.guests,
      });
      if (!updated) throw new ApiError(404, 'Reservation not found');
      // A save that moves nothing logs no edit row — the approval
      // row below still records the Apply itself.
      const editChanges: Record<string, { from: unknown; to: unknown }> = {};
      if (body.date !== undefined && body.date !== before.date) editChanges.date = { from: before.date, to: body.date };
      if (body.time !== undefined && body.time !== before.time) editChanges.time = { from: before.time, to: body.time };
      if (body.guests !== undefined && body.guests !== before.guests) editChanges.guests = { from: before.guests, to: body.guests };
      if (Object.keys(editChanges).length > 0) {
        await audit(deps, req, {
          action: 'reservation.updated',
          entity: 'reservation',
          entityId: current.id,
          summary: `Reservation updated — ${updated.date} at ${updated.time}, ${updated.guests} guest${updated.guests === 1 ? '' : 's'}`,
          changes: editChanges,
        });
      }
      let request: typeof linked = null;
      if (linked) {
        const reply = body.reply?.trim() ? body.reply.trim() : undefined;
        request = await r.updateReservationRequest(linked.id, {
          status: 'approved',
          adminReply: reply,
          handledBy: req.user!.id,
        });
        if (request) {
          await audit(deps, req, {
            action: 'reservation_request.approved',
            entity: 'reservation_request',
            entityId: linked.id,
            summary: `Change request approved — reservation now ${updated.date} at ${updated.time}, ${updated.guests} guest${updated.guests === 1 ? '' : 's'}`,
            changes: {
              reservation: { from: null, to: current.id },
              status: { from: 'pending', to: 'approved' },
              ...(reply ? { replyGiven: { from: false, to: true } } : {}),
            },
          });
        } else {
          // The request was pending when read but a concurrent
          // handler closed it first: the edit stands (it was a valid
          // save), and the response reports the request as it
          // actually stands rather than claiming an approval that
          // belongs to someone else.
          request = await r.getReservationRequest(linked.id);
        }
      }
      res.json({ reservation: updated, ...(request ? { request } : {}) });
    } catch (err) { next(err); }
  });

  router.get('/reservation-requests', requireSection('reservations', 'view'), async (req, res, next) => {
    try {
      const page = parsePage(req);
      const filter: ReservationRequestListFilter = {};
      if (typeof req.query.status === 'string' && req.query.status) {
        if (!(RESERVATION_REQUEST_STATUSES as readonly string[]).includes(req.query.status)) {
          throw new ApiError(400, 'Unknown request status');
        }
        filter.status = req.query.status as ReservationRequestStatus;
      }
      const { items, total, pendingTotal, degraded } = await repo().adminListReservationRequests(filter, page);
      res.json({ requests: items, total, pendingTotal, degraded, limit: page.limit, offset: page.offset });
    } catch (err) { next(err); }
  });

  // Decline / mark-handled share one shape: read the request, refuse
  // a non-pending one, close it conditionally (exactly one outcome
  // wins a race), and log it. The reply TEXT is the customer's to
  // read in their account — Change History records only WHETHER one
  // was given (the Phase C no-message-bodies posture).
  async function closeReservationRequest(
    req: AuthedRequest,
    target: 'declined' | 'handled',
    reply: string | undefined,
  ) {
    const r = repo();
    const current = await r.getReservationRequest(req.params.id);
    if (!current) throw new ApiError(404, 'Change request not found');
    if (current.status !== 'pending') {
      throw new ApiError(409, 'That change request has already been handled');
    }
    const updated = await r.updateReservationRequest(current.id, {
      status: target,
      adminReply: reply,
      handledBy: req.user!.id,
    });
    if (!updated) throw new ApiError(409, 'That change request has already been handled');
    await audit(deps, req, {
      action: `reservation_request.${target}`,
      entity: 'reservation_request',
      entityId: current.id,
      summary: target === 'declined' ? 'Change request declined' : 'Change request marked handled',
      changes: {
        reservation: { from: null, to: current.reservationId },
        status: { from: 'pending', to: target },
        replyGiven: { from: false, to: !!reply },
      },
    });
    return updated;
  }

  router.post('/reservation-requests/:id/decline', requireSection('reservations', 'manage'), validateBody(requestDeclineSchema), async (req: AuthedRequest, res, next) => {
    try {
      const { reply } = req.body as z.infer<typeof requestDeclineSchema>;
      const request = await closeReservationRequest(req, 'declined', reply);
      res.json({ request });
    } catch (err) { next(err); }
  });

  router.post('/reservation-requests/:id/handled', requireSection('reservations', 'manage'), validateBody(requestHandledSchema), async (req: AuthedRequest, res, next) => {
    try {
      const { reply } = req.body as z.infer<typeof requestHandledSchema>;
      const request = await closeReservationRequest(req, 'handled', reply?.trim() ? reply.trim() : undefined);
      res.json({ request });
    } catch (err) { next(err); }
  });

  // Least-privilege history: production audit Fix 4 made customer PII,
  // the subscriber list (+ CSV export), staff accounts, finance and
  // settings admin-only, with staff keeping dashboard, orders, menu,
  // reservations, reviews and coupon reads. Phase A generalizes those
  // hard-coded gates into the owner-controlled section map (see the
  // mapping table above): the built-in staff/manager defaults reproduce
  // the Fix-4 split, and the owner can now widen or narrow it per role
  // and per person.
  router.get('/customers', requireSection('customers', 'view'), async (req, res, next) => {
    try {
      const page = parsePage(req);
      const { items, total } = await repo().adminListCustomers(page);
      res.json({ customers: items, total, limit: page.limit, offset: page.offset });
    } catch (err) { next(err); }
  });

  router.get('/reviews', requireSection('reviews', 'view'), async (req, res, next) => {
    try {
      const r = repo();
      const page = parsePage(req);
      const { items, total } = await r.adminListReviews(page);
      // The page's headline stats describe what visitors actually see,
      // so they aggregate the COMPLETE set (the unpaged call — the same
      // route-level aggregation the dashboard/finance routes use),
      // never the loaded page: a page-local average would silently
      // misreport the public rating once reviews exceed one page
      // (audit-2 fix 6). Approved-only, exactly as the UI computed them.
      const all = await r.adminListReviews();
      const approved = all.filter((x) => x.isApproved);
      const distribution: Record<string, number> = {};
      for (const star of [5, 4, 3, 2, 1]) distribution[String(star)] = approved.filter((x) => x.rating === star).length;
      const stats = {
        approvedCount: approved.length,
        pendingCount: all.length - approved.length,
        averageRating: approved.length ? approved.reduce((s, x) => s + x.rating, 0) / approved.length : 0,
        distribution,
      };
      res.json({ reviews: items, total, limit: page.limit, offset: page.offset, stats });
    } catch (err) { next(err); }
  });

  router.patch('/reviews/:id', requireSection('reviews', 'manage'), validateBody(z.object({ isApproved: z.boolean() })), async (req, res, next) => {
    try {
      const ok = await repo().setReviewApproved(req.params.id, req.body.isApproved);
      if (!ok) throw new ApiError(404, 'Review not found');
      res.json({ updated: true });
    } catch (err) { next(err); }
  });

  router.delete('/reviews/:id', requireSection('reviews', 'manage'), async (req, res, next) => {
    try {
      const ok = await repo().deleteReview(req.params.id);
      if (!ok) throw new ApiError(404, 'Review not found');
      res.json({ deleted: true });
    } catch (err) { next(err); }
  });

  router.get('/newsletter', requireSection('newsletter', 'view'), async (req, res, next) => {
    try {
      const page = parsePage(req);
      // Optional `since` (ISO 8601): the returned total then counts
      // only subscribers who joined at/after it — the "new this week"
      // stat reads it with limit=1 instead of counting a loaded page
      // (audit-2 fix 6). An unparseable value is a client error (400),
      // same posture as parsePage.
      const rawSince = req.query.since;
      let since: string | undefined;
      if (rawSince !== undefined) {
        if (typeof rawSince !== 'string' || Number.isNaN(Date.parse(rawSince))) {
          throw new ApiError(400, 'Invalid since — use an ISO 8601 timestamp');
        }
        since = new Date(rawSince).toISOString();
      }
      const { items, total } = await repo().adminListNewsletter(page, since);
      res.json({ subscribers: items, total, limit: page.limit, offset: page.offset });
    } catch (err) { next(err); }
  });

  router.get('/newsletter.csv', requireSection('newsletter', 'view'), async (_req, res, next) => {
    try {
      const subscribers = await repo().adminListNewsletter();
      const csvField = (v: string) => {
        // Neutralise spreadsheet formula triggers and quote every
        // field (OWASP CSV-injection guidance): a field is a formula
        // risk when its first NON-whitespace/control character is
        // one of = + - @ | — leading spaces, tabs or newlines do not
        // make a formula safe, because spreadsheet apps strip them
        // before evaluating. Such fields get a leading apostrophe so
        // they render as text. A field whose leading whitespace is
        // followed by an ordinary character is NOT a formula and
        // passes through byte-identical.
        const firstMeaningful = [...v].find((ch) => { const c = ch.charCodeAt(0); return !/\s/.test(ch) && c > 0x1f && c !== 0x7f; }) ?? '';
        const safe = firstMeaningful !== '' && '=+-@|'.includes(firstMeaningful) ? `'${v}` : v;
        return `"${safe.replace(/"/g, '""')}"`;
      };
      const csv = ['email,subscribed_at', ...subscribers.map((s) => `${csvField(s.email)},${csvField(s.createdAt)}`)].join('\n');
      res.header('Content-Type', 'text/csv');
      res.header('Content-Disposition', 'attachment; filename="newsletter-subscribers.csv"');
      res.send(csv);
    } catch (err) { next(err); }
  });

  router.get('/coupons', requireSection('coupons', 'view'), async (req, res, next) => {
    try {
      const page = parsePage(req);
      const { items, total } = await repo().adminListCoupons(page);
      res.json({ coupons: items, total, limit: page.limit, offset: page.offset });
    } catch (err) { next(err); }
  });

  router.post('/coupons', requireSection('coupons', 'manage'), validateBody(couponSchema), async (req, res, next) => {
    try {
      const coupon = await repo().createCoupon(req.body);
      await audit(deps, req, {
        action: 'coupon.created',
        entity: 'coupon',
        entityId: coupon.id,
        summary: `Coupon ${coupon.code} created`,
        changes: {
          code: { from: null, to: coupon.code },
          type: { from: null, to: coupon.type },
          value: { from: null, to: coupon.value },
          isActive: { from: null, to: coupon.isActive },
        },
      });
      res.status(201).json({ coupon });
    } catch (err) { next(err); }
  });

  router.patch('/coupons/:id', requireSection('coupons', 'manage'), validateBody(couponObject.partial()), async (req, res, next) => {
    try {
      const r = repo();
      const existing = (await r.adminListCoupons()).find((c) => c.id === req.params.id);
      if (!existing) throw new ApiError(404, 'Coupon not found');
      // Merged validation (same pattern as settings): a value-only or
      // type-only PATCH must not push a percent coupon past 100%.
      const mergedType = (req.body.type as string | undefined) ?? existing.type;
      const mergedValue = (req.body.value as number | undefined) ?? existing.value;
      if (mergedType === 'percent' && mergedValue > 100) {
        throw new ApiError(400, 'A percent coupon cannot exceed 100%');
      }
      // Snapshot before the write (shared-reference hazard): the
      // update may mutate the listed object itself.
      const before = { ...existing };
      const coupon = await r.updateCoupon(req.params.id, req.body);
      if (!coupon) throw new ApiError(404, 'Coupon not found');
      const changes = diffFields(
        before as unknown as Record<string, unknown>,
        coupon as unknown as Record<string, unknown>,
        Object.keys(req.body as Record<string, unknown>),
      );
      if (Object.keys(changes).length > 0) {
        await audit(deps, req, {
          action: 'coupon.updated',
          entity: 'coupon',
          entityId: coupon.id,
          summary: `Coupon ${coupon.code} updated`,
          changes,
        });
      }
      res.json({ coupon });
    } catch (err) { next(err); }
  });

  router.delete('/coupons/:id', requireSection('coupons', 'manage'), async (req, res, next) => {
    try {
      const r = repo();
      // The coupon's code for the audit summary — read before the
      // delete removes the row (same list read the PATCH uses).
      const existing = (await r.adminListCoupons()).find((c) => c.id === req.params.id) ?? null;
      const ok = await r.deleteCoupon(req.params.id);
      if (!ok) throw new ApiError(404, 'Coupon not found');
      await audit(deps, req, {
        action: 'coupon.deleted',
        entity: 'coupon',
        entityId: req.params.id,
        summary: `Coupon ${existing?.code ?? req.params.id} deleted`,
      });
      res.json({ deleted: true });
    } catch (err) { next(err); }
  });

  router.get('/finance', requireSection('finance', 'view'), async (_req, res, next) => {
    try {
      const r = repo();
      const settings = await r.getSettings();
      const currency = settings.currency;
      // The whole finance report is money: restrict it to paid orders in the
      // CURRENT currency so totals/byDay/byMonth never mix currencies.
      const orders = (await r.adminListOrders()).filter(
        (o) => o.paymentStatus === 'paid' && o.currency === currency,
      );
      const byDay = new Map<string, { date: string; revenue: number; orders: number }>();
      const byMonth = new Map<string, { month: string; revenue: number; orders: number }>();
      for (const o of orders) {
        const day = o.createdAt.slice(0, 10);
        const month = o.createdAt.slice(0, 7);
        const d = byDay.get(day) ?? { date: day, revenue: 0, orders: 0 };
        d.revenue += o.total; d.orders += 1; byDay.set(day, d);
        const m = byMonth.get(month) ?? { month, revenue: 0, orders: 0 };
        m.revenue += o.total; m.orders += 1; byMonth.set(month, m);
      }
      const round = (n: number) => roundMajorUnits(n, currency);
      // byDay is a continuous calendar series: the 30 days ending at the
      // most recent paid order's day, zero-filled where nothing sold —
      // previously only days WITH sales appeared, so quiet days vanished
      // and the series silently compressed the calendar. (An order older
      // than the window still counts toward the totals below; it simply
      // falls off the daily chart, as it did when the series was capped
      // at 30 entries.)
      let byDaySeries: { date: string; revenue: number; orders: number }[] = [];
      if (orders.length) {
        const endDay = orders.reduce((max, o) => (o.createdAt.slice(0, 10) > max ? o.createdAt.slice(0, 10) : max), '');
        const endMs = Date.parse(`${endDay}T00:00:00.000Z`);
        byDaySeries = Array.from({ length: 30 }, (_, i) => {
          const date = new Date(endMs - (29 - i) * 86_400_000).toISOString().slice(0, 10);
          const agg = byDay.get(date);
          return { date, revenue: round(agg?.revenue ?? 0), orders: agg?.orders ?? 0 };
        }).reverse(); // newest first, as before
      }
      res.json({
        currency,
        totalRevenue: round(orders.reduce((s, o) => s + o.total, 0)),
        totalPaidOrders: orders.length,
        averageOrderValue: orders.length ? round(orders.reduce((s, o) => s + o.total, 0) / orders.length) : 0,
        byDay: byDaySeries,
        byMonth: [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1)).slice(0, 12).map((m) => ({ ...m, revenue: round(m.revenue) })),
      });
    } catch (err) { next(err); }
  });

  router.get('/staff', requireSection('staff', 'view'), async (req, res, next) => {
    try {
      const page = parsePage(req);
      const { items, total } = await repo().adminListStaff(page);
      res.json({ staff: items, total, limit: page.limit, offset: page.offset });
    } catch (err) { next(err); }
  });

  // OWNER-ONLY from here: role assignment and every permission write.
  // These are gated by the admin role itself, never by the staff
  // section — permission editing is not an assignable capability.
  router.patch('/staff/:id/role', requireRole('admin'), validateBody(roleSchema), async (req, res, next) => {
    try {
      const r = repo();
      const target = await r.getProfile(req.params.id);
      if (!target) throw new ApiError(404, 'User not found');
      if (req.body.role !== 'admin' && target.role === 'admin') {
        const everyone = await r.adminListStaff();
        if (everyone.filter((p) => p.role === 'admin').length <= 1) {
          throw new ApiError(400, 'At least one admin account must remain — promote another admin first');
        }
      }
      // Snapshot the previous role BEFORE the write: a repository may
      // hand back references to the same stored object, so comparing
      // target.role after the update could read the NEW value and the
      // audit diff would vanish.
      const previousRole = target.role;
      const updated = await r.updateProfileRole(req.params.id, req.body.role);
      if (!updated) throw new ApiError(404, 'User not found');
      if (updated.role !== previousRole) {
        await audit(deps, req, {
          action: 'staff.role_changed',
          entity: 'profile',
          entityId: req.params.id,
          summary: `Role changed from ${previousRole} to ${updated.role}`,
          changes: { role: { from: previousRole, to: updated.role } },
        });
      }
      res.json({ profile: updated });
    } catch (err) { next(err); }
  });

  router.put('/staff/:id/permissions', requireRole('admin'), validateBody(permissionsBodySchema), async (req, res, next) => {
    try {
      const r = repo();
      const target = await r.getProfile(req.params.id);
      if (!target) throw new ApiError(404, 'User not found');
      const incoming = (req.body as { permissions: PartialPermissionMap }).permissions;
      // Snapshot before the write (same shared-reference hazard as the
      // role change above).
      const previousOverrides: PartialPermissionMap = { ...(target.permissions ?? {}) };
      const updated = await r.setUserPermissions(req.params.id, incoming);
      if (!updated) throw new ApiError(404, 'User not found');
      const changes = diffPermissionMaps(previousOverrides, updated.permissions ?? {});
      if (Object.keys(changes).length > 0) {
        await audit(deps, req, {
          action: 'staff.permissions_changed',
          entity: 'profile',
          entityId: req.params.id,
          summary: 'Per-person permission overrides changed',
          changes,
        });
      }
      res.json({ profile: updated, permissions: await effectivePermissionsFor(r, updated) });
    } catch (err) { next(err); }
  });

  // The person's two-factor requirement (Phase B). Owner-only like
  // every other access decision: a manager holding staff:manage gets
  // a 403 here — who must prove a second factor is not an assignable
  // capability either.
  router.put('/staff/:id/mfa-required', requireRole('admin'), validateBody(mfaRequiredBodySchema), async (req, res, next) => {
    try {
      const r = repo();
      const target = await r.getProfile(req.params.id);
      if (!target) throw new ApiError(404, 'User not found');
      // Snapshot before the write (same shared-reference hazard as the
      // role/permissions handlers): the audit diff must compare the
      // value as it stood. Pre-0013 the stored value is absent
      // (undefined), which the audit records as null — no decision.
      const previous: boolean | null = target.mfaRequired ?? null;
      const updated = await r.setUserMfaRequired(req.params.id, req.body.mfaRequired as boolean | null);
      if (!updated) throw new ApiError(404, 'User not found');
      const current: boolean | null = updated.mfaRequired ?? null;
      if (current !== previous) {
        await audit(deps, req, {
          action: 'staff.mfa_required_changed',
          entity: 'profile',
          entityId: req.params.id,
          summary: current === null
            ? 'Two-factor requirement set to follow the role default'
            : current
              ? 'Two-factor authentication now required for this account'
              : 'Two-factor authentication no longer required for this account',
          changes: { mfaRequired: { from: previous, to: current } },
        });
      }
      res.json({ profile: updated, mfaRequiredEffective: effectiveMfaRequired(updated) });
    } catch (err) { next(err); }
  });

  // Reset a person's MFA factors (Phase B): the recovery path for a
  // locked-out account. Deletes EVERY factor on the account through
  // the Supabase Admin API, so the person's next sign-in lands on
  // enrollment again (when their requirement is in force). Owner-only.
  router.post('/staff/:id/mfa/reset', requireRole('admin'), async (req, res, next) => {
    try {
      const r = repo();
      const target = await r.getProfile(req.params.id);
      if (!target) throw new ApiError(404, 'User not found');
      if (!deps.authAdmin) throw new ApiError(503, 'Two-factor management is not configured');
      let removed = 0;
      try {
        const factors = await deps.authAdmin.listMfaFactors(req.params.id);
        for (const factor of factors) {
          await deps.authAdmin.deleteMfaFactor(req.params.id, factor.id);
          removed += 1;
        }
      } catch {
        throw new ApiError(502, 'Could not reach the authentication service — please try again');
      }
      if (removed > 0) {
        await audit(deps, req, {
          action: 'staff.mfa_reset',
          entity: 'profile',
          entityId: req.params.id,
          summary: `Two-factor authentication reset — ${removed} factor${removed === 1 ? '' : 's'} removed; the account will enroll again at its next sign-in`,
          changes: { mfaFactors: { from: removed, to: 0 } },
        });
      }
      res.json({ reset: true, factorsRemoved: removed });
    } catch (err) { next(err); }
  });

  router.get('/permissions/roles', requireRole('admin'), async (_req, res, next) => {
    try {
      const r = repo();
      const [managerStored, staffStored] = await Promise.all([
        r.getRolePermissions('manager'), r.getRolePermissions('staff'),
      ]);
      // The editor works on the EFFECTIVE defaults (stored row over
      // built-ins), always a complete twelve-section map.
      res.json({
        roles: {
          manager: resolvePermissions('manager', managerStored, null),
          staff: resolvePermissions('staff', staffStored, null),
        },
      });
    } catch (err) { next(err); }
  });

  router.put('/permissions/roles/:role', requireRole('admin'), validateBody(permissionsBodySchema), async (req, res, next) => {
    try {
      const role = req.params.role;
      if (role !== 'manager' && role !== 'staff') throw new ApiError(404, 'Unknown role');
      const r = repo();
      const before = resolvePermissions(role, await r.getRolePermissions(role), null);
      const incoming = (req.body as { permissions: PartialPermissionMap }).permissions;
      // The stored row REPLACES the previous defaults (the editor sends
      // the full map); sections absent from the body fall back to the
      // built-in defaults at resolution time.
      await r.setRolePermissions(role, incoming);
      const after = resolvePermissions(role, await r.getRolePermissions(role), null);
      const changes = diffPermissionMaps(before, after);
      if (Object.keys(changes).length > 0) {
        await audit(deps, req, {
          action: 'permissions.role_defaults_changed',
          entity: 'role_permissions',
          entityId: role,
          summary: `Default permissions for the ${role} role changed`,
          changes,
        });
      }
      res.json({ role, permissions: after });
    } catch (err) { next(err); }
  });

  router.get('/settings', requireSection('settings', 'view'), async (_req, res, next) => {
    try {
      // stripeConfigured rides along so the fee control can state
      // plainly when the toggle cannot charge yet (the fee is only
      // effective with a provider — lib/reservationFee.ts).
      res.json({ settings: await repo().getSettings(), stripeConfigured: deps.stripeConfigured ?? false });
    } catch (err) { next(err); }
  });

  // Settings audit diff (Phase C): top-level scalar keys carry their
  // real from → to; the two object values flatten one level
  // (openingHours.<day>, siteLocations.<group>.<field>) so a change
  // names the exact field instead of dumping whole objects into the
  // log. Only keys present in the PATCH body are candidates — an
  // untouched key cannot have changed.
  function diffSettings(
    current: PublicSettingsDTO,
    body: z.infer<typeof settingsSchema>,
  ): Record<string, { from: unknown; to: unknown }> {
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const record = (key: string, from: unknown, to: unknown) => {
      if (JSON.stringify(from ?? null) !== JSON.stringify(to ?? null)) {
        changes[key] = { from: from ?? null, to: to ?? null };
      }
    };
    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      if (key === 'openingHours') {
        const before = (current.openingHours ?? {}) as Record<string, unknown>;
        for (const [day, v] of Object.entries(value as Record<string, unknown>)) {
          record(`openingHours.${day}`, before[day], v);
        }
      } else if (key === 'siteLocations') {
        const beforeGroups = current.siteLocations as unknown as Record<string, Record<string, unknown>>;
        for (const [group, fields] of Object.entries(value as Record<string, Record<string, unknown> | undefined>)) {
          if (!fields) continue;
          const beforeGroup = beforeGroups[group] ?? {};
          for (const [field, v] of Object.entries(fields)) {
            record(`siteLocations.${group}.${field}`, beforeGroup[field], v);
          }
        }
      } else {
        record(key, (current as unknown as Record<string, unknown>)[key], value);
      }
    }
    return changes;
  }

  router.patch('/settings', requireSection('settings', 'manage'), validateBody(settingsSchema), async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof settingsSchema>;
      // Validate against the MERGED result so a one-sided PATCH cannot
      // persist an inverted wait range against the stored other bound.
      const current = await repo().getSettings();
      const mergedMin = body.waitMin ?? current.waitMin;
      const mergedMax = body.waitMax ?? current.waitMax;
      if (mergedMax < mergedMin) {
        throw new ApiError(400, 'Maximum wait must be at least the minimum wait');
      }
      const settings = await repo().updateSettings(body);
      const changes = diffSettings(current, body);
      if (Object.keys(changes).length > 0) {
        await audit(deps, req, {
          action: 'settings.updated',
          entity: 'settings',
          summary: 'Restaurant settings updated',
          changes,
        });
      }
      res.json({ settings });
    } catch (err) { next(err); }
  });

  // ------------------------------------------------------------------
  // Security & Activity reads (Phase C). Gated on security:view — the
  // built-in defaults give it to NO role but the owner, who can grant
  // 'view' per role/person through the Phase A editors. These are the
  // ONLY audit reads, and there is no write path: the log is
  // append-only, written solely by the server hooks above.
  //
  // Filters: category ('auth' | 'change'), actorId, action (PREFIX —
  // 'menu_item.' selects the whole family), from/to
  // (ISO timestamps; a bare YYYY-MM-DD means the whole day — start
  // of day for `from`, end of day for `to`), and q (free text over
  // actor label / summary / action). Malformed values are 400s, the
  // same posture as parsePage — a filter is never silently ignored.
  // ------------------------------------------------------------------
  function parseSecurityFilter(req: Request): AuditEventFilter {
    const filter: AuditEventFilter = {};
    const { category, actorId, action, from, to, q } = req.query;
    if (category !== undefined) {
      if (category !== 'auth' && category !== 'change') {
        throw new ApiError(400, "Invalid category — use 'auth' or 'change'");
      }
      filter.category = category;
    }
    if (typeof actorId === 'string' && actorId) filter.actorId = actorId.slice(0, 64);
    // The prefix is passed through as-is (length-capped): the
    // repository escapes LIKE wildcards itself, so '_' and '.' —
    // ordinary characters in action names — survive, and a '%' in
    // the value can still only match a literal '%'.
    if (typeof action === 'string' && action) filter.action = action.slice(0, 80);
    const parseBound = (raw: unknown, name: 'from' | 'to'): string | undefined => {
      if (raw === undefined) return undefined;
      if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) {
        throw new ApiError(400, `Invalid ${name} — use an ISO 8601 timestamp or YYYY-MM-DD date`);
      }
      // A bare date is a whole-day bound in UTC: `from` starts the
      // day (Date.parse already yields its midnight), `to` ends it.
      if (name === 'to' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T23:59:59.999Z`;
      return new Date(raw).toISOString();
    };
    filter.from = parseBound(from, 'from');
    filter.to = parseBound(to, 'to');
    if (typeof q === 'string' && q.trim()) filter.q = q.trim().slice(0, 200);
    return filter;
  }

  // The wire shape of one event. `category` and the trust marker are
  // derived from the action (lib/audit.ts): every row is server-
  // written from a verified identity EXCEPT auth.login_failed, the
  // client-reported failed sign-in, which is exposed as
  // verified=false / source 'client-report' so the UI can badge it
  // and never present it as a verified fact. entity.label reuses the
  // stored summary — the identifying text the writer recorded for
  // the entity ("Menu item \"Ember Classic\" updated").
  function securityEventRow(e: AuditEventDTO) {
    return {
      id: e.id,
      timestamp: e.createdAt,
      category: auditCategoryOf(e.action),
      action: e.action,
      actor: e.actorId || e.actorLabel
        ? { id: e.actorId, label: e.actorLabel, role: e.actorRole }
        : null,
      entity: e.entity ? { type: e.entity, id: e.entityId, label: e.summary } : null,
      summary: e.summary,
      changes: e.changes,
      metadata: {
        ip: e.ip,
        userAgent: e.userAgent,
        verified: auditVerifiedOf(e.action),
        source: auditVerifiedOf(e.action) ? 'server' : 'client-report',
      },
    };
  }

  router.get('/security/events', requireSection('security', 'view'), async (req, res, next) => {
    try {
      const filter = parseSecurityFilter(req);
      const page = parsePage(req);
      const { items, total, degraded } = await repo().listAuditEvents(filter, page);
      res.json({ events: items.map(securityEventRow), total, limit: page.limit, offset: page.offset, degraded });
    } catch (err) { next(err); }
  });

  router.get('/security/events.csv', requireSection('security', 'view'), async (req, res, next) => {
    try {
      const filter = parseSecurityFilter(req);
      const { items } = await repo().listAuditEvents(filter);
      const csvField = (v: string) => {
        // Same neutralisation as the newsletter export (OWASP
        // CSV-injection guidance): defuse spreadsheet formula
        // triggers and quote every field. A field is a formula risk
        // when its first NON-whitespace/control character is one of
        // = + - @ | — leading spaces, tabs or newlines do not make a
        // formula safe, because spreadsheet apps strip them before
        // evaluating. Such fields get a leading apostrophe; a field
        // whose leading whitespace is followed by an ordinary
        // character is NOT a formula and passes through untouched.
        const firstMeaningful = [...v].find((ch) => { const c = ch.charCodeAt(0); return !/\s/.test(ch) && c > 0x1f && c !== 0x7f; }) ?? '';
        const safe = firstMeaningful !== '' && '=+-@|'.includes(firstMeaningful) ? `'${v}` : v;
        return `"${safe.replace(/"/g, '""')}"`;
      };
      const lines = items.map((e) => {
        const row = securityEventRow(e);
        return [
          row.timestamp,
          row.category,
          row.action,
          row.actor?.label ?? '',
          row.actor?.role ?? '',
          row.entity ? `${row.entity.type}:${row.entity.id ?? ''}` : '',
          row.summary ?? '',
          row.changes ? JSON.stringify(row.changes) : '',
          row.metadata.ip ?? '',
          row.metadata.userAgent ?? '',
          row.metadata.verified ? 'verified' : 'unverified',
        ].map((v) => csvField(String(v))).join(',');
      });
      const header = ['timestamp', 'category', 'action', 'actor', 'actor_role', 'entity', 'summary', 'changes', 'ip', 'user_agent', 'verification']
        .map((v) => csvField(v)).join(',');
      const csv = [header, ...lines].join('\n');
      const today = new Date().toISOString().slice(0, 10);
      res.header('Content-Type', 'text/csv');
      res.header('Content-Disposition', `attachment; filename="security-activity-${today}.csv"`);
      res.send(csv);
    } catch (err) { next(err); }
  });

  return router;
}

