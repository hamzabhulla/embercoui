/**
 * Two-factor state as reported by GET /admin/me (Phase B). The
 * backend resolves it per request (per-person flag over role
 * default, checked against the verified token's aal) — the client
 * never computes enforcement itself; it only renders what /me says:
 * satisfied callers enter the panel, unsatisfied ones get the
 * enrollment/challenge flow (components/admin/MfaFlow).
 */
export interface MfaState {
  required: boolean;
  satisfied: boolean;
}

/**
 * The role defaults for the requirement, mirrored from the backend
 * (backend/src/lib/mfa.ts) for DISPLAY only — the Staff page labels
 * its "Default" option with them ("Default (On)" for owner/manager,
 * "Default (Off)" for staff). The effective value that governs a
 * person always comes from the API, never from this mirror.
 */
export function mfaRoleDefaultRequired(role: string): boolean {
  return role === 'admin' || role === 'manager';
}

/**
 * Supabase MFA errors in the admin design system's voice — shared by
 * the sign-in flow (components/admin/MfaFlow) and the screen-lock
 * step-up (components/admin/LockedView) so a bad code reads the
 * same everywhere.
 */
export function friendlyMfaError(message: string | undefined): string {
  const msg = message ?? '';
  if (/invalid.*code|code.*invalid|verification_failed/i.test(msg)) {
    return 'That code did not match — check your authenticator app and try again.';
  }
  if (/expired/i.test(msg)) return 'That code has expired — enter the current code from your authenticator app.';
  if (/too many|rate/i.test(msg)) return 'Too many attempts — wait a moment and try again.';
  return msg || 'Something went wrong — please try again.';
}
