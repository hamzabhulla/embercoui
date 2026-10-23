import { describe, expect, it } from 'vitest';
import { maskPii } from './pii';

// Phase D — the one masking treatment the locked orders board uses.
// Phone keeps only its last two digits; email and address are fully
// masked with a fixed-length run so nothing (not even length) leaks.

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
});
