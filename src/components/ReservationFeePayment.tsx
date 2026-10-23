import { useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import type { Appearance } from '@stripe/stripe-js';
import type { ReservationFeePayment } from '../services/api.ts';
import { formatMoney } from '../lib/currency.ts';
import { stripePromise } from '../lib/stripe.ts';

/**
 * The Stripe Elements appearance for the booking-fee card step —
 * ONE object for every surface that renders it (the Reservations
 * section and the Ember AI chat panel both present the step on the
 * site's dark green, so the night theme fits both identically).
 */
export const RESERVATION_FEE_APPEARANCE: Appearance = {
  theme: 'night',
  variables: { colorPrimary: '#C17A3A', colorBackground: '#1C2B1E', colorText: '#F5F0E8', fontFamily: 'Jost, sans-serif' },
};

/**
 * The booking-fee card step (Phase F), modelled on Checkout's card
 * form: the server has already created the booking and its payment
 * intent; confirming here is what pays the fee. A declined card is an
 * honest error and the step stays open for another try — the booking
 * holds no table until the fee is paid, which the copy says plainly.
 *
 * This is THE fee form for every surface (the Reservations section,
 * the Ember AI chat panel): one confirm implementation, one error
 * copy, one success semantics. `variant` is presentation only — the
 * compact chat panel drops the page section's padding/width shaping
 * and steps the heading down; the logic never branches on it.
 */
export function FeePaymentForm({ fee, onPaid, variant = 'page' }: { fee: ReservationFeePayment; onPaid: () => void; variant?: 'page' | 'compact' }) {
  const stripe = useStripe();
  const elements = useElements();
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;
    setPaying(true);
    setError(null);
    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({ elements, redirect: 'if_required' });
    setPaying(false);
    if (confirmError) {
      setError(confirmError.message ?? 'Your card was declined — the booking fee was not paid, so your table is not held yet. You can try another card.');
      return;
    }
    if (paymentIntent && (paymentIntent.status === 'succeeded' || paymentIntent.status === 'processing')) {
      onPaid();
      return;
    }
    // No error from Stripe, but the payment did not complete either
    // (a further step was requested, the attempt was cancelled, …):
    // never leave the guest staring at a silent form — the fee is
    // unpaid and the table is not held, and the step stays open for
    // another try.
    setError('That payment was not completed, so the booking fee was not paid and your table is not held yet. You can try again or use another card.');
  };

  const compact = variant === 'compact';

  return (
    <form onSubmit={pay} className={compact ? 'w-full flex flex-col gap-4' : 'w-full max-w-md mx-auto lg:mx-0 flex flex-col gap-5 px-[24px] py-[32px] md:p-0'}>
      <div>
        <h3 className={compact ? 'text-2xl mb-2' : 'text-3xl mb-3'} style={{ fontFamily: 'Cormorant Garamond, serif', color: '#F5F0E8' }}>
          Booking Fee
        </h3>
        <p className="text-sm" style={{ color: 'rgba(245,240,232,0.6)', fontFamily: 'Jost, sans-serif' }}>
          A booking fee of {formatMoney(fee.amount, fee.currency)} is charged by card now.
          Your table is held once the fee is paid.
        </p>
      </div>
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && <p className="text-[#ef4444]" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px' }}>{error}</p>}
      <button
        type="submit"
        disabled={!stripe || paying}
        className="w-full bg-[#C17A3A] hover:bg-[#A66932] text-white py-4 px-6 flex items-center justify-between transition-all duration-[250ms] uppercase disabled:opacity-50"
        style={{ fontFamily: 'Jost, sans-serif', fontSize: '11px', letterSpacing: '0.2em' }}
      >
        <span>{paying ? 'Processing…' : `Pay ${formatMoney(fee.amount, fee.currency)}`}</span>
        <ArrowRight className="w-4 h-4" />
      </button>
      <p style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px', color: 'rgba(245,240,232,0.3)' }}>
        Payments are processed by Stripe.
      </p>
    </form>
  );
}

/**
 * The whole card step — Elements wrapper + the shared form — so the
 * client secret enters Elements options in exactly one place, with
 * the one appearance, on every surface. Card data only ever lives
 * inside Stripe's iframes (the PaymentElement above); the secret is
 * never rendered, logged or stored.
 */
export function ReservationFeePaymentPanel({ fee, onPaid, variant }: { fee: ReservationFeePayment; onPaid: () => void; variant?: 'page' | 'compact' }) {
  return (
    <Elements stripe={stripePromise} options={{ clientSecret: fee.clientSecret, appearance: RESERVATION_FEE_APPEARANCE }}>
      <FeePaymentForm fee={fee} onPaid={onPaid} variant={variant} />
    </Elements>
  );
}
