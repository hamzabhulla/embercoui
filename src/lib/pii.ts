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
 *   address — fully masked, same fixed run;
 *   name    — partial: the first name stays (the board exists so
 *             staff can match an order to the person at the counter)
 *             and the surname is reduced to its initial
 *             ("Ayesha Khan" → "Ayesha K."), so the full name never
 *             appears on a locked screen.
 */
export type PiiKind = 'phone' | 'email' | 'address' | 'name';

const FULL_MASK = '••••••••';

export function maskPii(value: string, kind: PiiKind): string {
  if (kind === 'phone') {
    const digits = value.replace(/\D/g, '');
    return digits.length >= 2 ? `••• ••• ••${digits.slice(-2)}` : FULL_MASK;
  }
  if (kind === 'name') {
    const tokens = value.trim().split(/\s+/).filter(Boolean);
    // Nothing usable to show (empty / whitespace-only): the same
    // fixed mask the other kinds fall back to.
    if (tokens.length === 0) return FULL_MASK;
    // A single-token name carries no surname to protect; the rule
    // degenerates to the first name alone, which is exactly what
    // the counter needs to match the order.
    if (tokens.length === 1) return tokens[0];
    // First token in full + the LAST token's initial (uppercased,
    // with a period). Hyphens never split a token, so a hyphenated
    // surname contributes the initial of its first part
    // ("Ayesha Khan-Patel" → "Ayesha K.").
    return `${tokens[0]} ${tokens[tokens.length - 1].charAt(0).toUpperCase()}.`;
  }
  return FULL_MASK;
}
