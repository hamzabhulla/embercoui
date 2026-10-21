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
}

function parsePort(raw: string | undefined): number {
  if (!raw) return 4000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid PORT "${raw}" — must be an integer between 1 and 65535`);
  }
  return port;
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
  };
}
