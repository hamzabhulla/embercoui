/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mega-audit Area 2, M3 — Checkout, behaviourally. The REAL page is
// driven with the REAL CartProvider (cart seeded through localStorage
// hydration, exactly as a returning customer's cart loads); the API,
// Stripe.js/Elements, currency and auth are stubbed at the same module
// seams the neighbouring suites use. A sentinel route stands in for
// the tracking page so "the customer lands on /track-order/<id>" is
// asserted as navigation, not inferred.
//
// What is pinned:
//  (a) COD placement — the POST /api/v1/orders payload carries ONLY
//      ids + quantities (clamped to the per-line cap by hydration),
//      the fulfilment details and the coupon code — never a price or
//      a total the client invented; success navigates to the placed
//      order's tracking page.
//  (b) Totals — subtotal / coupon discount (applied through the
//      page's own coupon path against a mocked validation response) /
//      delivery / total all match the cart math.
//  (c) Card path with a provider configured — intent creation is
//      requested for the placed order, the Payment Element mounts,
//      and a succeeded confirm lands on the tracking page.
//  (d) Intent failure — the honest cardUnavailable state: the order
//      exists but is NOT paid, with the cash fallback copy; no
//      payment form, no paid claim.
//  (e) Empty cart — the page's guard state, no checkout form.
//  (f) A server rejection at placement surfaces the server's error
//      and shows no success UI; the cart is left intact.

const h = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  confirmPayment: vi.fn(),
}));

