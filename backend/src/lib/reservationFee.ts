import { roundMajorUnits } from './currency';

/** The fee a guest actually pays for one booking, when one applies. */
export interface ReservationFee {
  /** Flat per reservation, in `currency`, rounded to its precision. */
  amount: number;
  /** The restaurant's currency at the moment of the booking. */
  currency: string;
}

/**
 * THE effective-fee rule — the single source of truth every surface
 * consumes (public settings response, the booking flow, the Ember AI
 * grounding, the admin board): a reservation fee applies ONLY when
 *
 *   1. the owner has switched it on, AND
 *   2. the amount is above zero, AND
 *   3. a card provider is configured — the charge has to be real.
 *
 * Rule 3 is the honesty core of the feature: with no provider
 * connected there is nothing that could take the money, so the
 * toggle alone must never make a booking (or a settings page, or the
 * AI) claim a fee — bookings simply stay free until a provider is
 * connected. Callers pass the RAW settings fields plus whether the
 * Stripe service exists; they never re-derive the rule themselves.
 *
 * The amount is rounded to the currency's own precision here so the
 * figure the guest is told, the figure snapshotted on the booking
 * and the figure converted to minor units for the charge are one
 * and the same number.
 */
export function effectiveReservationFee(
  settings: { reservationFeeEnabled: boolean; reservationFeeAmount: number; currency: string },
  cardProviderConfigured: boolean,
): ReservationFee | null {
  if (!cardProviderConfigured) return null;
  if (!settings.reservationFeeEnabled) return null;
  if (!(settings.reservationFeeAmount > 0)) return null;
  const amount = roundMajorUnits(settings.reservationFeeAmount, settings.currency);
  if (!(amount > 0)) return null;
  return { amount, currency: settings.currency };
}
