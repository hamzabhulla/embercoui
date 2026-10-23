import { describe, expect, it } from 'vitest';
import { MAX_PARTY_SIZE, OVER_PARTY_SIZE_MESSAGE } from '../src/lib/partySize';
import { reservationSchema } from '../src/routes/forms';

// CF-M2 pin + boundary: the server is the truth for the online
// party-size cap. The frontend mirror (src/lib/partySize.ts) is
// pinned to the same 20 by its own suite.
describe('MAX_PARTY_SIZE (backend)', () => {
  it('is exactly 20', () => {
    expect(MAX_PARTY_SIZE).toBe(20);
  });

  it('the over-cap message names that value', () => {
    expect(OVER_PARTY_SIZE_MESSAGE).toBe('For parties over 20, please contact us directly');
  });
});

const base = {
  name: 'Jane Guest', email: 'jane@example.com', phone: '+1 555 000 1234',
  date: '2999-01-15', time: '19:00',
};

describe('reservationSchema party-size boundary', () => {
  it('accepts a party of exactly 20', () => {
    const parsed = reservationSchema.safeParse({ ...base, guests: 20 });
    expect(parsed.success).toBe(true);
  });

  it('rejects a party of 21 with the contact-us message', () => {
    const parsed = reservationSchema.safeParse({ ...base, guests: 21 });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const guestIssue = parsed.error.issues.find((i) => i.path.includes('guests'));
      expect(guestIssue?.message).toBe('For parties over 20, please contact us directly');
    }
  });
});
