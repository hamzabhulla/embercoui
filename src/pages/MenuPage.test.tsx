/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mega-audit Area 2, M3 — the Menu page, behaviourally. The REAL
// page runs on the REAL useMenuItems hook and REAL CartProvider; the
// menu is stubbed at the services/api seam (fetchMenuItems), auth at
// its context seam (a guest, so cards render without favourite
// hearts), currency at its context seam. IntersectionObserver is
// stubbed as harness plumbing — jsdom has none; it drives only the
// cards' scroll-reveal CSS class, never content.
//
// What is pinned: items render as the API returns them; categories
// are derived from the items and selecting one filters; the dietary
// filter matches through the Step 5 normaliser end-to-end (a tag
// stored as 'Gluten-Free' satisfies the 'Gluten Free' filter);
// search narrows by name; a zero-match filter shows the page's real
// empty state.
//
// NOTE on availability: there is deliberately no "isAvailable=false
// item does not render" case at this seam. Availability is enforced
// by the API itself — the backend's public menu query filters
// is_available = true and the frontend MenuItem type carries no
// availability field — so fetchMenuItems can never hand this page an
// unavailable dish. The exclusion is pinned where it lives, in the
// backend repository tests.

const h = vi.hoisted(() => ({
  fetchMenuItems: vi.fn(),
}));

vi.mock('../services/api.ts', () => ({
  apiRequest: vi.fn(async () => ({ ok: false, status: 0, data: null, error: 'offline' })),
  fetchMenuItems: h.fetchMenuItems,
  fetchPublicSettings: vi.fn(async () => null),
}));
vi.mock('../context/CurrencyContext.tsx', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n.toFixed(2)}`, currency: 'USD' }),
}));
vi.mock('../context/AuthContext.tsx', () => {
  const auth = { user: null, profile: null, refreshProfile: vi.fn(async () => {}) };
  return { useAuth: () => auth };
});

class IntersectionObserverStub {
  observe() { /* harness stub — reveal animation only */ }
  unobserve() { /* harness stub */ }
  disconnect() { /* harness stub */ }
}
(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = IntersectionObserverStub;

import { CartProvider } from '../context/CartContext';
import MenuPage from './MenuPage';

const ITEMS = [
  { id: 1, name: 'Ember Classic Burger', description: 'Charred beef, smoked gouda', price: 28.5, image: '/burger.jpg', category: 'Mains', tags: [] as string[] },
  { id: 2, name: 'Garden Herb Salad', description: 'Crisp leaves, citrus dressing', price: 14, image: '/salad.jpg', category: 'Starters', tags: ['Gluten-Free'] },
  { id: 3, name: 'Truffle Forest Pasta', description: 'Wild mushrooms, truffle cream', price: 24, image: '/pasta.jpg', category: 'Mains', tags: ['Vegan'] },
];

function setup() {
  render(
    <MemoryRouter>
      <CartProvider>
        <MenuPage />
      </CartProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  h.fetchMenuItems.mockResolvedValue(ITEMS);
});

afterEach(cleanup);

describe('MenuPage — rendering and filtering', () => {
  it('renders every item the API returns, with prices, under categories derived from the items', async () => {
    setup();
    expect(await screen.findByText('Ember Classic Burger')).toBeTruthy();
    expect(screen.getByText('Garden Herb Salad')).toBeTruthy();
    expect(screen.getByText('Truffle Forest Pasta')).toBeTruthy();
    expect(screen.getAllByText('$28.50').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$14.00').length).toBeGreaterThan(0);
    // Category navigation comes from the items themselves.
    expect(screen.getAllByRole('button', { name: 'Mains' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Starters' }).length).toBeGreaterThan(0);
  });

  it('selecting a category shows only its dishes', async () => {
    setup();
    expect(await screen.findByText('Ember Classic Burger')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Starters' })[0]);
    expect(screen.getByText('Garden Herb Salad')).toBeTruthy();
    expect(screen.queryByText('Ember Classic Burger')).toBeNull();
    expect(screen.queryByText('Truffle Forest Pasta')).toBeNull();
  });

  it("the 'Gluten Free' filter matches a dish tagged 'Gluten-Free' (Step 5 normalisation, end-to-end)", async () => {
    setup();
    expect(await screen.findByText('Ember Classic Burger')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Gluten Free' }));
    expect(screen.getByText('Garden Herb Salad')).toBeTruthy();
    expect(screen.queryByText('Ember Classic Burger')).toBeNull();
    expect(screen.queryByText('Truffle Forest Pasta')).toBeNull();
  });

  it('search narrows the grid by dish name', async () => {
    setup();
    expect(await screen.findByText('Ember Classic Burger')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Search dishes...'), { target: { value: 'truffle' } });
    expect(screen.getByText('Truffle Forest Pasta')).toBeTruthy();
    expect(screen.queryByText('Ember Classic Burger')).toBeNull();
    expect(screen.queryByText('Garden Herb Salad')).toBeNull();
  });

  it('a zero-match search shows the page’s real empty state', async () => {
    setup();
    expect(await screen.findByText('Ember Classic Burger')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Search dishes...'), { target: { value: 'sushi' } });
    expect(await screen.findByText('No dishes found matching your criteria.')).toBeTruthy();
    expect(screen.queryByText('Ember Classic Burger')).toBeNull();
  });
});
