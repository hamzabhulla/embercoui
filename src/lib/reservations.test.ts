import { describe, expect, it } from 'vitest';
import { reservationHoldsSeats } from './reservations';

describe('reservationHoldsSeats — the day-board capacity rule', () => {
  it('active bookings without a fee hold seats', () => {
    expect(reservationHoldsSeats({ status: 'pending', feeAmount: null, feePaymentStatus: 'none' })).toBe(true);
    expect(reservationHoldsSeats({ status: 'confirmed', feeAmount: null, feePaymentStatus: 'none' })).toBe(true);
    // Pre-fee rows (fields absent) behave exactly as before.
    expect(reservationHoldsSeats({ status: 'confirmed' })).toBe(true);
  });

  it('a fee booking holds seats only once its fee is paid', () => {
    expect(reservationHoldsSeats({ status: 'pending', feeAmount: 5, feePaymentStatus: 'pending' })).toBe(false);
    expect(reservationHoldsSeats({ status: 'confirmed', feeAmount: 5, feePaymentStatus: 'failed' })).toBe(false);
    expect(reservationHoldsSeats({ status: 'confirmed', feeAmount: 5, feePaymentStatus: 'paid' })).toBe(true);
  });

  it('cancelled / completed bookings never hold seats, fee or not', () => {
    expect(reservationHoldsSeats({ status: 'cancelled', feeAmount: null, feePaymentStatus: 'none' })).toBe(false);
    expect(reservationHoldsSeats({ status: 'completed', feeAmount: 5, feePaymentStatus: 'paid' })).toBe(false);
  });
});
