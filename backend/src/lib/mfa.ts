import type { AalLevel } from './auth';
import type { ProfileDTO } from '../repositories/types';

/**
 * Owner-controlled two-factor requirement (Phase B of the access
 * system; migration 0013).
 *
 * Two-factor authentication itself is Supabase Auth's TOTP MFA — this
 * module only decides WHO must complete it. A person's requirement is
 * the tri-state column profiles.mfa_required:
 *
 *   true / false — the owner's explicit per-person decision (Staff
 *                  page); it wins over the role default in BOTH
 *                  directions (staff can be made to require it, the
 *                  owner can release a manager — or themselves);
 *   null         — no decision stored: the role default below applies
 *                  (Owner ON, Manager ON, Staff OFF);
 *   ABSENT       — the profile carries no value at all, which happens
 *                  only before migration 0013 runs (profiles are read
 *                  with select('*'), so a missing column is simply a
 *                  missing key). In that world enforcement is OFF
 *                  entirely: the panel behaves exactly as it did
 *                  before Phase B, and nobody can be locked out by a
 *                  migration that has not run yet.
 *
 * Enforcement is per request, server-side: an admin API caller whose
 * requirement is in force must present a token Supabase issued at
 * aal2 (see lib/auth.ts — the claim is read from the server-verified
 * token only). routes/admin.ts turns an unsatisfied requirement into
 * a 403 carrying the code below; GET /admin/me is exempt and reports
 * the state instead, so the frontend can run the enrollment/challenge
 * flow.
 */

export const MFA_REQUIRED_CODE = 'MFA_REQUIRED';

/** Role defaults for the tri-state's null arm. */
export const MFA_ROLE_DEFAULTS: Record<string, boolean> = {
  admin: true,
  manager: true,
  staff: false,
  customer: false,
};

export function effectiveMfaRequired(
  profile: Pick<ProfileDTO, 'role' | 'mfaRequired'>,
): boolean {
  // Pre-0013: the column does not exist, so the key is absent — the
  // requirement system is not in force at all.
  if (profile.mfaRequired === undefined) return false;
  if (typeof profile.mfaRequired === 'boolean') return profile.mfaRequired;
  return MFA_ROLE_DEFAULTS[profile.role] ?? false;
}

export interface MfaState {
  /** The requirement in force for this account right now. */
  required: boolean;
  /** True when no step is outstanding: not required, or verified at aal2. */
  satisfied: boolean;
}

export function mfaStateFor(
  profile: Pick<ProfileDTO, 'role' | 'mfaRequired'>,
  aal: AalLevel | undefined,
): MfaState {
  const required = effectiveMfaRequired(profile);
  return { required, satisfied: !required || aal === 'aal2' };
}
