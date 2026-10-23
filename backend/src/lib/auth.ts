import { createClient } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
import { ApiError, notConfigured } from './errors';
import type { ProfileDTO, Repository } from '../repositories/types';

/** Supabase Authenticator Assurance Level: aal1 = password (or OAuth)
 * only, aal2 = a verified MFA factor backs this session. */
export type AalLevel = 'aal1' | 'aal2';

export interface AuthedUser {
  id: string;
  email: string | null;
  /**
   * The assurance level OF THE VERIFIED TOKEN, when the verifier can
   * supply it. Verifiers that cannot (older fakes) omit it and callers
   * must treat the absence as aal1 — never as verified.
   */
  aal?: AalLevel;
}

/** Normalize a verified user's assurance level: only an explicit
 * 'aal2' counts as MFA-verified; anything else is aal1. */
export function aalOf(user: Pick<AuthedUser, 'aal'>): AalLevel {
  return user.aal === 'aal2' ? 'aal2' : 'aal1';
}

/**
 * Read the `aal` claim out of a JWT's payload segment. This is a
 * DECODE, not a verification — it is only ever applied to a token the
 * Supabase Auth server has ALREADY verified (see the verifier below),
 * so the claim read here is the claim the server vouched for. Any
 * malformed input (not a JWT, bad base64, non-JSON payload, no aal
 * claim) reads as aal1: absence of proof is never proof.
 */
export function aalFromVerifiedToken(token: string): AalLevel {
  try {
    const segment = token.split('.')[1];
    if (!segment) return 'aal1';
    const claims = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as { aal?: unknown };
    return claims.aal === 'aal2' ? 'aal2' : 'aal1';
  } catch {
    return 'aal1';
  }
}

export type TokenVerifier = (token: string) => Promise<AuthedUser | null>;

/** Production verifier: asks the Supabase Auth server to validate the JWT. */
export function createSupabaseTokenVerifier(url: string, serviceRoleKey: string): TokenVerifier {
  // One client per verifier instance, created lazily on the first verify.
  // The verifier itself is built once at startup (api/index.ts,
  // backend/src/index.ts) and then called on every authenticated request —
  // constructing a fresh Supabase client per call was pure overhead.
  let client: ReturnType<typeof createClient> | null = null;
  return async (token: string) => {
    client ??= createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error) {
      // supabase-js reports HTTP failures as errors instead of throwing.
      // A network/5xx failure is an outage (→ caller maps to 503), while a
      // 401/403 simply means the token is invalid (→ null → 401).
      const status = (error as { status?: number }).status;
      if (error.name === 'AuthRetryableFetchError' || (typeof status === 'number' && status >= 500)) {
        throw error;
      }
      return null;
    }
    if (!data.user) return null;
    // getUser() above is the verification: Supabase checked this
    // token's signature and expiry server-side. Only NOW is the
    // token's own aal claim read (a plain decode of the verified
    // token) — the claim is never taken from an unverified token, an
    // unverified decode, or anything the client asserts separately.
    return { id: data.user.id, email: data.user.email ?? null, aal: aalFromVerifiedToken(token) };
  };
}

export interface AuthedRequest extends Request {
  user?: AuthedUser & { aal: AalLevel; role: ProfileDTO['role']; profile: ProfileDTO };
}

export function requireAuth(deps: { repo: Repository | null; verifyToken: TokenVerifier }) {
  return async (req: AuthedRequest, _res: Response, next: NextFunction) => {
    try {
      if (!deps.repo) throw notConfigured();
      const header = req.header('authorization') ?? '';
      const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
      if (!token) throw new ApiError(401, 'Authentication required');
      let verified: AuthedUser | null;
      try {
        verified = await deps.verifyToken(token);
      } catch {
        throw new ApiError(503, 'Authentication service unavailable — please try again shortly');
      }
      if (!verified) throw new ApiError(401, 'Invalid or expired session');
      let profile = await deps.repo.getProfile(verified.id);
      if (!profile) {
        // Profile rows are created by a DB trigger on signup; this fallback
        // covers users created before the trigger existed.
        profile = await deps.repo.upsertProfile(verified.id, {});
      }
      req.user = { ...verified, aal: aalOf(verified), role: profile.role, profile };
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireRole(...roles: ProfileDTO['role'][]) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new ApiError(401, 'Authentication required'));
    if (!roles.includes(req.user.role)) return next(new ApiError(403, 'Insufficient permissions'));
    next();
  };
}

/**
 * Optional auth: attaches req.user when a valid token is present. An
 * absent or invalid token simply means "guest" — but if a token WAS
 * presented and the verifier itself failed (Supabase unreachable / 5xx,
 * the only case in which it throws), surface the same 503 requireAuth
 * gives instead of silently downgrading a signed-in visitor to guest.
 */
export function optionalAuth(deps: { repo: Repository | null; verifyToken: TokenVerifier }) {
  return async (req: AuthedRequest, _res: Response, next: NextFunction) => {
    const header = req.header('authorization') ?? '';
    const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
    if (!token || !deps.repo) return next();
    let verified: AuthedUser | null;
    try {
      verified = await deps.verifyToken(token);
    } catch {
      return next(new ApiError(503, 'Authentication service unavailable — please try again shortly'));
    }
    if (verified) {
      try {
        const profile = await deps.repo.getProfile(verified.id);
        if (profile) req.user = { ...verified, aal: aalOf(verified), role: profile.role, profile };
      } catch {
        // Attaching the profile stays best-effort on optional routes.
      }
    }
    return next();
  };
}
