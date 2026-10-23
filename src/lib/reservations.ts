/**
 * Whether a reservation holds seats in a time slot — the capacity
 * rule the admin day board aggregates by, mirroring the backend's
 * ACTIVE set (lib/chat.ts summarizeReservationDay): the booking's
 * status must be active (pending/confirmed), and a fee-bearing
 * booking counts ONLY once its fee is paid. An unpaid fee booking
 * (pending/failed) never consumes capacity — the guest has not
 * secured the table yet.
 */
export interface SeatHoldingInput {
  status: string;
  feeAmount?: number | null;
  feePaymentStatus?: string | null;
}

export function reservationHoldsSeats(r: SeatHoldingInput): boolean {
  if (r.status !== 'pending' && r.status !== 'confirmed') return false;
  if (r.feeAmount == null) return true;
  return r.feePaymentStatus === 'paid';
}
