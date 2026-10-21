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
import type { StorageService } from './lib/storage';
import type { StripeService } from './lib/stripe';
import { formsRouter } from './routes/forms';
import { accountRouter } from './routes/account';
import { chatRouter } from './routes/chat';
import type { ChatService } from './lib/chat';

export interface AppDeps {
  env: Env;
  repo: Repository | null;
  verifyToken: TokenVerifier;
  stripe?: StripeService | null;
  storage?: StorageService | null;
  chat?: ChatService | null;
}

export function createApp(deps: AppDeps): Express {
  const app = express();

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
  // Stripe webhook must see the RAW body for signature verification.
  app.post('/api/v1/payments/webhook', express.raw({ type: 'application/json' }), createWebhookHandler({ repo: deps.repo, stripe: deps.stripe ?? null }));
  // Menu image uploads travel as base64 JSON (5 MB file -> ~6.8 MB body), so
  // that one route gets a larger parser before the global 1 MB limit applies.
  app.use('/api/v1/admin/menu/upload', express.json({ limit: '8mb' }));
  app.use(express.json({ limit: '1mb' }));
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 600,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too many requests — please try again in a few minutes' },
    })
  );

  app.get('/api/v1/health', (_req, res) => {
    res.json({
      status: 'ok',
      supabaseConfigured: deps.env.supabaseConfigured,
      stripeConfigured: deps.env.stripeConfigured,
      geminiConfigured: deps.env.geminiConfigured,
      timestamp: new Date().toISOString(),
    });
  });

  app.use('/api/v1', publicRouter(deps));
  app.use('/api/v1', formsRouter(deps));
  app.use('/api/v1/account', accountRouter(deps));
  app.use('/api/v1', ordersRouter(deps));
  app.use('/api/v1', chatRouter({ repo: deps.repo, chat: deps.chat ?? null }));
  app.use('/api/v1', paymentsRouter({ repo: deps.repo, stripe: deps.stripe ?? null }));
  app.use('/api/v1/admin', adminRouter({ repo: deps.repo, verifyToken: deps.verifyToken, storage: deps.storage ?? null }));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
