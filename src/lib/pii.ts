/**
 * Customer-PII masking for the admin screen lock (Phase D). One
 * treatment, defined once, used by every PII spot the locked orders
 * board renders — so the masking can never drift per component.
 *
 *   phone   — partial: everything hidden except the last two digits
 *             ("••• ••• ••34"), enough to confirm which line an order
 *             belongs to without exposing the number;
 *   email   — fully masked with a FIXED bullet run, so not even the
 *             address length leaks;
 *   address — fully masked, same fixed run.
 */
export type PiiKind = 'phone' | 'email' | 'address';

const FULL_MASK = '••••••••';

export function maskPii(value: string, kind: PiiKind): string {
  if (kind === 'phone') {
    const digits = value.replace(/\D/g, '');
    return digits.length >= 2 ? `••• ••• ••${digits.slice(-2)}` : FULL_MASK;
  }
  return FULL_MASK;
}
