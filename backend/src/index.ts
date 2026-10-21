import 'dotenv/config';
import { loadEnv } from './config/env';
import { createSupabaseRepository } from './repositories/supabaseRepository';
import { createSupabaseTokenVerifier, type TokenVerifier } from './lib/auth';
import { createApp } from './app';
import { createStripeService, type StripeService } from './lib/stripe';
import { createStorageService, type StorageService } from './lib/storage';
import type { Repository } from './repositories/types';

function main() {
  const env = loadEnv();
  let repo: Repository | null = null;
  let verifyToken: TokenVerifier = async () => null;
  if (env.supabaseConfigured && env.supabaseUrl && env.supabaseServiceRoleKey) {
    repo = createSupabaseRepository(env.supabaseUrl, env.supabaseServiceRoleKey);
    verifyToken = createSupabaseTokenVerifier(env.supabaseUrl, env.supabaseServiceRoleKey);
  } else {
    console.warn('[ember] Supabase is not configured — DB endpoints will respond 503. See SUPABASE_SETUP.md.');
  }
  let stripe: StripeService | null = null;
  if (env.stripeSecretKey) {
    stripe = createStripeService(env.stripeSecretKey, env.stripeWebhookSecret);
    if (!env.stripeWebhookSecret) {
      console.warn('[ember] STRIPE_WEBHOOK_SECRET is not set — the payments webhook will respond 503 until it is configured.');
    }
  }
  const storage: StorageService | null =
    env.supabaseConfigured && env.supabaseUrl && env.supabaseServiceRoleKey
      ? createStorageService(env.supabaseUrl, env.supabaseServiceRoleKey)
      : null;
  const app = createApp({ env, repo, verifyToken, stripe, storage });
  app.listen(env.port, () => {
    console.log(`[ember] API listening on http://localhost:${env.port} (${env.nodeEnv})`);
  });
}

try {
  main();
} catch (err) {
  console.error('[ember] Failed to start:', err instanceof Error ? err.message : err);
  process.exit(1);
}
