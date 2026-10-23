import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * The configured project URL (trailing slashes stripped), or '' when
 * unset. Exposed so components that need public storage-object URLs
 * (e.g. the hero media in lib/heroMedia.ts) derive them from the same
 * config source as the client instead of hard-coding a project ref.
 */
export const supabaseUrl: string = (url ?? '').replace(/\/+$/, '');

/**
 * Browser Supabase client (anon key only — safe to expose). Used for Auth
 * and Realtime. All data access goes through the Express API, which uses
 * the service-role key server-side. When the VITE_ vars are unset the site
 * still renders fully; account features simply report themselves unavailable.
 */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string)
  : null;
