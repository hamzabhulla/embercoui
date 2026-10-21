import { Router } from 'express';
import { z } from 'zod';
import { ApiError, notConfigured } from '../lib/errors';
import { requireAuth, requireRole } from '../lib/auth';
import type { TokenVerifier } from '../lib/auth';
import { validateBody } from '../middleware/validate';
import { assertImageUpload, type StorageService } from '../lib/storage';
import { isValidCurrencyCode, roundMajorUnits } from '../lib/currency';
import type { OrderStatus, Repository } from '../repositories/types';

const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'] as const;
const RESERVATION_STATUSES = ['pending', 'confirmed', 'cancelled', 'completed'] as const;

const statusSchema = z.object({ status: z.enum(ORDER_STATUSES) });
const reservationStatusSchema = z.object({ status: z.enum(RESERVATION_STATUSES) });
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
const roleSchema = z.object({ role: z.enum(['customer', 'admin', 'staff']) });
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
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().email('Invalid email format').nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  whatsappNumber: z
    .string()
    .trim()
    .max(25)
    .refine((v) => { const d = v.replace(/\D/g, ''); return d.length >= 7 && d.length <= 15; }, 'WhatsApp number must contain 7–15 digits (with country code)')
    .nullable()
    .optional(),
  reservationSlotCapacity: z.number().int().min(1).max(500).optional(),
  openingHours: z.record(z.unknown()).optional(),
});
// Walk-in / phone bookings created from the admin panel. Email is optional
// (walk-ins don't always leave one); date/time rules mirror the public form.
const adminReservationSchema = z.object({
  name: z.string().trim().min(1, 'Full name is required'),
  email: z.union([z.string().trim().email('Invalid email format'), z.literal('')]).optional(),
  phone: z.string().trim().min(7, 'Phone number is required'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date is required').refine((v) => {
    const [y, m, d] = v.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'Please choose a valid date'),
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
}

export function adminRouter(deps: AdminDeps) {
  const router = Router();
  router.use(requireAuth(deps));
  router.use(requireRole('admin', 'staff'));
  const repo = () => {
    if (!deps.repo) throw notConfigured();
    return deps.repo;
  };

  router.get('/dashboard', async (_req, res, next) => {
    try {
      const r = repo();
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
      res.json({
        currency,
        stats: {
          revenue: roundMajorUnits(revenue, currency),
          totalOrders: orders.length,
          pendingOrders: byStatus.pending ?? 0,
          ordersByStatus: byStatus,
          customers: customers.length,
          pendingReservations: reservations.filter((x) => x.status === 'pending').length,
        },
        recentOrders: orders.slice(0, 8),
      });
    } catch (err) { next(err); }
  });

  router.get('/orders', async (req, res, next) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      if (status && !(ORDER_STATUSES as readonly string[]).includes(status)) {
        throw new ApiError(400, 'Unknown order status');
      }
      res.json({ orders: await repo().adminListOrders(status) });
    } catch (err) { next(err); }
  });

  router.patch('/orders/:id/status', validateBody(statusSchema), async (req, res, next) => {
    try {
      const updated = await repo().updateOrderStatus(req.params.id, req.body.status as OrderStatus);
      if (!updated) throw new ApiError(404, 'Order not found');
      res.json({ order: updated });
    } catch (err) { next(err); }
  });

  router.get('/menu', async (_req, res, next) => {
    try { res.json({ items: await repo().listAllMenuItems() }); } catch (err) { next(err); }
  });

  router.post('/menu', validateBody(menuSchema), async (req, res, next) => {
    try {
      const item = await repo().createMenuItem(req.body);
      res.status(201).json({ item });
    } catch (err) { next(err); }
  });

  router.patch('/menu/:id', validateBody(menuSchema.partial()), async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw new ApiError(400, 'Invalid menu item id');
      const item = await repo().updateMenuItem(id, req.body);
      if (!item) throw new ApiError(404, 'Menu item not found');
      res.json({ item });
    } catch (err) { next(err); }
  });

  router.delete('/menu/:id', requireRole('admin'), async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) throw new ApiError(400, 'Invalid menu item id');
      const deleted = await repo().deleteMenuItem(id);
      if (!deleted) throw new ApiError(404, 'Menu item not found');
      res.json({ deleted: true });
    } catch (err) { next(err); }
  });

  router.post('/menu/upload', validateBody(uploadSchema), async (req, res, next) => {
    try {
      if (!deps.storage) throw new ApiError(503, 'Image storage is not configured');
      const { filename, contentType, dataBase64 } = req.body as z.infer<typeof uploadSchema>;
      const data = Buffer.from(dataBase64, 'base64');
      assertImageUpload(contentType, data.byteLength);
      const { publicUrl } = await deps.storage.uploadMenuImage({ filename, contentType, data });
      res.status(201).json({ url: publicUrl });
    } catch (err) { next(err); }
  });

  router.get('/reservations', async (_req, res, next) => {
    try { res.json({ reservations: await repo().adminListReservations() }); } catch (err) { next(err); }
  });

  router.post('/reservations', validateBody(adminReservationSchema), async (req, res, next) => {
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
      res.status(201).json({ reservation });
    } catch (err) { next(err); }
  });

  router.patch('/reservations/:id/status', validateBody(reservationStatusSchema), async (req, res, next) => {
    try {
      const updated = await repo().updateReservationStatus(req.params.id, req.body.status);
      if (!updated) throw new ApiError(404, 'Reservation not found');
      res.json({ reservation: updated });
    } catch (err) { next(err); }
  });

  router.get('/customers', async (_req, res, next) => {
    try { res.json({ customers: await repo().adminListCustomers() }); } catch (err) { next(err); }
  });

  router.get('/reviews', async (_req, res, next) => {
    try { res.json({ reviews: await repo().adminListReviews() }); } catch (err) { next(err); }
  });

  router.patch('/reviews/:id', validateBody(z.object({ isApproved: z.boolean() })), async (req, res, next) => {
    try {
      const ok = await repo().setReviewApproved(req.params.id, req.body.isApproved);
      if (!ok) throw new ApiError(404, 'Review not found');
      res.json({ updated: true });
    } catch (err) { next(err); }
  });

  router.delete('/reviews/:id', requireRole('admin'), async (req, res, next) => {
    try {
      const ok = await repo().deleteReview(req.params.id);
      if (!ok) throw new ApiError(404, 'Review not found');
      res.json({ deleted: true });
    } catch (err) { next(err); }
  });

  router.get('/newsletter', async (_req, res, next) => {
    try { res.json({ subscribers: await repo().adminListNewsletter() }); } catch (err) { next(err); }
  });

  router.get('/newsletter.csv', async (_req, res, next) => {
    try {
      const subscribers = await repo().adminListNewsletter();
      const csvField = (v: string) => {
        // Neutralise spreadsheet formula triggers and quote every field.
        const safe = /^[=+\-@\t]/.test(v) ? `'${v}` : v;
        return `"${safe.replace(/"/g, '""')}"`;
      };
      const csv = ['email,subscribed_at', ...subscribers.map((s) => `${csvField(s.email)},${csvField(s.createdAt)}`)].join('\n');
      res.header('Content-Type', 'text/csv');
      res.header('Content-Disposition', 'attachment; filename="newsletter-subscribers.csv"');
      res.send(csv);
    } catch (err) { next(err); }
  });

  router.get('/coupons', async (_req, res, next) => {
    try { res.json({ coupons: await repo().adminListCoupons() }); } catch (err) { next(err); }
  });

  router.post('/coupons', requireRole('admin'), validateBody(couponSchema), async (req, res, next) => {
    try {
      const coupon = await repo().createCoupon(req.body);
      res.status(201).json({ coupon });
    } catch (err) { next(err); }
  });

  router.patch('/coupons/:id', requireRole('admin'), validateBody(couponObject.partial()), async (req, res, next) => {
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
      const coupon = await r.updateCoupon(req.params.id, req.body);
      if (!coupon) throw new ApiError(404, 'Coupon not found');
      res.json({ coupon });
    } catch (err) { next(err); }
  });

  router.delete('/coupons/:id', requireRole('admin'), async (req, res, next) => {
    try {
      const ok = await repo().deleteCoupon(req.params.id);
      if (!ok) throw new ApiError(404, 'Coupon not found');
      res.json({ deleted: true });
    } catch (err) { next(err); }
  });

  router.get('/finance', async (_req, res, next) => {
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
      res.json({
        currency,
        totalRevenue: round(orders.reduce((s, o) => s + o.total, 0)),
        totalPaidOrders: orders.length,
        averageOrderValue: orders.length ? round(orders.reduce((s, o) => s + o.total, 0) / orders.length) : 0,
        byDay: [...byDay.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30).map((d) => ({ ...d, revenue: round(d.revenue) })),
        byMonth: [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1)).slice(0, 12).map((m) => ({ ...m, revenue: round(m.revenue) })),
      });
    } catch (err) { next(err); }
  });

  router.get('/staff', async (_req, res, next) => {
    try { res.json({ staff: await repo().adminListStaff() }); } catch (err) { next(err); }
  });

  router.patch('/staff/:id/role', requireRole('admin'), validateBody(roleSchema), async (req, res, next) => {
    try {
      const r = repo();
      if (req.body.role !== 'admin') {
        const everyone = await r.adminListStaff();
        const target = everyone.find((p) => p.id === req.params.id);
        if (!target) throw new ApiError(404, 'User not found');
        if (target.role === 'admin' && everyone.filter((p) => p.role === 'admin').length <= 1) {
          throw new ApiError(400, 'At least one admin account must remain — promote another admin first');
        }
      }
      const updated = await r.updateProfileRole(req.params.id, req.body.role);
      if (!updated) throw new ApiError(404, 'User not found');
      res.json({ profile: updated });
    } catch (err) { next(err); }
  });

  router.get('/settings', async (_req, res, next) => {
    try { res.json({ settings: await repo().getSettings() }); } catch (err) { next(err); }
  });

  router.patch('/settings', validateBody(settingsSchema), async (req, res, next) => {
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
      res.json({ settings });
    } catch (err) { next(err); }
  });

  return router;
}

