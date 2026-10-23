import 'dotenv/config';
import { loadEnv } from './config/env';
import { createSupabaseRepository } from './repositories/supabaseRepository';
import { createSupabaseTokenVerifier, type TokenVerifier } from './lib/auth';
import { createSupabaseAuthAdminService, type AuthAdminService } from './lib/authAdmin';
import { createApp } from './app';
import { createStripeService, type StripeService } from './lib/stripe';
import { createStorageService, type StorageService } from './lib/storage';
import { createGeminiChatService, type ChatService } from './lib/chat';
import type { Repository } from './repositories/types';

function main() {
  const env = loadEnv();
  let repo: Repository | null = null;
  let verifyToken: TokenVerifier = async () => null;
  let authAdmin: AuthAdminService | null = null;
  if (env.supabaseConfigured && env.supabaseUrl && env.supabaseServiceRoleKey) {
    repo = createSupabaseRepository(env.supabaseUrl, env.supabaseServiceRoleKey);
    verifyToken = createSupabaseTokenVerifier(env.supabaseUrl, env.supabaseServiceRoleKey);
    authAdmin = createSupabaseAuthAdminService(env.supabaseUrl, env.supabaseServiceRoleKey);
  } else {
    console.warn('[ember] Supabase is not configured — DB endpoints will respond 503. See SUPABASE_SETUP.md.');
  }
  let stripe: StripeService | null = null;
  if (env.stripeConfigured && env.stripeSecretKey) {
    // stripeConfigured now requires BOTH secrets (mega-audit M2), so
    // a constructed service can always settle what it mints.
    stripe = createStripeService(env.stripeSecretKey, env.stripeWebhookSecret);
  } else if (env.stripeSecretKey) {
    // Key-only deployment: no service is constructed at all, so no
    // intent can be minted for a charge that could never settle (the
    // webhook would 503 on verification without its secret). Every
    // surface reads card payments as not configured.
    console.warn('[ember] STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is not — card payments are disabled until the webhook secret is set, because charges could never be confirmed.');
  }
  const storage: StorageService | null =
    env.supabaseConfigured && env.supabaseUrl && env.supabaseServiceRoleKey
      ? createStorageService(env.supabaseUrl, env.supabaseServiceRoleKey)
      : null;
  const chat: ChatService | null = env.geminiApiKey ? createGeminiChatService(env.geminiApiKey, env.geminiModel) : null;
  if (!chat) {
    console.warn('[ember] GEMINI_API_KEY is not set — Ember AI chat will respond 503 until it is configured.');
  }
  const app = createApp({ env, repo, verifyToken, stripe, storage, chat, authAdmin });
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
