/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mega-audit Area 2, M2 — drawer feedback at the per-line cap.
// Rendered with the REAL CartProvider (the line is seeded through
// localStorage hydration, exactly as a returning customer's cart
// loads) so the stepper's disabled state and the cap note are pinned
// against the store's actual quantity, not a stubbed one. Currency,
// settings and the API are stubbed at their module seams.

vi.mock('../context/CurrencyContext.tsx', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n.toFixed(2)}`, currency: 'USD' }),
}));
vi.mock('../hooks/usePublicSettings.ts', () => ({
  usePublicSettings: () => null,
}));
const h = vi.hoisted(() => ({ apiRequest: vi.fn() }));

vi.mock('../services/api.ts', () => ({
  apiRequest: h.apiRequest,
  fetchMenuItems: vi.fn(async () => []),
  fetchPublicSettings: vi.fn(async () => null),
}));

import { CartProvider, useCart, type CartContextType } from '../context/CartContext';
import CartSidebar from './CartSidebar';

const DISH = { id: 1, name: 'Ember Classic Burger', price: 10, image: '/burger.jpg' };

function setup(quantity: number) {
  localStorage.setItem('ember_cart', JSON.stringify([{ ...DISH, quantity }]));
  render(
    <MemoryRouter>
      <CartProvider>
        <CartSidebar />
      </CartProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  // Default API state: offline (the pre-Step-9 behaviour of this
  // file's mock). Money tests below override the coupon endpoint.
  h.apiRequest.mockImplementation(async () => ({ ok: false, status: 0, data: null, error: 'offline' }));
});

afterEach(cleanup);

describe('CartSidebar — quantity cap feedback', () => {
  it('at 50: the + control is disabled and the cap note shows', () => {
    setup(50);
    expect(screen.getByText('Max 50 per dish')).toBeTruthy();
    const plus = screen.getByLabelText('Maximum of 50 per dish reached') as HTMLButtonElement;
    expect(plus.disabled).toBe(true);
    expect(plus.textContent).toBe('+');
    // The − control stays live — stepping down from the cap works.
    const minus = screen.getByText('−') as HTMLButtonElement;
    expect(minus.disabled).toBe(false);
  });

  it('at 49: no cap note and the + control is enabled', () => {
    setup(49);
    expect(screen.queryByText('Max 50 per dish')).toBeNull();
    const plus = screen.getByLabelText('Add one more Ember Classic Burger') as HTMLButtonElement;
    expect(plus.disabled).toBe(false);
  });
});

// Mega-audit Area 2, M3 — the drawer's money behaviour. The REAL
// provider + drawer are driven together (a probe captures the store
// handle): the drawer must state subtotal / discount / total that
// agree with the store's math after every mutation — coupon applied
// through the drawer's own form against the mocked validation
// endpoint, a line removed, the cart cleared.
const TRUFFLE = { id: 2, name: 'Forest Truffle Burger', price: 29, image: '/truffle.jpg' };

let cart: CartContextType;
function Probe() {
  cart = useCart();
  return null;
}

function setupMoney() {
  localStorage.setItem('ember_cart', JSON.stringify([
    { ...DISH, price: 10, quantity: 2 },
    { ...TRUFFLE, quantity: 1 },
  ]));
  render(
    <MemoryRouter>
      <CartProvider>
        <Probe />
        <CartSidebar />
      </CartProvider>
    </MemoryRouter>,
  );
}

describe('CartSidebar — money behaviour', () => {
  it('applying a percent coupon through the drawer form shows discount and total consistent with the store math', async () => {
    h.apiRequest.mockImplementation(async (path: string) => {
      if (path === '/api/v1/coupons/validate') {
        return { ok: true, status: 200, error: null, data: { valid: true, coupon: { code: 'EMBER10', type: 'percent', value: 10 } } };
      }
      return { ok: false, status: 404, data: null, error: 'Not found' };
    });
    setupMoney();
    // 2 × $10 + 1 × $29 = $49.00 — stated as both subtotal and total.
    expect(screen.getAllByText('$49.00')).toHaveLength(2);
    expect(screen.queryByText(/Discount \(/)).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Coupon code'), { target: { value: 'EMBER10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(await screen.findByText('Coupon applied — 10% off.')).toBeTruthy();
    const validate = h.apiRequest.mock.calls.find(([path]) => path === '/api/v1/coupons/validate');
    expect(validate).toBeTruthy();
    expect(JSON.parse((validate![1] as { body: string }).body)).toEqual({ code: 'EMBER10' });
    // 10% of $49.00 = $4.90 off; total $44.10; subtotal unchanged.
    expect(screen.getByText('Discount (EMBER10)')).toBeTruthy();
    expect(screen.getByText('−$4.90')).toBeTruthy();
    expect(screen.getByText('$44.10')).toBeTruthy();
    expect(screen.getAllByText('$49.00')).toHaveLength(1);
  });

  it('removing a line re-derives subtotal, discount and total from what remains', () => {
    setupMoney();
    act(() => cart.applyCoupon({ code: 'EMBER10', type: 'percent', value: 10 }));
    expect(screen.getByText('−$4.90')).toBeTruthy();
    expect(screen.getByText('$44.10')).toBeTruthy();

    act(() => cart.removeItem(2));
    // Only 2 × $10 remains: subtotal $20.00, 10% discount $2.00, total $18.00.
    expect(screen.queryByText('Forest Truffle Burger')).toBeNull();
    expect(screen.getByText('−$2.00')).toBeTruthy();
    expect(screen.getByText('$18.00')).toBeTruthy();
    expect(screen.queryByText('$44.10')).toBeNull();
  });

  it('clearing the cart empties the drawer — no lines, no coupon, no totals', () => {
    setupMoney();
    act(() => cart.applyCoupon({ code: 'EMBER10', type: 'percent', value: 10 }));
    expect(screen.getByText('Discount (EMBER10)')).toBeTruthy();

    act(() => cart.clearCart());
    expect(screen.getByText('Your cart is empty')).toBeTruthy();
    expect(screen.queryByText('Discount (EMBER10)')).toBeNull();
    expect(screen.queryByText('Total')).toBeNull();
    expect(screen.queryByText('$44.10')).toBeNull();
    expect(cart.items).toHaveLength(0);
    expect(cart.coupon).toBeNull();
  });
});
