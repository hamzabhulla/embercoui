export interface Env {
  nodeEnv: string;
  port: number;
  corsOrigins: string[];
  supabaseUrl: string | null;
  supabaseServiceRoleKey: string | null;
  supabaseConfigured: boolean;
  stripeSecretKey: string | null;
  stripeWebhookSecret: string | null;
  stripeConfigured: boolean;
  geminiApiKey: string | null;
  geminiConfigured: boolean;
  geminiModel: string | null;
  trustProxy: number | undefined;
  /**
   * The site's public origin (no trailing slash) — the base for every
   * absolute URL the server generates (robots.txt, sitemap.xml,
   * llms.txt, llms-full.txt). Per-client go-live env: each restaurant's
   * install sets SITE_URL to its own domain; the default is this
   * demo's Vercel origin.
   */
  siteUrl: string;
}

export const DEFAULT_SITE_URL = 'https://embercoui.vercel.app';

// SITE_URL must be an absolute http(s) origin; anything else (blank,
// unparseable, another scheme) falls back to the default rather than
// generating broken or unsafe absolute URLs into public files.
function parseSiteUrl(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_SITE_URL;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_SITE_URL;
    return trimmed;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

function parsePort(raw: string | undefined): number {
  if (!raw) return 4000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT "${raw}" — must be an integer between 1 and 65535`);
  }
  return port;
}

// TRUST_PROXY is the number of proxy hops in front of the app whose
// X-Forwarded-For entries Express should trust (on Vercel: 1 — the
// platform edge is the one hop). It must stay a hop COUNT, never `true`:
// a permissive trust-proxy makes req.ip attacker-controlled and
// express-rate-limit refuses it (ERR_ERL_PERMISSIVE_TRUST_PROXY).
// Unset or unparseable → undefined, and createApp leaves Express's
// default (false) untouched, so direct/local deployments are unchanged.
function parseTrustProxy(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const hops = Number(trimmed);
  if (!Number.isInteger(hops) || hops < 0) return undefined;
  return hops;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const supabaseUrl = source.SUPABASE_URL?.trim() || null;
  const supabaseServiceRoleKey = source.SUPABASE_SERVICE_ROLE_KEY?.trim() || null;
  if (Boolean(supabaseUrl) !== Boolean(supabaseServiceRoleKey)) {
    throw new Error(
      'Supabase configuration is incomplete: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set together (or both left unset for health-only mode).'
    );
  }
  const stripeSecretKey = source.STRIPE_SECRET_KEY?.trim() || null;
  const geminiApiKey = source.GEMINI_API_KEY?.trim() || null;
  const stripeWebhookSecret = source.STRIPE_WEBHOOK_SECRET?.trim() || null;
  return {
    nodeEnv: source.NODE_ENV || 'development',
    port: parsePort(source.PORT),
    corsOrigins: (source.CORS_ORIGIN || 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    supabaseUrl,
    supabaseServiceRoleKey,
    supabaseConfigured: Boolean(supabaseUrl && supabaseServiceRoleKey),
    stripeSecretKey,
    stripeWebhookSecret,
    // "Configured" means payments can actually SETTLE (mega-audit
    // M2): a secret key alone can mint intents, but without the
    // webhook secret the webhook 503s on verification, so no charge
    // could ever be confirmed. Key-only therefore reads as NOT
    // configured everywhere this flag is consumed (fee rule, public
    // settings, admin provider flag, chat/GEO grounding, health).
    stripeConfigured: Boolean(stripeSecretKey && stripeWebhookSecret),
    geminiApiKey,
    geminiConfigured: Boolean(geminiApiKey),
    geminiModel: source.GEMINI_MODEL?.trim() || null,
    trustProxy: parseTrustProxy(source.TRUST_PROXY),
    siteUrl: parseSiteUrl(source.SITE_URL),
  };
}
