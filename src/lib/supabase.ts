import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Browser Supabase client (anon key only — safe to expose). Used for Auth
 * and Realtime. All data access goes through the Express API, which uses
 * the service-role key server-side. When the VITE_ vars are unset the site
 * still renders fully; account features simply report themselves unavailable.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string)
  : null;
