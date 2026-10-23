/**
 * THE party-size rule — the largest party that can be booked online,
 * in one place. Every reservation-taking schema consumes this
 * (the public form in routes/forms.ts, the account change requests
 * in routes/account.ts, the admin create/edit schemas in
 * routes/admin.ts), so no surface can drift to its own cap again —
 * the desktop form once stopped at 8 and the mobile form at 7 while
 * the server happily accepted 20 (audit-2 CF-M2).
 *
 * The frontend carries a mirror of this constant
 * (src/lib/partySize.ts) because the two builds cannot import one
 * physical module (the backend compiles with rootDir src/; the Vite
 * app includes only its own src/). Each side's test suite pins its
 * copy to exactly this value, so the two can never silently diverge.
 */
export const MAX_PARTY_SIZE = 20;

/** The rejection wording for a party above the online cap. */
export const OVER_PARTY_SIZE_MESSAGE = `For parties over ${MAX_PARTY_SIZE}, please contact us directly`;
