import { describe, expect, it } from 'vitest';
import {
  CURRENCY_CODES, currencyExponent, formatMoney, fromMinorUnits, isValidCurrencyCode, toMinorUnits,
} from './currency';

// Audit-2 fix 10 — the frontend money mirror. These exponents MUST
// match the backend's (backend/src/lib/currency.ts): a drift here is
// exactly how a customer gets shown one amount and charged another.
// PKR is the trap case: Intl/CLDR reports 0 fraction digits for it,
// but its ISO minor unit (and Stripe's) is 2 — the tables below are
// written out independently of the implementation on purpose.

const ZERO = ['BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'];
const THREE = ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'];

describe('currencyExponent', () => {
  it('assigns 0 to every ISO zero-exponent currency', () => {
    for (const code of ZERO) expect(currencyExponent(code)).toBe(0);
  });

  it('assigns 3 to every ISO three-exponent currency', () => {
    for (const code of THREE) expect(currencyExponent(code)).toBe(3);
  });

  it('assigns 2 to ordinary currencies — PKR included', () => {
    for (const code of ['USD', 'EUR', 'GBP', 'PKR', 'AED', 'INR']) expect(currencyExponent(code)).toBe(2);
  });

  it('is case-insensitive and defaults sensibly', () => {
    expect(currencyExponent('jpy')).toBe(0);
    expect(currencyExponent('kwd')).toBe(3);
    expect(currencyExponent('')).toBe(2); // empty falls back to USD
    expect(currencyExponent('ZZZ')).toBe(2); // unlisted code takes the default branch
  });

  it('every code the picker offers is classified consistently', () => {
    expect(new Set(CURRENCY_CODES).size).toBe(CURRENCY_CODES.length); // no duplicates
    for (const code of ZERO) expect(CURRENCY_CODES).toContain(code);
    for (const code of THREE) expect(CURRENCY_CODES).toContain(code);
    for (const code of CURRENCY_CODES) expect([0, 2, 3]).toContain(currencyExponent(code));
  });
});

describe('minor-unit conversions', () => {
  it('converts at the currency exponent', () => {
    expect(toMinorUnits(19.99, 'USD')).toBe(1999);
    expect(toMinorUnits(10, 'PKR')).toBe(1000);
    expect(toMinorUnits(1500, 'JPY')).toBe(1500);
    expect(toMinorUnits(0.5, 'KWD')).toBe(500);
    expect(toMinorUnits(2.713, 'KWD')).toBe(2713);
    expect(toMinorUnits(1.005, 'KWD')).toBe(1005); // the float trap: 1.005 × 1000 lands just under, Math.round still reaches 1005
  });

  it('round-trips major → minor → major exactly for representative amounts', () => {
    const cases: [number, string][] = [[19.99, 'USD'], [1234.56, 'PKR'], [1500, 'JPY'], [2.713, 'KWD'], [0.001, 'KWD']];
    for (const [amount, code] of cases) {
      expect(fromMinorUnits(toMinorUnits(amount, code), code)).toBe(amount);
    }
  });
});

describe('isValidCurrencyCode', () => {
  it('accepts real ISO codes in any case, rejects the rest', () => {
    expect(isValidCurrencyCode('USD')).toBe(true);
    expect(isValidCurrencyCode('usd')).toBe(true);
    expect(isValidCurrencyCode('XXX')).toBe(true); // the genuine ISO "no currency" code
    expect(isValidCurrencyCode('ZZZ')).toBe(false);
    expect(isValidCurrencyCode('')).toBe(false);
  });
});

describe('formatMoney', () => {
  it('renders the ISO fraction digits, not Intl’s cash-rounding digits', () => {
    expect(formatMoney(1234.5, 'USD')).toBe('$1,234.50');
    expect(formatMoney(10, 'PKR')).toContain('10.00'); // Intl alone would print no fraction for PKR
    expect(formatMoney(1.005, 'KWD')).toContain('1.005');
    const jpy = formatMoney(1500, 'JPY');
    expect(jpy).toContain('1,500');
    expect(jpy).not.toContain('.');
  });
});
