/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Mega-audit Area 2, M2 — the per-line quantity cap. The server
// schema (backend orders route) caps a line at 50; the cart store
// must clamp EVERY mutation to the same cap so a cart can never
// reach checkout in a state the server rejects: add increments,
// updateQuantity, the stored-cart merge, and hydration itself.
// Removal at ≤ 0 is unchanged.

import { CartProvider, MAX_LINE_QUANTITY, useCart, type CartContextType } from './CartContext';

const DISH = { id: 1, name: 'Ember Classic Burger', price: 28.5, image: '/burger.jpg' };
const DISH2 = { id: 2, name: 'Forest Truffle Burger', price: 29, image: '/truffle.jpg' };

let cart: CartContextType;
function Probe() {
  cart = useCart();
  return (
    <div data-testid="lines">
      {cart.items.map((i) => `${i.id}:${i.quantity}`).join(',')}
    </div>
  );
}

function setup(seed?: unknown) {
  if (seed !== undefined) localStorage.setItem('ember_cart', JSON.stringify(seed));
  render(
    <CartProvider>
      <Probe />
    </CartProvider>,
  );
}

function lines() {
  return screen.getByTestId('lines').textContent;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(cleanup);

describe('MAX_LINE_QUANTITY', () => {
  it('is 50, mirroring the server order schema cap', () => {
    expect(MAX_LINE_QUANTITY).toBe(50);
  });
});

describe('addItem clamping', () => {
  it('stops at 50 no matter how many times the dish is added', () => {
    setup();
    act(() => {
      for (let n = 0; n < 60; n += 1) cart.addItem(DISH);
    });
    expect(lines()).toBe('1:50');
    expect(cart.totalCount).toBe(50);
  });

  it('still adds distinct dishes normally below the cap', () => {
    setup();
    act(() => {
      cart.addItem(DISH);
      cart.addItem(DISH);
      cart.addItem(DISH2);
    });
    expect(lines()).toBe('1:2,2:1');
  });
});

describe('updateQuantity clamping', () => {
  it('clamps a value above the cap to 50', () => {
    setup();
    act(() => cart.addItem(DISH));
    act(() => cart.updateQuantity(1, 51));
    expect(lines()).toBe('1:50');
    act(() => cart.updateQuantity(1, 999));
    expect(lines()).toBe('1:50');
  });

  it('sets values at and below the cap exactly', () => {
    setup();
    act(() => cart.addItem(DISH));
    act(() => cart.updateQuantity(1, 50));
    expect(lines()).toBe('1:50');
    act(() => cart.updateQuantity(1, 49));
    expect(lines()).toBe('1:49');
    act(() => cart.updateQuantity(1, 1));
    expect(lines()).toBe('1:1');
  });

  it('still removes the line at 0 (and below)', () => {
    setup();
    act(() => {
      cart.addItem(DISH);
      cart.addItem(DISH2);
    });
    act(() => cart.updateQuantity(1, 0));
    expect(lines()).toBe('2:1');
    act(() => cart.updateQuantity(2, -3));
    expect(lines()).toBe('');
    expect(cart.items).toHaveLength(0);
  });
});

describe('hydration from storage', () => {
  it('loads a stored line of 999 at the cap — clamped, not dropped', () => {
    setup([{ ...DISH, quantity: 999 }]);
    expect(lines()).toBe('1:50');
    expect(cart.items[0].name).toBe(DISH.name);
  });

  it('loads a stored line at exactly 50 unchanged, and below it unchanged', () => {
    setup([{ ...DISH, quantity: 50 }, { ...DISH2, quantity: 7 }]);
    expect(lines()).toBe('1:50,2:7');
  });

  it('keeps the existing rejection of invalid quantities', () => {
    setup([
      { ...DISH, quantity: 0 },
      { ...DISH2, quantity: 1.5 },
    ]);
    expect(lines()).toBe('');
  });

  it('keeps rejecting a negative stored quantity', () => {
    setup([{ ...DISH, quantity: -2 }]);
    expect(lines()).toBe('');
  });
});

describe('stored-cart merge path', () => {
  it('clamps the summed quantity of duplicate stored lines', () => {
    setup([
      { ...DISH, quantity: 30 },
      { ...DISH, quantity: 30 },
    ]);
    expect(lines()).toBe('1:50');
  });

  it('sums duplicate stored lines below the cap exactly', () => {
    setup([
      { ...DISH, quantity: 20 },
      { ...DISH, quantity: 15 },
    ]);
    expect(lines()).toBe('1:35');
  });
});
