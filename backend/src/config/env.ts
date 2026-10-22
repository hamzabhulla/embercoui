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
    stripeConfigured: Boolean(stripeSecretKey),
    geminiApiKey,
    geminiConfigured: Boolean(geminiApiKey),
    geminiModel: source.GEMINI_MODEL?.trim() || null,
    trustProxy: parseTrustProxy(source.TRUST_PROXY),
  };
}
