import { Router } from 'express';
import { z } from 'zod';
import { ApiError, notConfigured } from '../lib/errors';
import { requireAuth, type AuthedRequest } from '../lib/auth';
import type { TokenVerifier } from '../lib/auth';
import { validateBody } from '../middleware/validate';
import type { Repository } from '../repositories/types';

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

