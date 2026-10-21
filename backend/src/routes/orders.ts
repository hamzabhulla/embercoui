import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ApiError, notConfigured } from '../lib/errors';
import { optionalAuth, type AuthedRequest } from '../lib/auth';
import type { TokenVerifier } from '../lib/auth';
import { validateBody } from '../middleware/validate';
import { fromMinorUnits, toMinorUnits } from '../lib/currency';
import type { OrderDTO, Repository } from '../repositories/types';

const orderSchema = z.object({
  customerName: z.string().trim().min(1, 'Full name is required').max(120),
  customerEmail: z.string().trim().min(1, 'Email is required').email('Invalid email format'),
  customerPhone: z.string().trim().max(30).optional().nullable(),
  address: z
    .object({
      label: z.string().trim().max(40).optional(),
      line1: z.string().trim().min(1, 'Address line is required'),
      city: z.string().trim().min(1, 'City is required'),
      postalCode: z.string().trim().max(20).optional(),
      phone: z.string().trim().max(30).optional(),
    })
    .optional()
    .nullable(),
  notes: z.string().trim().max(300).optional().nullable(),
  couponCode: z.string().trim().max(40).optional().nullable(),
  // One key per checkout attempt (the page generates it on mount). A retry
  // or double submit carrying the same key returns the original order
  // instead of duplicating it. Optional: key-less clients behave as before.
  idempotencyKey: z.string().trim().min(8).max(80).optional().nullable(),
  items: z
    .array(
      z.object({
        menuItemId: z.number().int('Invalid menu item'),
        quantity: z.number().int().min(1, 'Quantity must be at least 1').max(50, 'Quantity is too large'),
      })
    )
    .min(1, 'Your cart is empty')
    // A real order never has more distinct lines than this; the cap keeps a
    // single request from fanning out into unbounded per-line menu lookups.
    .max(50, 'Too many items in one order'),
});

const couponSchema = z.object({ code: z.string().trim().min(1, 'Coupon code is required').max(40) });

export function ordersRouter(deps: { repo: Repository | null; verifyToken: TokenVerifier; rateLimitMax?: number }) {
  const router = Router();
  const repo = () => {
    if (!deps.repo) throw notConfigured();
    return deps.repo;
  };

  // Dedicated order-creation budget (same factory pattern as the chat
  // limiter): generous for a household behind one NAT address, hostile to
  // scripted order spam. Only order creation is metered — tracking reads
  // and coupon checks stay on the global limiter.
  const orderLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: deps.rateLimitMax ?? 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many orders — please try again in a few minutes' },
  });

  router.post('/orders', orderLimiter, optionalAuth(deps), validateBody(orderSchema), async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body as z.infer<typeof orderSchema>;
      const r = repo();

      const settings = await r.getSettings();
      // A closed kitchen takes no orders. The storefront hides ordering
      // when the toggle is off, but the API enforces it too — a stale or
      // scripted client must not slip an order in.
      if (!settings.kitchenOpen) {
        throw new ApiError(400, 'The kitchen is currently closed — ordering will reopen soon');
      }
      // The order is denominated in the restaurant's CURRENT currency and
      // snapshots it — a later currency switch never rewrites this order.
      // All math runs in that currency's minor units (USD/PKR: 100 per
      // major, JPY: 1, KWD: 1000), so no exponent can skew a total.
      const { currency } = settings;

      // Prices are ALWAYS recalculated from the database — anything the
      // client claims about prices is ignored by design.
      const lines: { menuItemId: number; name: string; unitPrice: number; quantity: number }[] = [];
      let subtotalMinor = 0;
      for (const line of body.items) {
        const item = await r.getMenuItem(line.menuItemId);
        if (!item) throw new ApiError(400, 'One of the items in your cart is no longer available');
        const unitMinor = toMinorUnits(item.price, currency);
        subtotalMinor += unitMinor * line.quantity;
        lines.push({ menuItemId: item.id, name: item.name, unitPrice: fromMinorUnits(unitMinor, currency), quantity: line.quantity });
      }

      let discountMinor = 0;
      let appliedCoupon: string | null = null;
      if (body.couponCode) {
        const coupon = await r.getCouponByCode(body.couponCode);
        const expired = coupon?.expiresAt ? new Date(coupon.expiresAt).getTime() < Date.now() : false;
        if (!coupon || !coupon.isActive || expired) {
          throw new ApiError(400, 'This coupon code is not valid');
        }
        // Fixed coupons are denominated in the current currency too.
        discountMinor =
          coupon.type === 'percent'
            ? Math.round((subtotalMinor * coupon.value) / 100)
            : Math.min(toMinorUnits(coupon.value, currency), subtotalMinor);
        appliedCoupon = coupon.code;
      }

      // Delivery is free — that is the promise the cart UI has always made.
      const deliveryFeeMinor = 0;
      // The stored discount never exceeds the subtotal (a coupon can cover at
      // most the whole bill), so totals and discounts always reconcile.
      const effectiveDiscountMinor = Math.min(discountMinor, subtotalMinor);
      const totalMinor = Math.max(0, subtotalMinor - effectiveDiscountMinor + deliveryFeeMinor);

      const order = await r.createOrder({
        userId: req.user?.id ?? null,
        customerName: body.customerName,
        customerEmail: body.customerEmail,
        customerPhone: body.customerPhone ?? null,
        address: body.address ?? null,
        notes: body.notes ?? null,
        couponCode: appliedCoupon,
        currency,
        idempotencyKey: body.idempotencyKey ?? null,
        items: lines,
        subtotal: fromMinorUnits(subtotalMinor, currency),
        deliveryFee: fromMinorUnits(deliveryFeeMinor, currency),
        discount: fromMinorUnits(effectiveDiscountMinor, currency),
        total: fromMinorUnits(totalMinor, currency),
      });
      res.status(201).json({ order });
    } catch (err) { next(err); }
  });

  router.get('/orders/:id', optionalAuth(deps), async (req: AuthedRequest, res, next) => {
    try {
      const order = await repo().getOrder(req.params.id);
      if (!order) throw new ApiError(404, 'Order not found');
      // Guest orders (no account) are trackable by their unguessable id.
      // Account orders are visible only to their owner or staff/admin.
      if (order.userId) {
        const isOwner = req.user?.id === order.userId;
        const isStaff = req.user?.role === 'admin' || req.user?.role === 'staff';
        if (!isOwner && !isStaff) throw new ApiError(404, 'Order not found');
      }
      res.json({ order });
    } catch (err) { next(err); }
  });

  router.post('/coupons/validate', validateBody(couponSchema), async (req, res, next) => {
    try {
      const { code } = req.body as z.infer<typeof couponSchema>;
      const coupon = await repo().getCouponByCode(code);
      const expired = coupon?.expiresAt ? new Date(coupon.expiresAt).getTime() < Date.now() : false;
      if (!coupon || !coupon.isActive || expired) {
        res.json({ valid: false });
        return;
      }
      res.json({ valid: true, coupon: { code: coupon.code, type: coupon.type, value: coupon.value } });
    } catch (err) { next(err); }
  });

  return router;
}

export type { OrderDTO };
