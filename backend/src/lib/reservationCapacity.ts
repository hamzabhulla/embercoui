import { ApiError } from './errors';
import type { ReservationDTO } from '../repositories/types';

/**
 * Reservation slot capacity — the server-side enforcement of the rule
 * the admin day board has always DISPLAYED (Mega Audit #2, BE-M1:
 * the board computed capacity for show while every creation path
 * inserted unconditionally, so a 40-guest slot happily held 60).
 *
 * THE counting predicate — mirrored exactly, never re-derived:
 * a reservation holds seats in its slot iff
 *   1. its status is ACTIVE — 'pending' or 'confirmed'
 *      (cancelled and completed bookings hold nothing), AND
 *   2. it carries no fee, OR its fee has been PAID
 *      (a booking whose fee is still 'pending'/'failed' has not
 *      secured its table and consumes no capacity).
 * The board defines it in src/lib/reservations.ts
 * (`reservationHoldsSeats`, consumed by the day-board aggregation in
 * src/pages/admin/AdminReservations.tsx); the backend's other mirror
 * is lib/chat.ts `summarizeReservationDay`, which now consumes THIS
 * predicate so the prompt grounding and the enforcement can never
 * drift apart.
 */
export function reservationHoldsSeats(
  r: Pick<ReservationDTO, 'status' | 'feeAmount' | 'feePaymentStatus'>,
): boolean {
  if (r.status !== 'pending' && r.status !== 'confirmed') return false;
  if (r.feeAmount == null) return true;
  return r.feePaymentStatus === 'paid';
}

/**
 * Guests already holding seats in one slot of one day. Slots group by
 * HH:MM — Postgres times can arrive as HH:MM:SS and the board groups
 * the same way (AdminReservations.tsx `slotTime`), so both sides are
 * sliced before comparing.
 */
export function heldGuestsForSlot(
  reservations: readonly Pick<ReservationDTO, 'date' | 'time' | 'guests' | 'status' | 'feeAmount' | 'feePaymentStatus'>[],
  date: string,
  time: string,
): number {
  const slot = time.slice(0, 5);
  let held = 0;
  for (const r of reservations) {
    if (r.date !== date) continue;
    if (r.time.slice(0, 5) !== slot) continue;
    if (!reservationHoldsSeats(r)) continue;
    held += r.guests;
  }
  return held;
}

/**
 * The slot-full rejection's machine-readable code (ApiError's `code`
 * channel — the error response carries it next to `error`). The
 * public form route surfaces the ApiError itself (409 + message);
 * the chat route must tell a FULL slot apart from a generic creation
 * failure so the concierge can say "fully booked" instead of "our
 * side failed" — this code is that distinction.
 */
export const RESERVATION_SLOT_FULL_CODE = 'RESERVATION_SLOT_FULL';

export function reservationSlotFullError(): ApiError {
  return new ApiError(
    409,
    'That time is fully booked — please choose a different time',
    RESERVATION_SLOT_FULL_CODE,
  );
}

export function isReservationSlotFull(err: unknown): boolean {
  return err instanceof ApiError && err.code === RESERVATION_SLOT_FULL_CODE;
}
