/**
 * Multi-currency money handling.
 *
 * Amounts are stored and shown in MAJOR units (e.g. dollars) everywhere in
 * the API and database; conversion to a currency's MINOR units happens only
 * where an external system needs integers (Stripe charges).
 *
 * Validation uses the ISO 4217 alphabetic code list below — deliberately NOT
 * `Intl.NumberFormat`: Intl only rejects structurally malformed codes, and
 * happily "formats" bogus codes like 'ZZZ'. Every code in the list is one
 * Intl can format, including 'XXX' (the real ISO code for "no currency").
 *
 * Exponents also come from ISO 4217, not Intl: CLDR/Intl reports some
 * currencies (e.g. PKR) with 0 fraction digits because of cash-rounding
 * conventions, but their ISO minor unit — and Stripe's — is 2. Using Intl
 * here would mis-price charges by 100×.
 */

/** ISO 4217 alphabetic codes (current, plus recently retired ones still in circulation). */
const ISO_4217_CODES = new Set([
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
]);

/** ISO 4217 minor-unit exponent 0 (no minor unit in practice). */
const ZERO_EXPONENT = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG',
  'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

/** ISO 4217 minor-unit exponent 3 (1 major = 1000 minor, e.g. dinars). */
const THREE_EXPONENT = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

/** Trim + uppercase. Does not validate — see isValidCurrencyCode. */
export function normalizeCurrencyCode(input: string): string {
  return input.trim().toUpperCase();
}

/** True only for a real ISO 4217 alphabetic code (input may be any case). */
export function isValidCurrencyCode(code: string): boolean {
  return ISO_4217_CODES.has(normalizeCurrencyCode(code));
}

/**
 * Canonicalize a value coming from storage: a valid ISO code (uppercased),
 * or 'USD' when the stored value is missing/garbage (e.g. rows written
 * before the currency column existed).
 */
export function sanitizeCurrencyCode(input: unknown): string {
  if (typeof input !== 'string') return 'USD';
  const code = normalizeCurrencyCode(input);
  return ISO_4217_CODES.has(code) ? code : 'USD';
}

/** Minor units per major unit exponent: USD/EUR/PKR = 2, JPY/KRW = 0, KWD/BHD = 3. */
export function currencyExponent(code: string): number {
  const normalized = normalizeCurrencyCode(code);
  if (ZERO_EXPONENT.has(normalized)) return 0;
  if (THREE_EXPONENT.has(normalized)) return 3;
  return 2;
}

/** Major units → integer minor units, rounded at the currency's precision. */
/** Round a major-unit amount to the currency's own precision (2dp for USD/PKR, 0 for JPY, 3 for KWD). */
export function roundMajorUnits(amountMajor: number, code: string): number {
  const factor = 10 ** currencyExponent(code);
  return Math.round(amountMajor * factor) / factor;
}

export function toMinorUnits(amountMajor: number, code: string): number {
  return Math.round(amountMajor * 10 ** currencyExponent(code));
}

/** Integer minor units → major units. */
export function fromMinorUnits(amountMinor: number, code: string): number {
  return amountMinor / 10 ** currencyExponent(code);
}

/**
 * Smallest sensible card charge, in minor units. Mirrors Stripe's usual
 * ~0.50-major-unit minimum scaled by the exponent: 50 for USD/EUR/PKR,
 * 50 for JPY/KRW (¥50), 500 for KWD/BHD (0.500 dinar).
 */
export function cardMinimumMinorUnits(code: string): number {
  return 50 * 10 ** Math.max(0, currencyExponent(code) - 2);
}
