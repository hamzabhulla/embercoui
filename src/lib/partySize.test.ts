import { describe, expect, it } from 'vitest';
import { GUEST_COUNT_OPTIONS, MAX_PARTY_SIZE } from './partySize.ts';

// CF-M2 pin: the frontend's party-size cap must equal the backend
// schema's (backend/src/lib/partySize.ts, pinned to the same value
// by its own suite). The two builds cannot share one module, so
// this pin is what keeps the copies from drifting apart again.
describe('MAX_PARTY_SIZE (frontend mirror)', () => {
  it('is exactly 20 — the value the server schema accepts', () => {
    expect(MAX_PARTY_SIZE).toBe(20);
  });

  it('the selector options are exactly 1..MAX_PARTY_SIZE', () => {
    expect(GUEST_COUNT_OPTIONS).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(GUEST_COUNT_OPTIONS[GUEST_COUNT_OPTIONS.length - 1]).toBe(MAX_PARTY_SIZE);
  });
});
