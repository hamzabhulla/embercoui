import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

// Audit-2 Fix 10 (H-5) — the REAL Supabase token verifier
// (createSupabaseTokenVerifier → client.auth.getUser) executes in
// tests. Every other suite injects fakeVerifyToken, so the production
// classification — invalid/expired → null (401), Auth-server outage
// → throw (503), valid → the user — was never pinned. The Supabase
// client is stubbed at exactly the seam the repository stub uses
// (the '@supabase/supabase-js' module), and getUser answers per
// token, shaped like the real Auth API's responses. The repository
// is the fake: profile behaviour downstream of verification is
// already pinned there — the verifier is the subject here.

type GetUserResult = {
  data: { user: { id: string; email?: string } | null };
  error: { name: string; status?: number; message: string } | null;
};

const getUserImpl = vi.hoisted(() => ({
  impl: null as null | ((token: string) => Promise<GetUserResult>),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: (token: string) => {
        if (!getUserImpl.impl) throw new Error('getUser behaviour not configured for this test');
        return getUserImpl.impl(token);
      },
    },
  }),
}));

import { createApp } from '../src/app';
import { createSupabaseTokenVerifier } from '../src/lib/auth';
import { FakeRepository, testEnv } from './fakeRepository';

// JWT-shaped tokens for the aal pins (Phase B): the stubbed Auth API
// "verifies" them by returning the user, exactly as the real API does
// for a well-signed token — the aal the verifier reports must then
// come from the token's OWN claims, decoded only after that verdict.
const jwtWith = (claims: unknown) =>
  `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const AAL2_TOKEN = jwtWith({ sub: 'user-1', aal: 'aal2' });
const AAL1_TOKEN = jwtWith({ sub: 'user-1', aal: 'aal1' });
const NO_AAL_TOKEN = jwtWith({ sub: 'user-1' });
const GARBAGE_PAYLOAD_TOKEN = 'eyJhbGciOiJub25lIn0.@@@.sig'; // payload segment is not base64/JSON at all

const AUTH_RESPONSES: Record<string, GetUserResult> = {
  // A live session for the seeded customer user-1.
  'good-token': { data: { user: { id: 'user-1', email: 'user@example.com' } }, error: null },
  [AAL2_TOKEN]: { data: { user: { id: 'user-1', email: 'user@example.com' } }, error: null },
  [AAL1_TOKEN]: { data: { user: { id: 'user-1', email: 'user@example.com' } }, error: null },
  [NO_AAL_TOKEN]: { data: { user: { id: 'user-1', email: 'user@example.com' } }, error: null },
  [GARBAGE_PAYLOAD_TOKEN]: { data: { user: { id: 'user-1', email: 'user@example.com' } }, error: null },
  // A live Auth user with NO profile row (created before the
  // handle_new_user trigger existed, per the requireAuth comment).
  'new-user-token': { data: { user: { id: 'brand-new-user', email: 'new@example.com' } }, error: null },
  // The Auth API's answer for a forged/garbled JWT.
  'bad-token': { data: { user: null }, error: { name: 'AuthApiError', status: 401, message: 'invalid JWT: unable to parse or verify signature' } },
  // …and for an expired one. Both are 401-class: the verifier maps
  // them to null, NOT to an outage.
  'expired-token': { data: { user: null }, error: { name: 'AuthApiError', status: 401, message: 'JWT expired' } },
  // Network/Auth outage shapes: supabase-js surfaces these as
  // AuthRetryableFetchError or a 5xx status — the verifier rethrows
  // so the middleware can answer 503 instead of lying with a 401.
  'outage-token': { data: { user: null }, error: { name: 'AuthRetryableFetchError', message: 'fetch failed' } },
  'server-error-token': { data: { user: null }, error: { name: 'AuthApiError', status: 502, message: 'Bad Gateway' } },
  // Defensive shape: no user, no error → treated as invalid.
  'empty-token': { data: { user: null }, error: null },
};
getUserImpl.impl = async (token: string) => AUTH_RESPONSES[token] ?? AUTH_RESPONSES['bad-token'];

const repo = new FakeRepository();
const verifyToken = createSupabaseTokenVerifier('https://stub.invalid', 'stub-service-key');
const app = createApp({ env: testEnv(), repo, verifyToken });

const getProfile = (token?: string) => {
  let req = request(app).get('/api/v1/account/profile');
  if (token !== undefined) req = req.set('Authorization', `Bearer ${token}`);
  return req;
};

describe('createSupabaseTokenVerifier — classification (unit level)', () => {
  it('returns the user for a valid token (a non-JWT token carries no aal claim → aal1)', async () => {
    await expect(verifyToken('good-token')).resolves.toEqual({ id: 'user-1', email: 'user@example.com', aal: 'aal1' });
  });

  it('reads the aal claim from the VERIFIED token: aal2 only when the claim says so', async () => {
    await expect(verifyToken(AAL2_TOKEN)).resolves.toEqual({ id: 'user-1', email: 'user@example.com', aal: 'aal2' });
    await expect(verifyToken(AAL1_TOKEN)).resolves.toMatchObject({ aal: 'aal1' });
    // No aal claim at all = aal1 (absence of proof is never proof),
    // and an undecodable payload degrades to aal1 the same way — a
    // malformed claim can never elevate a session.
    await expect(verifyToken(NO_AAL_TOKEN)).resolves.toMatchObject({ aal: 'aal1' });
    await expect(verifyToken(GARBAGE_PAYLOAD_TOKEN)).resolves.toMatchObject({ aal: 'aal1' });
  });

  it('an aal2 CLAIM on an INVALID token elevates nothing — verification comes first', async () => {
    // AUTH_RESPONSES has no entry for this string, so the stub answers
    // with the invalid-JWT response: the verifier must return null,
    // never a user carrying the forged claim.
    const forged = jwtWith({ sub: 'user-1', aal: 'aal2', forged: true });
    await expect(verifyToken(forged)).resolves.toBeNull();
  });

  it('returns null for invalid and for expired tokens (401-class, not an outage)', async () => {
    await expect(verifyToken('bad-token')).resolves.toBeNull();
    await expect(verifyToken('expired-token')).resolves.toBeNull();
    await expect(verifyToken('empty-token')).resolves.toBeNull();
  });

  it('THROWS for an Auth outage (retryable fetch error / 5xx) so callers can answer 503', async () => {
    await expect(verifyToken('outage-token')).rejects.toThrow();
    await expect(verifyToken('server-error-token')).rejects.toThrow();
  });
});

describe('requireAuth with the REAL verifier', () => {
  it('a valid token reaches the route with the profile attached', async () => {
    const res = await getProfile('good-token');
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ id: 'user-1', email: 'user@example.com', role: 'customer', fullName: 'Test User' });
  });

  it('an invalid token answers 401 Invalid or expired session', async () => {
    const res = await getProfile('bad-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired session');
  });

  it('an expired token answers the same 401', async () => {
    const res = await getProfile('expired-token');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid or expired session');
  });

  it('a missing Authorization header answers 401 Authentication required', async () => {
    const res = await getProfile();
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Authentication required');
  });

  it('an Auth outage answers 503 — never a misleading 401', async () => {
    const res = await getProfile('outage-token');
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/Authentication service unavailable/);
  });

  it('a verified user with NO profile row gets one created by the fallback and proceeds', async () => {
    expect(await repo.getProfile('brand-new-user')).toBeNull();
    const res = await getProfile('new-user-token');
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ id: 'brand-new-user', email: 'new@example.com', role: 'customer' });
    // The fallback upsert is the real behaviour (pre-trigger users):
    // the row now exists.
    expect(await repo.getProfile('brand-new-user')).not.toBeNull();
  });
});
