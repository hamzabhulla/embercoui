import { API_URL, apiRequest, fetchWithTimeout } from './api';

export type AdminSessionEvent = 'login' | 'mfa_verified' | 'logout';

/**
 * Login Activity reporting (Phase C) — best-effort by design, and
 * fire-and-forget at every call site. The backend writes the row
 * from the VERIFIED session token (the client supplies nothing but
 * which moment happened — never an actor, timestamp or IP), and a
 * failed report must never disturb sign-in, verification or
 * sign-out, so every error is swallowed here.
 *
 *   login        — the /admin/login page, right after a privileged
 *                  password sign-in succeeds on that page;
 *   mfa_verified — the MFA flow, right after a successful verify
 *                  (challenge or enrollment completion);
 *   logout       — the admin sign-out actions, awaited BEFORE the
 *                  token is discarded so the row still has a
 *                  verified identity to attach to.
 */
export async function reportAdminSessionEvent(event: AdminSessionEvent): Promise<void> {
  try {
    await apiRequest('/api/v1/admin/session-events', {
      method: 'POST',
      body: JSON.stringify({ event }),
    });
  } catch {
    // Best-effort — see above. (apiRequest already converts failures
    // into a result rather than throwing; this is belt and braces.)
  }
}

/**
 * A failed admin password attempt. The failure itself happens inside
 * Supabase Auth and never reaches the backend, so the sign-in page
 * reports it after the fact; the backend records it as an UNVERIFIED
 * client report (the Security UI badges it as such). No token is
 * attached — there is no session yet — and the outcome of this call
 * changes nothing in the UI.
 */
export async function reportAdminLoginFailed(email: string): Promise<void> {
  try {
    await fetchWithTimeout(`${API_URL}/api/v1/auth/admin-login-failed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
  } catch {
    // Fire-and-forget — see above.
  }
}
