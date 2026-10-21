/**
 * Frontend mirror of the backend money rules (backend/src/lib/currency.ts).
 * Display formatting MUST use the same ISO exponents as the charging code:
 * Intl/CLDR reports some currencies (e.g. PKR) with 0 fraction digits,
 * which would show different amounts than the ones actually charged.
 */

const ZERO_EXPONENT = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG',
  'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);
const THREE_EXPONENT = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

export function currencyExponent(code: string): number {
  const c = (code || 'USD').toUpperCase();
  if (ZERO_EXPONENT.has(c)) return 0;
  if (THREE_EXPONENT.has(c)) return 3;
  return 2;
}

export function toMinorUnits(amountMajor: number, code: string): number {
  return Math.round(amountMajor * 10 ** currencyExponent(code));
}

export function fromMinorUnits(amountMinor: number, code: string): number {
  return amountMinor / 10 ** currencyExponent(code);
}

/**
 * The picker list is the backend's ISO 4217 set, mirrored verbatim — every
 * code offered here is one the backend accepts, so a selection can never
 * be rejected at save time.
 */
export const CURRENCY_CODES: string[] = [
  'AED', 'AFN', 'ALL', 'AMD', 'ANG', 'AOA', 'ARS', 'AUD', 'AWG', 'AZN',
  'BAM', 'BBD', 'BDT', 'BGN', 'BHD', 'BIF', 'BMD', 'BND', 'BOB', 'BOV',
  'BRL', 'BSD', 'BTN', 'BWP', 'BYN', 'BZD', 'CAD', 'CDF', 'CHE', 'CHF',
  'CHW', 'CLP', 'CNY', 'COP', 'COU', 'CRC', 'CUP', 'CVE', 'CZK', 'DJF',
  'DKK', 'DOP', 'DZD', 'EGP', 'ERN', 'ETB', 'EUR', 'FJD', 'FKP', 'GBP',
  'GEL', 'GHS', 'GIP', 'GMD', 'GNF', 'GTQ', 'GYD', 'HKD', 'HNL', 'HTG',
  'HUF', 'IDR', 'ILS', 'INR', 'IQD', 'IRR', 'ISK', 'JMD', 'JOD', 'JPY',
  'KES', 'KGS', 'KHR', 'KMF', 'KPW', 'KRW', 'KWD', 'KYD', 'KZT', 'LAK',
  'LBP', 'LKR', 'LRD', 'LSL', 'LYD', 'MAD', 'MDL', 'MGA', 'MKD', 'MMK',
  'MNT', 'MOP', 'MRO', 'MRU', 'MUR', 'MVR', 'MWK', 'MXN', 'MXV', 'MYR',
  'MZN', 'NAD', 'NGN', 'NIO', 'NOK', 'NPR', 'NZD', 'OMR', 'PAB', 'PEN',
  'PGK', 'PHP', 'PKR', 'PLN', 'PYG', 'QAR', 'RON', 'RSD', 'RUB', 'RWF',
  'SAR', 'SBD', 'SCR', 'SDG', 'SEK', 'SGD', 'SHP', 'SLE', 'SLL', 'SOS',
  'SRD', 'SSP', 'STN', 'SVC', 'SYP', 'SZL', 'THB', 'TJS', 'TMT', 'TND',
  'TOP', 'TRY', 'TTD', 'TWD', 'TZS', 'UAH', 'UGX', 'USD', 'USN', 'UYI',
  'UYU', 'UYW', 'UZS', 'VED', 'VES', 'VND', 'VUV', 'WST', 'XAF', 'XAG',
  'XAU', 'XBA', 'XBB', 'XBC', 'XBD', 'XCD', 'XDR', 'XOF', 'XPD', 'XPF',
  'XPT', 'XSU', 'XTS', 'XUA', 'XXX', 'YER', 'ZAR', 'ZMW', 'ZWL',
];

export function isValidCurrencyCode(code: string): boolean {
  return CURRENCY_CODES.includes((code || '').toUpperCase());
}

export function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'currency' }).of(code.toUpperCase()) ?? code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

/** Format a major-unit amount for display, with the ISO-correct fraction digits. */
export function formatMoney(amount: number, code: string): string {
  const c = (code || 'USD').toUpperCase();
  const exp = currencyExponent(c);
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: c,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(amount);
  } catch {
    return `${c} ${amount.toFixed(exp)}`;
  }
}
