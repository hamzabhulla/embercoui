import { Router } from 'express';
import { z } from 'zod';
import { ApiError, notConfigured } from '../lib/errors';
import { optionalAuth, type AuthedRequest } from '../lib/auth';
import type { TokenVerifier } from '../lib/auth';
import { validateBody } from '../middleware/validate';
import type { OrderDTO, Repository } from '../repositories/types';

const money = (cents: number) => Math.round(cents) / 100;

const orderSchema = z.object({
  customerName: z.string().trim().min(1, 'Full name is required'),
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
  items: z
    .array(
      z.object({
        menuItemId: z.number().int('Invalid menu item'),
        quantity: z.number().int().min(1, 'Quantity must be at least 1').max(50, 'Quantity is too large'),
      })
    )
    .min(1, 'Your cart is empty'),
});

const couponSchema = z.object({ code: z.string().trim().min(1, 'Coupon code is required').max(40) });

export function ordersRouter(deps: { repo: Repository | null; verifyToken: TokenVerifier }) {
  const router = Router();
  const repo = () => {
    if (!deps.repo) throw notConfigured();
    return deps.repo;
  };

  router.post('/orders', optionalAuth(deps), validateBody(orderSchema), async (req: AuthedRequest, res, next) => {
    try {
      const body = req.body as z.infer<typeof orderSchema>;
      const r = repo();

      // Prices are ALWAYS recalculated from the database — anything the
      // client claims about prices is ignored by design.
      const lines: { menuItemId: number; name: string; unitPrice: number; quantity: number }[] = [];
      let subtotalCents = 0;
      for (const line of body.items) {
        const item = await r.getMenuItem(line.menuItemId);
        if (!item) throw new ApiError(400, 'One of the items in your cart is no longer available');
        const unitCents = Math.round(item.price * 100);
        subtotalCents += unitCents * line.quantity;
        lines.push({ menuItemId: item.id, name: item.name, unitPrice: money(unitCents), quantity: line.quantity });
      }

      let discountCents = 0;
      let appliedCoupon: string | null = null;
      if (body.couponCode) {
        const coupon = await r.getCouponByCode(body.couponCode);
        const expired = coupon?.expiresAt ? new Date(coupon.expiresAt).getTime() < Date.now() : false;
        if (!coupon || !coupon.isActive || expired) {
          throw new ApiError(400, 'This coupon code is not valid');
        }
        discountCents =
          coupon.type === 'percent'
            ? Math.round((subtotalCents * coupon.value) / 100)
            : Math.min(Math.round(coupon.value * 100), subtotalCents);
        appliedCoupon = coupon.code;
      }

      // Delivery is free — that is the promise the cart UI has always made.
      const deliveryFeeCents = 0;
      // The stored discount never exceeds the subtotal (a coupon can cover at
      // most the whole bill), so totals and discounts always reconcile.
      const effectiveDiscountCents = Math.min(discountCents, subtotalCents);
      const totalCents = Math.max(0, subtotalCents - effectiveDiscountCents + deliveryFeeCents);

      const order = await r.createOrder({
        userId: req.user?.id ?? null,
        customerName: body.customerName,
        customerEmail: body.customerEmail,
        customerPhone: body.customerPhone ?? null,
        address: body.address ?? null,
        notes: body.notes ?? null,
        couponCode: appliedCoupon,
        items: lines,
        subtotal: money(subtotalCents),
        deliveryFee: money(deliveryFeeCents),
        discount: money(effectiveDiscountCents),
        total: money(totalCents),
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
