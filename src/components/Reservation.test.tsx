/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Phase F fee card step — the confirm OUTCOME matrix (final deep
// audit L5). Stripe is stubbed at its module seams (the
// react-stripe-js hooks and the publishable-key module), the booking
// API at its service seam, so the REAL Reservation section is driven
// booking → fee step → Pay, with the confirm result as the variable:
//   succeeded / processing → the booking completes (unchanged);
//   anything else with NO Stripe error (requires_action, canceled,
//   …) → an honest inline message, never a silent form — the fee is
//   unpaid and the table is not held, and the step stays open.

const h = vi.hoisted(() => ({
  confirmPayment: vi.fn(),
  submitReservation: vi.fn(),
}));

vi.mock('@stripe/react-stripe-js', async () => {
  const React = await import('react');
  return {
    Elements: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    PaymentElement: () => null,
    useStripe: () => ({ confirmPayment: h.confirmPayment }),
    useElements: () => ({}),
  };
});

vi.mock('../lib/stripe.ts', () => ({
  stripePromise: Promise.resolve(null),
  isStripeConfigured: true,
}));

vi.mock('../services/api.ts', () => ({
  submitReservation: h.submitReservation,
}));

vi.mock('../hooks/useInView', () => ({
  useInView: () => ({ ref: { current: null }, isInView: true }),
}));

vi.mock('../hooks/usePublicSettings', () => ({
  usePublicSettings: () => ({
    name: 'Ember & Co.', tagline: null, email: null, phone: null, address: null,
    currency: 'USD', reservationFee: { amount: 5, currency: 'USD' }, siteLocations: null,
  }),
  openingHoursLines: () => [],
}));

import Reservation from './Reservation';

const FEE_PAYMENT = { clientSecret: 'pi_1_secret_test', paymentIntentId: 'pi_1', amount: 5, currency: 'USD' };

async function bookToFeeStep() {
  render(<Reservation />);
  const set = (id: string, value: string) => {
    const el = document.getElementById(id);
    if (!el) throw new Error(`missing field #${id}`);
    fireEvent.change(el, { target: { value } });
  };
  set('name', 'Fee Guest');
  set('email', 'fee@example.com');
  set('phone', '1234567');
  set('date', '2027-01-15');
  set('time', '19:00');
  set('guests', '4');
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
  expect(await screen.findByText('Booking Fee')).toBeTruthy();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.submitReservation.mockResolvedValue({
    ok: true, status: 201, error: null,
    data: { reservation: { id: 'res-fee-1' }, feePayment: FEE_PAYMENT },
  });
});

afterEach(cleanup);

describe('Reservation party-size options (CF-M2)', () => {
  it('the desktop guests select offers exactly 1..20', () => {
    render(<Reservation />);
    const select = document.getElementById('guests') as HTMLSelectElement;
    expect(select).toBeTruthy();
    const values = Array.from(select.options).map((o) => o.value).filter((v) => v !== '');
    expect(values).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 1)));
    expect(values).toHaveLength(20);
    expect(values[values.length - 1]).toBe('20');
  });

  it('the mobile guests selector offers exactly 1..20', () => {
    render(<Reservation />);
    // The mobile party-size buttons are the only buttons whose whole
    // label is a bare number (time slots read "12:00", actions words).
    const labels = screen.getAllByRole('button')
      .map((b) => (b.textContent ?? '').trim())
      .filter((t) => /^\d+$/.test(t));
    expect(labels).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 1)));
    expect(labels[labels.length - 1]).toBe('20');
  });
});

