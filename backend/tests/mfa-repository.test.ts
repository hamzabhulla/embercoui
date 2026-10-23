import { beforeEach, describe, expect, it, vi } from 'vitest';

// Phase B — the REAL Supabase repository's mfa_required surface,
// pinned against the shared PostgREST miniature (./stubSupabase),
// above all the PRE-0013 behaviour: until the owner runs migration
// 0013 the profiles table has no mfa_required column, profiles are
// read with select('*') so the key is simply ABSENT, and that absence
// must survive the DTO as undefined — lib/mfa.ts reads it as "the
// requirement system is not in force" (enforcement off), where null
// would mean "column exists, follow the role default" (enforcement
// on for owner/manager). Collapsing the two would lock every owner
// out of a pre-migration database.

vi.mock('@supabase/supabase-js', async () => {
  const m = await import('./stubSupabase');
  return { createClient: m.stubSupabase.createClient };
});

import { stubSupabase as stub, type Row } from './stubSupabase';
import { createSupabaseRepository } from '../src/repositories/supabaseRepository';
import { effectiveMfaRequired } from '../src/lib/mfa';

const repo = createSupabaseRepository('https://stub.invalid', 'stub-key');

const ts = (sec: number) => new Date(Date.UTC(2026, 0, 1) + sec * 1000).toISOString();
const rows = (table: string): Row[] => stub.tables.get(table) ?? [];

function profileRow(id: string, patch: Row = {}): Row {
  return {
    id, role: 'customer', full_name: `Person ${id}`, phone: null,
    addresses: [], favorites: [], created_at: ts(1), ...patch,
  };
}

beforeEach(() => stub.reset());

describe('profile DTO: the mfa_required tri-state', () => {
  it('an ABSENT key (pre-0013 row) reads as undefined — enforcement off', async () => {
    stub.seed('profiles', [profileRow('admin-1', { role: 'admin' })]); // no mfa_required key at all
    const dto = await repo.getProfile('admin-1');
    expect(dto?.mfaRequired).toBeUndefined();
    expect(effectiveMfaRequired(dto!)).toBe(false); // NOT the owner default: the system is not in force
  });

  it('a present NULL reads as null — follow the role default', async () => {
    stub.seed('profiles', [
      profileRow('admin-1', { role: 'admin', mfa_required: null }),
      profileRow('staff-1', { role: 'staff', mfa_required: null }),
    ]);
    const owner = await repo.getProfile('admin-1');
    const staff = await repo.getProfile('staff-1');
    expect(owner?.mfaRequired).toBeNull();
    expect(effectiveMfaRequired(owner!)).toBe(true);
    expect(effectiveMfaRequired(staff!)).toBe(false);
  });

  it('explicit true/false survive; a garbage stored value reads as null, never as a requirement', async () => {
    stub.seed('profiles', [
      profileRow('s-1', { role: 'staff', mfa_required: true }),
      profileRow('m-1', { role: 'manager', mfa_required: false }),
      profileRow('g-1', { role: 'admin', mfa_required: 'yes' }),
    ]);
    expect((await repo.getProfile('s-1'))?.mfaRequired).toBe(true);
    expect((await repo.getProfile('m-1'))?.mfaRequired).toBe(false);
    expect((await repo.getProfile('g-1'))?.mfaRequired).toBeNull();
    expect(effectiveMfaRequired((await repo.getProfile('s-1'))!)).toBe(true);
    expect(effectiveMfaRequired((await repo.getProfile('m-1'))!)).toBe(false);
  });
});

describe('setUserMfaRequired: write + degradation', () => {
  it('stores true, false and null verbatim and returns the updated profile', async () => {
    stub.seed('profiles', [profileRow('p-1', { role: 'staff', mfa_required: null })]);
    expect((await repo.setUserMfaRequired('p-1', true))?.mfaRequired).toBe(true);
    expect(rows('profiles')[0].mfa_required).toBe(true);
    expect((await repo.setUserMfaRequired('p-1', false))?.mfaRequired).toBe(false);
    expect(rows('profiles')[0].mfa_required).toBe(false);
    expect((await repo.setUserMfaRequired('p-1', null))?.mfaRequired).toBeNull();
    expect(rows('profiles')[0].mfa_required).toBeNull();
  });

  it('an unknown or malformed id resolves to null, never a throw', async () => {
    stub.seed('profiles', [profileRow('p-1', { mfa_required: null })]);
    expect(await repo.setUserMfaRequired('ghost', true)).toBeNull();
    expect(await repo.setUserMfaRequired('not-a-uuid', true)).toBeNull();
  });

  it('PRE-0013: with the column missing, the write no-ops and returns the profile as it stands', async () => {
    stub.seed('profiles', [profileRow('p-1', { role: 'admin' })]); // pre-0013 shape: no key
    stub.setMissingColumns('profiles', ['mfa_required']);
    const result = await repo.setUserMfaRequired('p-1', true);
    expect(result?.id).toBe('p-1');
    expect(result?.mfaRequired).toBeUndefined();
    expect('mfa_required' in rows('profiles')[0]).toBe(false); // nothing was written
  });
});
