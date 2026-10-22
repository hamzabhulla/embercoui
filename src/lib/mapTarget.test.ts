import { describe, expect, it } from 'vitest';
import { resolveMapTarget } from './mapTarget.ts';
import type { ContactContacts } from '../services/api.ts';

const contact = (over: Partial<ContactContacts> = {}): ContactContacts => ({
  phone: null, email: null, address: null, hours: null,
  mapLocation: null, mapLat: null, mapLng: null, ...over,
});

describe('resolveMapTarget (Contact page map priority)', () => {
  it('the dropped pin wins over every text field', () => {
    const c = contact({ mapLat: 24.8608, mapLng: 67.0011, mapLocation: 'Text Place', address: '1 Contact Road' });
    expect(resolveMapTarget(c, '9 Profile Avenue')).toBe('24.8608,67.0011');
  });

  it('with no pin, the Map location text wins over both addresses', () => {
    const c = contact({ mapLocation: 'Text Place', address: '1 Contact Road' });
    expect(resolveMapTarget(c, '9 Profile Avenue')).toBe('Text Place');
  });

  it('with no pin and no Map location text, the Contact address wins over the profile address', () => {
    const c = contact({ address: '1 Contact Road' });
    expect(resolveMapTarget(c, '9 Profile Avenue')).toBe('1 Contact Road');
  });

  it('falls back to the profile address, then to null (map hidden)', () => {
    expect(resolveMapTarget(contact(), '9 Profile Avenue')).toBe('9 Profile Avenue');
    expect(resolveMapTarget(contact(), null)).toBeNull();
    expect(resolveMapTarget(null, null)).toBeNull();
    expect(resolveMapTarget(undefined, undefined)).toBeNull();
  });

  it('a lone half-pin is not a pin — the text fallback speaks', () => {
    const c = contact({ mapLat: 24.8608, mapLng: null, mapLocation: 'Text Place' });
    expect(resolveMapTarget(c, null)).toBe('Text Place');
  });

  it('a pin at 0,0 still counts (numbers, not truthiness)', () => {
    const c = contact({ mapLat: 0, mapLng: 0 });
    expect(resolveMapTarget(c, null)).toBe('0,0');
  });
});
