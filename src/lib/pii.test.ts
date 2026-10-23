import { describe, expect, it } from 'vitest';
import { maskPii } from './pii';

// Phase D — the one masking treatment the locked orders board uses.
// Phone keeps only its last two digits; email and address are fully
// masked with a fixed-length run so nothing (not even length) leaks;
// a name keeps its first name and reduces the surname to an initial,
// so the board can still match an order to the person at the counter
// without the full name ever appearing on a locked screen.

describe('maskPii', () => {
  it('phone: hides everything except the last two digits', () => {
    expect(maskPii('+92 300 1234534', 'phone')).toBe('••• ••• ••34');
    expect(maskPii('03001234534', 'phone')).toBe('••• ••• ••34');
    expect(maskPii('+1 (555) 010-2034', 'phone')).toBe('••• ••• ••34');
  });

  it('phone: a value with fewer than two digits is fully masked', () => {
    expect(maskPii('7', 'phone')).toBe('••••••••');
    expect(maskPii('', 'phone')).toBe('••••••••');
  });

  it('email: fully masked, and the mask never leaks the address length', () => {
    expect(maskPii('ayesha@example.com', 'email')).toBe('••••••••');
    expect(maskPii('a@b.co', 'email')).toBe(maskPii('a.much.longer.address@example.com', 'email'));
  });

  it('address: fully masked', () => {
    expect(maskPii('14-C Main Boulevard, Lahore', 'address')).toBe('••••••••');
  });

  it('name: first name in full, surname reduced to its initial', () => {
    expect(maskPii('Ayesha Khan', 'name')).toBe('Ayesha K.');
    // The surname itself never survives the mask.
    expect(maskPii('Ayesha Khan', 'name')).not.toContain('Khan');
  });

  it('name: with more than two tokens, the initial comes from the LAST token', () => {
    expect(maskPii('Mary Jane Watson', 'name')).toBe('Mary W.');
  });

  it('name: a single-token name has no surname to hide — the first name alone stands', () => {
    expect(maskPii('Ayesha', 'name')).toBe('Ayesha');
  });

  it('name: a hyphenated surname contributes the initial of its first part', () => {
    expect(maskPii('Ayesha Khan-Patel', 'name')).toBe('Ayesha K.');
    expect(maskPii('Anne-Marie Dupont-Smith', 'name')).toBe('Anne-Marie D.');
  });

  it('name: stray whitespace is normalised and the initial is uppercased', () => {
    expect(maskPii('  Ayesha   Khan  ', 'name')).toBe('Ayesha K.');
    expect(maskPii('ayesha khan', 'name')).toBe('ayesha K.');
  });

  it('name: an empty or whitespace-only value falls back to the fixed mask', () => {
    expect(maskPii('', 'name')).toBe('••••••••');
    expect(maskPii('   ', 'name')).toBe('••••••••');
  });
});