vi.mock('../context/CurrencyContext.tsx', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n.toFixed(2)}`, currency: 'USD' }),
}));
vi.mock('../context/AuthContext.tsx', () => {
  const auth = { profile: null };
  return { useAuth: () => auth };
});
vi.mock('../services/api.ts', () => ({
  apiRequest: h.apiRequest,
  fetchMenuItems: vi.fn(async () => []),
  fetchPublicSettings: vi.fn(async () => null),
}));
vi.mock('../lib/stripe.ts', () => ({
  stripePromise: Promise.resolve({}),
  isStripeConfigured: true,
}));
vi.mock('@stripe/react-stripe-js', async () => {
  const React = await import('react');
  return {
    Elements: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
    PaymentElement: () => React.createElement('div', { 'data-testid': 'payment-element' }),
    useStripe: () => ({ confirmPayment: h.confirmPayment }),
    useElements: () => ({}),
  };
});

import { CartProvider } from '../context/CartContext';
import Checkout from './Checkout';

const BURGER = { id: 1, name: 'Ember Classic Burger', price: 10, image: '/burger.jpg' };
const TRUFFLE = { id: 2, name: 'Forest Truffle Burger', price: 29, image: '/truffle.jpg' };

function TrackSentinel() {
  const { id } = useParams();
  return <div>TRACKING ORDER {id}</div>;
}

function setup(seed?: unknown[]) {
  if (seed) localStorage.setItem('ember_cart', JSON.stringify(seed));
  return render(
    <MemoryRouter initialEntries={['/checkout']}>
      <CartProvider>
        <Routes>
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/track-order/:id" element={<TrackSentinel />} />
        </Routes>
      </CartProvider>
    </MemoryRouter>,
  );
}

/** The page's labels are unassociated (the existing form pattern), so
 *  fields are reached in DOM order: name, email, phone, address line,
 *  city, postal code, notes, then the summary's coupon input. */
function fillDetails(container: HTMLElement) {
  const inputs = container.querySelectorAll('input');
  const set = (el: Element, value: string) => fireEvent.change(el, { target: { value } });
  set(inputs[0], 'Test Guest');
  set(inputs[1], 'guest@example.com');
  set(inputs[3], '1 Ember Lane');
  set(inputs[4], 'Lahore');
}

function orderCall() {
  return h.apiRequest.mock.calls.find(([path]) => path === '/api/v1/orders');
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

afterEach(cleanup);

describe('Checkout — COD placement', () => {
  it('posts ids + quantities only (cap-clamped), the fulfilment details and no client prices, then navigates to the placed order', async () => {
    h.apiRequest.mockImplementation(async (path: string) => {
      if (path === '/api/v1/orders') {
        return {
          ok: true, status: 201, error: null,
          data: { order: { id: 'ord-cod-00000001', subtotal: 500, deliveryFee: 0, discount: 0, total: 500, currency: 'USD' } },
        };
      }
      return { ok: false, status: 404, data: null, error: 'Not found' };
    });
    // 999 in storage hydrates at the store's per-line cap of 50.
    const { container } = setup([{ ...BURGER, quantity: 999 }]);
    fillDetails(container);
    fireEvent.click(screen.getByRole('button', { name: /Cash on delivery/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Place Order' }));

    expect(await screen.findByText('TRACKING ORDER ord-cod-00000001')).toBeTruthy();
    const call = orderCall();
    expect(call).toBeTruthy();
    const body = JSON.parse((call![1] as { body: string }).body) as Record<string, unknown>;
    expect(body.items).toEqual([{ menuItemId: 1, quantity: 50 }]);
    expect(Object.keys((body.items as unknown[])[0] as object).sort()).toEqual(['menuItemId', 'quantity']);
    expect(body.customerName).toBe('Test Guest');
    expect(body.customerEmail).toBe('guest@example.com');
    expect(body.customerPhone).toBeNull();
    expect(body.address).toEqual({ line1: '1 Ember Lane', city: 'Lahore' });
    expect(body.notes).toBeNull();
    expect(body.couponCode).toBeNull();
    expect(typeof body.idempotencyKey).toBe('string');
    expect((body.idempotencyKey as string).length).toBeGreaterThan(0);
    // The complete key set — no price, subtotal or total is ever sent.
    expect(Object.keys(body).sort()).toEqual([
      'address', 'couponCode', 'customerEmail', 'customerName', 'customerPhone', 'idempotencyKey', 'items', 'notes',
    ]);
  });

  it('a server rejection surfaces its error verbatim — no success UI, cart intact', async () => {
    h.apiRequest.mockImplementation(async (path: string) => {
      if (path === '/api/v1/orders') {
        return { ok: false, status: 409, data: null, error: 'A dish in your cart is no longer available.' };
      }
      return { ok: false, status: 404, data: null, error: 'Not found' };
    });
    const { container } = setup([{ ...BURGER, quantity: 1 }]);
    fillDetails(container);
    fireEvent.click(screen.getByRole('button', { name: 'Place Order & Pay' }));

    expect(await screen.findByText('A dish in your cart is no longer available.')).toBeTruthy();
    expect(screen.queryByText(/TRACKING ORDER/)).toBeNull();
    expect(screen.getByText('Complete Your Order')).toBeTruthy();
    // The cart was not cleared behind the customer's back.
    expect(screen.getByText('1 × Ember Classic Burger')).toBeTruthy();
  });
});

describe('Checkout — totals and coupon', () => {
  it('renders subtotal/delivery/total from the cart, then the percent discount once the coupon validates', async () => {
    h.apiRequest.mockImplementation(async (path: string) => {
      if (path === '/api/v1/coupons/validate') {
        return { ok: true, status: 200, error: null, data: { valid: true, coupon: { code: 'EMBER10', type: 'percent', value: 10 } } };
      }
      return { ok: false, status: 404, data: null, error: 'Not found' };
    });
    setup([{ ...BURGER, quantity: 2 }, { ...TRUFFLE, quantity: 1 }]);

    // 2 × $10 + 1 × $29 = $49.00; delivery is free; total matches.
    expect(screen.getAllByText('$49.00')).toHaveLength(2); // subtotal + total
    expect(screen.getByText('Delivery')).toBeTruthy();
    expect(screen.getByText('Free')).toBeTruthy();
    expect(screen.queryByText('Discount')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Coupon code'), { target: { value: 'EMBER10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByText('Coupon applied — 10% off.')).toBeTruthy();
    const validate = h.apiRequest.mock.calls.find(([path]) => path === '/api/v1/coupons/validate');
    expect(validate).toBeTruthy();
    expect(JSON.parse((validate![1] as { body: string }).body)).toEqual({ code: 'EMBER10' });
    // 10% of $49.00 = $4.90 off; the total drops to $44.10 and the
    // subtotal line is untouched.
    expect(screen.getByText('−$4.90')).toBeTruthy();
    expect(screen.getByText('$44.10')).toBeTruthy();
    expect(screen.getAllByText('$49.00')).toHaveLength(1);
  });
});

describe('Checkout — card path (provider configured)', () => {
  function mockCardApi(intentOk: boolean) {
    h.apiRequest.mockImplementation(async (path: string) => {
      if (path === '/api/v1/orders') {
        return {
          ok: true, status: 201, error: null,
          data: { order: { id: 'ord-card-00000001', subtotal: 20, deliveryFee: 0, discount: 0, total: 20, currency: 'USD' } },
        };
      }
      if (path === '/api/v1/payments/create-intent') {
        return intentOk
          ? { ok: true, status: 200, error: null, data: { clientSecret: 'pi_test_secret' } }
          : { ok: false, status: 503, data: null, error: 'Card payments are not configured on this deployment.' };
      }
      return { ok: false, status: 404, data: null, error: 'Not found' };
    });
  }

  it('requests an intent for the placed order, mounts the Payment Element, and a succeeded confirm lands on tracking', async () => {
    mockCardApi(true);
    h.confirmPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
    const { container } = setup([{ ...BURGER, quantity: 2 }]);
    fillDetails(container);
    // Card is the default method when a provider is configured.
    fireEvent.click(screen.getByRole('button', { name: 'Place Order & Pay' }));

    expect(await screen.findByTestId('payment-element')).toBeTruthy();
    // The confirmation line interleaves spans (#id, total) — assert
    // on the paragraph's full text.
    expect(document.body.textContent).toContain('Order #ord-card created — total $20.00. Complete your payment below.');
    const intent = h.apiRequest.mock.calls.find(([path]) => path === '/api/v1/payments/create-intent');
    expect(intent).toBeTruthy();
    expect(JSON.parse((intent![1] as { body: string }).body)).toEqual({ orderId: 'ord-card-00000001' });

    fireEvent.click(screen.getByRole('button', { name: 'Pay Now' }));
    expect(await screen.findByText('TRACKING ORDER ord-card-00000001')).toBeTruthy();
    expect(h.confirmPayment).toHaveBeenCalledTimes(1);
  });

  it('intent failure lands on the honest not-paid state — order placed, cash fallback, never a payment form', async () => {
    mockCardApi(false);
    const { container } = setup([{ ...BURGER, quantity: 2 }]);
    fillDetails(container);
    fireEvent.click(screen.getByRole('button', { name: 'Place Order & Pay' }));

    expect(await screen.findByText('Card payments are not available yet')).toBeTruthy();
    expect(document.body.textContent).toContain('has been placed but is');
    expect(document.body.textContent).toContain('not paid');
    expect(document.body.textContent).toContain('pay cash on delivery instead');
    expect(document.body.textContent).toContain('#ord-card');
    expect(screen.queryByTestId('payment-element')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pay Now' })).toBeNull();
    expect(screen.queryByText(/TRACKING ORDER/)).toBeNull();
  });
});

describe('Checkout — empty cart guard', () => {
  it('shows the empty state and no checkout form', () => {
    setup();
    expect(screen.getByText('Your cart is empty')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Browse the Menu' })).toBeTruthy();
    expect(screen.queryByText('Complete Your Order')).toBeNull();
    expect(h.apiRequest).not.toHaveBeenCalled();
  });
});
