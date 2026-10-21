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
