import { Router } from 'express';
import { ApiError, notConfigured } from '../lib/errors';
import type { Repository } from '../repositories/types';

export function publicRouter(deps: { repo: Repository | null }) {
  const router = Router();
  const repo = () => {
    if (!deps.repo) throw notConfigured();
    return deps.repo;
  };

  router.get('/menu', async (_req, res, next) => {
    try {
      res.json({ items: await repo().listMenuItems() });
    } catch (err) { next(err); }
  });

  router.get('/menu/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) throw new ApiError(400, 'Invalid menu item id');
      const item = await repo().getMenuItem(id);
      if (!item) throw new ApiError(404, 'Menu item not found');
      res.json({ item });
    } catch (err) { next(err); }
  });

  router.get('/settings/public', async (_req, res, next) => {
    try {
      res.json({ settings: await repo().getSettings() });
    } catch (err) { next(err); }
  });

  router.get('/reviews/approved', async (_req, res, next) => {
    try {
      res.json({ reviews: await repo().listApprovedReviews() });
    } catch (err) { next(err); }
  });

  return router;
}