describe('Reservation fee step — confirm outcomes', () => {
  it('a non-completed confirm with no Stripe error (requires_action) says so honestly — never silence', async () => {
    h.confirmPayment.mockResolvedValue({ paymentIntent: { status: 'requires_action' } });
    await bookToFeeStep();
    fireEvent.click(screen.getByRole('button', { name: /Pay/ }));
    expect(await screen.findByText(/That payment was not completed/)).toBeTruthy();
    expect(screen.getByText(/your table is not held yet/)).toBeTruthy();
    // The step stays open for another try; no success is claimed.
    expect(screen.getByText('Booking Fee')).toBeTruthy();
    expect(screen.queryByText('Reservation Received')).toBeNull();
  });

  it('a canceled confirm lands on the same honest message', async () => {
    h.confirmPayment.mockResolvedValue({ paymentIntent: { status: 'canceled' } });
    await bookToFeeStep();
    fireEvent.click(screen.getByRole('button', { name: /Pay/ }));
    expect(await screen.findByText(/That payment was not completed/)).toBeTruthy();
    expect(screen.queryByText('Reservation Received')).toBeNull();
  });

  it('succeeded still completes the booking exactly as before', async () => {
    h.confirmPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
    await bookToFeeStep();
    fireEvent.click(screen.getByRole('button', { name: /Pay/ }));
    expect(await screen.findByText('Reservation Received')).toBeTruthy();
    expect(screen.queryByText(/That payment was not completed/)).toBeNull();
  });

  it('processing still completes the booking exactly as before', async () => {
    h.confirmPayment.mockResolvedValue({ paymentIntent: { status: 'processing' } });
    await bookToFeeStep();
    fireEvent.click(screen.getByRole('button', { name: /Pay/ }));
    expect(await screen.findByText('Reservation Received')).toBeTruthy();
  });

  it('a Stripe error keeps the declined-card message (unchanged)', async () => {
    h.confirmPayment.mockResolvedValue({ error: { message: 'Your card was declined.' } });
    await bookToFeeStep();
    fireEvent.click(screen.getByRole('button', { name: /Pay/ }));
    expect(await screen.findByText('Your card was declined.')).toBeTruthy();
    expect(screen.queryByText(/That payment was not completed/)).toBeNull();
    expect(screen.queryByText('Reservation Received')).toBeNull();
  });
});

describe('Mobile form step panels — no fixed-height clip, no sticky overlap', () => {
  // Regression: Step 1's Continue bar was `sticky bottom-0` inside a
  // 520px overflow-hidden wrapper, so on a phone it painted over
  // guest rows 16–20. The active panel must be in flow (relative)
  // so the wrapper grows to its full height, the inactive panel
  // absolute (out of flow, sliding), and neither button bar sticky.
  const panelOf = (el: HTMLElement) => {
    // Continue is a direct child of the Step 1 panel; Back/Confirm
    // sit in a row div inside the Step 2 panel.
    let node: HTMLElement | null = el;
    while (node && !String(node.className).includes('space-y-[28px]')) node = node.parentElement;
    if (!node) throw new Error('step panel not found');
    return node;
  };

  it('Step 1 active: its panel is relative, Step 2 parked absolute, Continue not sticky', () => {
    render(<Reservation />);
    const continueBtn = screen.getByRole('button', { name: /Continue/ });
    const step1 = panelOf(continueBtn);
    expect(step1.classList.contains('relative')).toBe(true);
    expect(step1.classList.contains('absolute')).toBe(false);
    expect(continueBtn.classList.contains('sticky')).toBe(false);
    const confirmBtn = screen.getByRole('button', { name: /Confirm/ });
    const step2 = panelOf(confirmBtn);
    expect(step2.classList.contains('absolute')).toBe(true);
    expect(step2.classList.contains('pointer-events-none')).toBe(true);
    // The Step 2 button row itself must not be sticky either.
    expect(confirmBtn.parentElement?.classList.contains('sticky')).toBe(false);
  });

  it('after advancing, Step 2 is relative and Step 1 parked absolute', () => {
    render(<Reservation />);
    const set = (id: string, value: string) => {
      const el = document.getElementById(id);
      if (!el) throw new Error(`missing field #${id}`);
      fireEvent.change(el, { target: { value } });
    };
    set('name-mobile', 'Clip Guest');
    set('email-mobile', 'clip@example.com');
    set('phone-mobile', '1234567');
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }));
    const confirmBtn = screen.getByRole('button', { name: /Confirm/ });
    const step2 = panelOf(confirmBtn);
    expect(step2.classList.contains('relative')).toBe(true);
    expect(step2.classList.contains('absolute')).toBe(false);
    const continueBtn = screen.getByRole('button', { name: /Continue/ });
    const step1 = panelOf(continueBtn);
    expect(step1.classList.contains('absolute')).toBe(true);
    expect(step1.classList.contains('pointer-events-none')).toBe(true);
  });
});
