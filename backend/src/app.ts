import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import type { Env } from './config/env';
import type { Repository } from './repositories/types';
import type { TokenVerifier } from './lib/auth';
import { errorHandler, notFound } from './middleware/errors';
import { publicRouter } from './routes/public';
import { ordersRouter } from './routes/orders';
import { paymentsRouter, createWebhookHandler } from './routes/payments';
import { adminRouter } from './routes/admin';
import type { AuthAdminService } from './lib/authAdmin';
import type { StorageService } from './lib/storage';
import type { StripeService } from './lib/stripe';
import { formsRouter } from './routes/forms';
import { authEventsRouter } from './routes/authEvents';
import { accountRouter } from './routes/account';
import { chatRouter } from './routes/chat';
import { geoRouter } from './routes/geo';
import type { ChatService } from './lib/chat';

export interface AppDeps {
  env: Env;
  repo: Repository | null;
  verifyToken: TokenVerifier;
  stripe?: StripeService | null;
  storage?: StorageService | null;
  chat?: ChatService | null;
  // Supabase Auth Admin API (owner's MFA factor reset, Phase B).
  authAdmin?: AuthAdminService | null;
  // Test-only override for the global limiter budget (same pattern as the
  // chat/orders routers' rateLimitMax). Production always uses 600.
  globalRateLimitMax?: number;
  // Test-only override for the coupon-validate limiter budget, so the
  // throttle can be pinned without firing 60 requests. Production
  // always uses the router default (60 / 15 min).
  couponRateLimitMax?: number;
}

export function createApp(deps: AppDeps): Express {
  const app = express();

  // Behind a proxy (Vercel), req.ip is the proxy's address unless Express
  // is told how many hops to trust — without this every visitor shares
  // one rate-limit bucket. Applied only when TRUST_PROXY is configured
  // (env.ts guarantees a non-negative integer hop count, never `true`).
  if (deps.env.trustProxy !== undefined) {
    app.set('trust proxy', deps.env.trustProxy);
  }

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        // Allow non-browser clients (no Origin) and whitelisted origins.
        // Disallowed origins simply get no CORS headers (the browser blocks
        // the response) instead of a misleading 500.
        callback(null, !origin || deps.env.corsOrigins.includes(origin));
      },
      credentials: true,
    })
  );
  // Stripe webhook must see the RAW body for signature verification. The
  // 1 MB limit is explicit: the implicit body-parser default (100 KB)
  // could 413 a legitimately large Stripe event; real events are far
  // smaller than 1 MB.
  app.post('/api/v1/payments/webhook', express.raw({ type: 'application/json', limit: '1mb' }), createWebhookHandler({ repo: deps.repo, stripe: deps.stripe ?? null }));
  // The global limiter runs BEFORE the body parsers: it only reads
  // headers, so an unauthenticated garbage body is counted (and, past
  // the budget, refused with 429) without ever being parsed. It stays
  // after the webhook route above, which must keep seeing the raw body
  // untouched and is not limiter-counted, exactly as before.
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: deps.globalRateLimitMax ?? 600,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too many requests — please try again in a few minutes' },
    })
  );
  // Menu image uploads travel as base64 JSON. The client caps the base64
  // payload at 4.2M chars (AdminMenu MAX_ENCODED_CHARS), so a legitimate
  // body is at most ~4.21 MB. This limit sits above that and below the
  // serverless platform's 4.5 MB request-body cap, so an oversized upload
  // fails with OUR 413 (errorHandler maps entity.too.large) instead of
  // the platform's opaque rejection. (Bytes, not '4.4mb' — the string
  // form is binary-based and would exceed the platform cap.) It stays
  // mounted ahead of the global 1 MB parser, which is a no-op for a body
  // this parser already consumed.
  app.use('/api/v1/admin/menu/upload', express.json({ limit: 4_400_000 }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/v1/health', (_req, res) => {
    res.json({
      status: 'ok',
      supabaseConfigured: deps.env.supabaseConfigured,
      stripeConfigured: deps.env.stripeConfigured,
      geminiConfigured: deps.env.geminiConfigured,
      timestamp: new Date().toISOString(),
    });
  });

  // The generated GEO files (robots/sitemap/llms) live OUTSIDE /api/v1:
  // Vercel rewrites /robots.txt etc. to /api/<file>, and the standalone
  // server serves them at the root — one router, both mounts.
  const geo = geoRouter({ repo: deps.repo, siteUrl: deps.env.siteUrl, stripeConfigured: deps.env.stripeConfigured });
  app.use('/api', geo);
  app.use('/', geo);

  app.use('/api/v1', publicRouter({ repo: deps.repo, stripeConfigured: deps.env.stripeConfigured }));
  app.use('/api/v1', formsRouter(deps));
  app.use('/api/v1', authEventsRouter({ repo: deps.repo }));
  app.use('/api/v1/account', accountRouter(deps));
  app.use('/api/v1', ordersRouter({
    repo: deps.repo,
    verifyToken: deps.verifyToken,
    // Test suites fire dozens of orders from one IP against shared app
    // instances, so the order budget is relaxed under NODE_ENV=test. The
    // production budget (30 / 15 min) itself is verified by the
    // orders-hardening suite, which builds a production-mode app.
    rateLimitMax: deps.env.nodeEnv === 'test' ? 1000 : undefined,
    couponRateLimitMax: deps.couponRateLimitMax,
  }));
  app.use('/api/v1', chatRouter({ repo: deps.repo, chat: deps.chat ?? null, verifyToken: deps.verifyToken, stripeConfigured: deps.env.stripeConfigured }));
  app.use('/api/v1', paymentsRouter({ repo: deps.repo, stripe: deps.stripe ?? null, verifyToken: deps.verifyToken }));
  app.use('/api/v1/admin', adminRouter({ repo: deps.repo, verifyToken: deps.verifyToken, storage: deps.storage ?? null, authAdmin: deps.authAdmin ?? null, stripeConfigured: deps.env.stripeConfigured }));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
