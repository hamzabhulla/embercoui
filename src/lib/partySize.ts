/**
 * Frontend mirror of the backend party-size rule
 * (backend/src/lib/partySize.ts): the largest party that can be
 * booked online. The reservation form's desktop and mobile guest
 * selectors and the account change-request form all consume this
 * one value — they once disagreed (desktop 8, mobile 7) while the
 * server accepted 20, so parties the kitchen would happily seat
 * could not book at all (audit-2 CF-M2).
 *
 * The two builds cannot import one physical module (the backend
 * compiles with rootDir src/; this app includes only its own src/),
 * so each side keeps a copy and each side's tests pin it to 20.
 */
export const MAX_PARTY_SIZE = 20;

/** Guest counts offered by the booking selectors: 1..MAX_PARTY_SIZE. */
export const GUEST_COUNT_OPTIONS: number[] = Array.from(
  { length: MAX_PARTY_SIZE },
  (_, i) => i + 1,
);
