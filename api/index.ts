// Vercel serverless entry point — the SAME Express app as backend/src,
// composed the same way as backend/src/index.ts but WITHOUT listen():
// Vercel invokes this handler per request. The standalone server
// (backend/src/index.ts, used for Railway / local dev) is untouched,
// so both deployment paths stay available.
//
// NOTE on imports: the .js extensions below are required — this package
// is ESM ("type": "module"), and Node ESM resolution (which Vercel's
// builder uses for the generated function) rejects extensionless
// relative imports. They resolve to the .ts sources at build time.
//
// NOTE on bodies: there is no bodyParser config to set here. The Stripe
// webhook's raw body is safe because backend/src/app.ts mounts
// express.raw() for the webhook route before the JSON parser, and the
// default export being an Express app means the platform hands the
// request stream to Express untouched.
import { loadEnv } from '../backend/src/config/env.js';
import { createApp } from '../backend/src/app.js';
import { createSupabaseRepository } from '../backend/src/repositories/supabaseRepository.js';
import { createSupabaseTokenVerifier, type TokenVerifier } from '../backend/src/lib/auth.js';
import { createStripeService, type StripeService } from '../backend/src/lib/stripe.js';
import { createStorageService, type StorageService } from '../backend/src/lib/storage.js';
import type { Repository } from '../backend/src/repositories/types.js';

const env = loadEnv();

let repo: Repository | null = null;
let verifyToken: TokenVerifier = async () => null;
if (env.supabaseConfigured && env.supabaseUrl && env.supabaseServiceRoleKey) {
  repo = createSupabaseRepository(env.supabaseUrl, env.supabaseServiceRoleKey);
  verifyToken = createSupabaseTokenVerifier(env.supabaseUrl, env.supabaseServiceRoleKey);
}

const stripe: StripeService | null = env.stripeSecretKey
  ? createStripeService(env.stripeSecretKey, env.stripeWebhookSecret)
  : null;

const storage: StorageService | null =
  env.supabaseConfigured && env.supabaseUrl && env.supabaseServiceRoleKey
    ? createStorageService(env.supabaseUrl, env.supabaseServiceRoleKey)
    : null;

const app = createApp({ env, repo, verifyToken, stripe, storage });

export default app;
