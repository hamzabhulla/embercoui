import { createClient } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
import { ApiError, notConfigured } from './errors';
import type { ProfileDTO, Repository } from '../repositories/types';

export interface AuthedUser {
  id: string;
  email: string | null;
}

export type TokenVerifier = (token: string) => Promise<AuthedUser | null>;

/** Production verifier: asks the Supabase Auth server to validate the JWT. */
export function createSupabaseTokenVerifier(url: string, serviceRoleKey: string): TokenVerifier {
  return async (token: string) => {
    const client = createClient(url, serviceRoleKey, {
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
    return { id: data.user.id, email: data.user.email ?? null };
  };
}

export interface AuthedRequest extends Request {
  user?: AuthedUser & { role: ProfileDTO['role']; profile: ProfileDTO };
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
      req.user = { ...verified, role: profile.role, profile };
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

/** Optional auth: attaches req.user when a valid token is present, never rejects. */
export function optionalAuth(deps: { repo: Repository | null; verifyToken: TokenVerifier }) {
  return async (req: AuthedRequest, _res: Response, next: NextFunction) => {
    try {
      const header = req.header('authorization') ?? '';
      const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
      if (token && deps.repo) {
        const verified = await deps.verifyToken(token);
        if (verified) {
          const profile = await deps.repo.getProfile(verified.id);
          if (profile) req.user = { ...verified, role: profile.role, profile };
        }
      }
      next();
    } catch {
      next();
    }
  };
}
