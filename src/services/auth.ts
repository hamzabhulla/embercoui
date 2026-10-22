import { supabase, isSupabaseConfigured } from '../lib/supabase.ts';

export { isSupabaseConfigured };

export interface AuthResult {
  error: string | null;
  /** True when the user must confirm their email before they can sign in. */
  needsEmailConfirmation?: boolean;
}

const NOT_AVAILABLE = 'Accounts are not available at the moment — please check back soon.';

function friendly(error: { message: string }): string {
  const msg = error.message || '';
  // OAuth provider problems (e.g. Google not enabled in the Supabase
  // dashboard yet) must never surface Supabase's raw wording (audit H-8).
  if (/unsupported provider|provider is not enabled|provider not (found|enabled|configured)/i.test(msg)) {
    return "Google sign-in isn't available yet — please use email and password for now.";
  }
  if (/invalid login credentials/i.test(msg)) return 'Invalid email or password';
  if (/already registered|already exists/i.test(msg)) return 'An account with this email already exists — try signing in instead.';
  if (/password should be/i.test(msg)) return 'Password must be at least 8 characters';
  if (/unable to validate email/i.test(msg)) return 'Invalid email format';
  return msg || 'Something went wrong — please try again';
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return { error: NOT_AVAILABLE };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error ? friendly(error) : null };
}

export async function signUpWithEmail(input: {
  name: string; email: string; phone: string; password: string;
}): Promise<AuthResult> {
  if (!supabase) return { error: NOT_AVAILABLE };
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: { data: { full_name: input.name, phone: input.phone } },
  });
  if (error) return { error: friendly(error) };
  return { error: null, needsEmailConfirmation: Boolean(data.user && !data.session) };
}

export async function sendPasswordReset(email: string): Promise<AuthResult> {
  if (!supabase) return { error: NOT_AVAILABLE };
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
  return { error: error ? friendly(error) : null };
}

export async function updatePassword(newPassword: string): Promise<AuthResult> {
  if (!supabase) return { error: NOT_AVAILABLE };
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  return { error: error ? friendly(error) : null };
}

export async function signOut(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

// Pages that must never be a post-auth landing: the auth screens
// themselves, and /reset-password — without a live recovery link it
// only renders its "invalid link" state, so returning there after a
// successful sign-in would strand the visitor on a dead end.
const NO_RETURN_PATHS = ['/login', '/signup', '/forgot-password', '/reset-password'];

/**
 * Sanitise a post-auth return target "by construction" — the single
 * definition shared by the router (App.tsx) and Google OAuth below, so
 * the two can never drift apart. Only a plain same-origin app path is
 * honoured: it must start with exactly one '/' — a second '/' makes it
 * protocol-relative ('//evil.com'), and a backslash ('/\evil.com') is
 * treated the same way by some URL parsers — and it must contain no
 * backslash anywhere, so it can never be reinterpreted as an off-site
 * URL by the router or by OAuth's redirectTo. Anything else (empty,
 * absolute, or an auth route itself) falls back to the home page.
 */
export function sanitizeReturnPath(path: string | null | undefined): string {
  if (!path || !path.startsWith('/')) return '/';
  if (path[1] === '/' || path.includes('\\')) return '/';
  if (NO_RETURN_PATHS.includes(path)) return '/';
  return path;
}

/**
 * Google sign-in / sign-up via Supabase OAuth (full-page redirect).
 * The provider must be enabled in Supabase Dashboard -> Authentication ->
 * Providers -> Google, with the site origin allow-listed under
 * Authentication -> URL Configuration. On return, AuthContext picks the
 * session up automatically and the profile row is created by the
 * handle_new_user trigger (full_name comes from the Google profile).
 */
export async function signInWithGoogle(returnPath = '/'): Promise<AuthResult> {
  if (!supabase) return { error: NOT_AVAILABLE };
  // Land back on the page the visitor came from, not unconditionally
  // the home page — sanitised by the same helper the router uses, so
  // only same-origin app paths are honoured, and never an auth route
  // itself (returning to /login while signed in would just re-open
  // the form).
  const safePath = sanitizeReturnPath(returnPath);
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}${safePath}` },
  });
  return { error: error ? friendly(error) : null };
}

/** Re-send the signup confirmation email (used by the "Check your email" screen). */
export async function resendConfirmation(email: string): Promise<AuthResult> {
  if (!supabase) return { error: NOT_AVAILABLE };
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  return { error: error ? friendly(error) : null };
}
