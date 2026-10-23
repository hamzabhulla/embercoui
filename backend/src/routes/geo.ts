import { Router, type Response } from 'express';
import { notConfigured } from '../lib/errors';
import { renderLlms, renderLlmsFull, renderRobots, renderSitemap } from '../lib/geoFiles';
import type { Repository } from '../repositories/types';

/**
 * The generated GEO files (2026-10-23): /robots.txt, /sitemap.xml,
 * /llms.txt and /llms-full.txt, rendered per request from the live
 * settings + menu (lib/geoFiles.ts) — the pivot away from static
 * public/ files, which a per-client template could never keep in
 * sync by hand. app.ts mounts this router at BOTH '/' and '/api':
 * Vercel rewrites the public paths to /api/<file> (vercel.json), and
 * the standalone dev server serves them at the root directly.
 *
 * robots/sitemap need no data beyond the SITE_URL env, so they keep
 * serving even in health-only mode (no database); the llms files are
 * rendered FROM the database, so without one they answer the same
 * honest 503 as every other data route.
 */
export function geoRouter(deps: { repo: Repository | null; siteUrl: string; stripeConfigured?: boolean }) {
  const router = Router();

  const send = (res: Response, body: string, contentType: string) => {
    // Generated public files: a short shared cache keeps crawlers
    // from turning every hit into database reads, while five minutes
    // is brief enough that an admin edit shows up effectively at once.
    res.set('Cache-Control', 'public, max-age=300');
    res.type(contentType).send(body);
  };

  router.get('/robots.txt', (_req, res) => {
    send(res, renderRobots(deps.siteUrl), 'text/plain');
  });

  router.get('/sitemap.xml', (_req, res) => {
    send(res, renderSitemap(deps.siteUrl), 'application/xml');
  });

  const llms = (full: boolean) => async (_req: unknown, res: Response, next: (err?: unknown) => void) => {
    try {
      if (!deps.repo) throw notConfigured();
      const [settings, menu] = await Promise.all([deps.repo.getSettings(), deps.repo.listMenuItems()]);
      const src = { settings, menu, siteUrl: deps.siteUrl, cardProviderConfigured: deps.stripeConfigured ?? false };
      send(res, full ? renderLlmsFull(src) : renderLlms(src), 'text/plain');
    } catch (err) { next(err); }
  };
  router.get('/llms.txt', llms(false));
  router.get('/llms-full.txt', llms(true));

  return router;
}
