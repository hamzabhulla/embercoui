import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase B — the REAL Supabase Auth Admin service
// (createSupabaseAuthAdminService → client.auth.admin.mfa) executes
// in tests against the shared stub, the same seam the repository
// tests use. The owner's "reset two-factor" endpoint is only as
// trustworthy as these calls: listFactors must surface the factors
// as stored, deleteFactor must remove exactly one factor of exactly
// that user.

vi.mock('@supabase/supabase-js', async () => {
  const m = await import('./stubSupabase');
  return { createClient: m.stubSupabase.createClient };
});

import { stubSupabase as stub } from './stubSupabase';
import { createSupabaseAuthAdminService } from '../src/lib/authAdmin';

const service = createSupabaseAuthAdminService('https://stub.invalid', 'stub-service-key');

beforeEach(() => stub.reset());

describe('createSupabaseAuthAdminService against the stub', () => {
  it('lists a user\'s factors with id, status and type mapped to the DTO shape', async () => {
    stub.seedAuthFactors('user-1', [
      { id: 'fac-1', factor_type: 'totp', status: 'verified' },
      { id: 'fac-2', factor_type: 'totp', status: 'unverified' },
    ]);
    await expect(service.listMfaFactors('user-1')).resolves.toEqual([
      { id: 'fac-1', status: 'verified', factorType: 'totp' },
      { id: 'fac-2', status: 'unverified', factorType: 'totp' },
    ]);
  });

  it('an account with no factors lists as empty — not an error', async () => {
    await expect(service.listMfaFactors('nobody')).resolves.toEqual([]);
  });

  it('deleteFactor removes exactly that factor of exactly that user', async () => {
    stub.seedAuthFactors('user-1', [
      { id: 'fac-1', factor_type: 'totp', status: 'verified' },
      { id: 'fac-2', factor_type: 'totp', status: 'unverified' },
    ]);
    stub.seedAuthFactors('user-2', [{ id: 'fac-1', factor_type: 'totp', status: 'verified' }]);
    await service.deleteMfaFactor('user-1', 'fac-1');
    expect(stub.authFactors.get('user-1')).toEqual([{ id: 'fac-2', factor_type: 'totp', status: 'unverified' }]);
    // The same factor id under another user is untouched.
    expect(stub.authFactors.get('user-2')).toEqual([{ id: 'fac-1', factor_type: 'totp', status: 'verified' }]);
    await expect(service.listMfaFactors('user-1')).resolves.toEqual([
      { id: 'fac-2', status: 'unverified', factorType: 'totp' },
    ]);
  });
});
