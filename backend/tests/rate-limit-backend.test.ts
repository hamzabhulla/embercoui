import { describe, expect, it, vi } from 'vitest';

// OPS-M1 audit correction — the PRODUCTION backend's PostgREST reply
// parsing (createSupabaseRateLimitBackend → client.rpc) was correct
// but unpinned: no test executed it. The Supabase client is stubbed
// at the house seam (the '@supabase/supabase-js' module, as in
// auth-verifier-real.test.ts) and rpc answers with the shapes
// PostgREST actually produces for the 0018 rate_limit_hit RPC.

type RpcResult = { data: unknown; error: { message: string } | null };

const rpcState = vi.hoisted(() => ({
  impl: null as null | ((fn: string, args: Record<string, unknown>) => Promise<RpcResult>),
  calls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    rpc: (fn: string, args: Record<string, unknown>) => {
      rpcState.calls.push({ fn, args });
      if (!rpcState.impl) throw new Error('rpc behaviour not configured for this test');
      return rpcState.impl(fn, args);
    },
  }),
}));

import { createSupabaseRateLimitBackend } from '../src/lib/rateLimitStore';

const RESET_ISO = '2026-10-23T12:15:00.000Z';
const backend = () => createSupabaseRateLimitBackend('https://stub.invalid', 'stub-service-key');
const answering = (result: RpcResult) => {
  rpcState.calls = [];
  rpcState.impl = async () => result;
};

describe('createSupabaseRateLimitBackend — rate_limit_hit reply parsing', () => {
  it('parses the array-of-rows reply PostgREST returns for a set-returning RPC', async () => {
    answering({ data: [{ total_hits: 3, reset_at: RESET_ISO }], error: null });
    const info = await backend().hit('chat:192.0.2.40', 60_000);
    expect(info.totalHits).toBe(3);
    expect(info.resetTime).toBeInstanceOf(Date);
    expect((info.resetTime as Date).toISOString()).toBe(RESET_ISO);
    // The RPC is called with the 0018 argument names.
    expect(rpcState.calls).toEqual([{ fn: 'rate_limit_hit', args: { p_key: 'chat:192.0.2.40', p_window_ms: 60_000 } }]);
  });

  it('parses a single-row (non-array) reply the same way', async () => {
    answering({ data: { total_hits: 1, reset_at: RESET_ISO }, error: null });
    const info = await backend().hit('chat:192.0.2.41', 60_000);
    expect(info).toEqual({ totalHits: 1, resetTime: new Date(RESET_ISO) });
  });

  it('a PostgREST error reply throws (into the store degradation path)', async () => {
    answering({ data: null, error: { message: 'function public.rate_limit_hit(text, bigint) does not exist' } });
    await expect(backend().hit('chat:192.0.2.42', 60_000)).rejects.toThrow(/rate_limit_hit failed/);
  });

  const malformed: Array<[string, unknown]> = [
    ['empty array (no row)', []],
    ['null data', null],
    ['total_hits is a string', [{ total_hits: '3', reset_at: RESET_ISO }]],
    ['total_hits is a non-integer', [{ total_hits: 1.5, reset_at: RESET_ISO }]],
    ['reset_at is not a date string', [{ total_hits: 2, reset_at: 'not-a-date' }]],
    ['reset_at is missing', [{ total_hits: 2 }]],
  ];

  it.each(malformed)('a malformed payload (%s) throws instead of returning a bogus count', async (_name, data) => {
    answering({ data, error: null });
    await expect(backend().hit('chat:192.0.2.43', 60_000)).rejects.toThrow(/malformed row/);
  });
});
