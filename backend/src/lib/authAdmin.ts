import { createClient } from '@supabase/supabase-js';

/**
 * Supabase Auth Admin API access (Phase B) — the privileged half of
 * the MFA system. The backend's service-role client is the only code
 * allowed to touch another account's authenticator factors; the admin
 * router exposes exactly one operation built on it: the OWNER resetting
 * a locked-out person's factors so they can enroll again.
 *
 * TOTP itself stays entirely inside Supabase Auth (enrollment and
 * verification happen client-side against supabase-js auth.mfa with
 * the user's own session) — nothing here sees a code or a secret.
 */
export interface MfaFactorInfo {
  id: string;
  /** 'verified' once enrollment completed; 'unverified' = abandoned enrollment. */
  status: string;
  factorType: string;
}

export interface AuthAdminService {
  listMfaFactors(userId: string): Promise<MfaFactorInfo[]>;
  deleteMfaFactor(userId: string, factorId: string): Promise<void>;
}

export function createSupabaseAuthAdminService(url: string, serviceRoleKey: string): AuthAdminService {
  // One lazily-built client per service instance, like the token
  // verifier — constructing a Supabase client per call is pure overhead.
  let client: ReturnType<typeof createClient> | null = null;
  const admin = () => {
    client ??= createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return client.auth.admin;
  };
  return {
    async listMfaFactors(userId) {
      const { data, error } = await admin().mfa.listFactors({ userId });
      if (error) throw new Error(`MFA factor list failed: ${error.message}`);
      return (data.factors ?? []).map((f) => ({ id: f.id, status: f.status, factorType: f.factor_type }));
    },
    async deleteMfaFactor(userId, factorId) {
      const { error } = await admin().mfa.deleteFactor({ userId, id: factorId });
      if (error) throw new Error(`MFA factor delete failed: ${error.message}`);
    },
  };
}
