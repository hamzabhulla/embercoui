/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Phase G — the Account page's Reservations tab, rendered. Auth,
// cart, currency and the API are stubbed at their module seams, so
// what is pinned here is the tab's own behaviour: the booking card
// (date/time/guests/status + the Phase F fee state), the customer's
// change requests with their outcomes and the team's replies read
// back, the request form's submit shape, the pending-request state
// replacing the form, and the pre-0015 "call us" honesty note.

const h = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  reservationsResponse: { current: null as unknown },
}));

vi.mock('../context/AuthContext.tsx', () => {
  // ONE stable object, like the real context: a fresh identity per
  // render would refire the page's user-dependent effects forever.
  const auth = {
    user: { id: 'user-1', email: 'user@example.com' },
    profile: {
      id: 'user-1', email: 'user@example.com', role: 'customer', fullName: 'Test User',
      phone: null, addresses: [], favorites: [], createdAt: '2026-01-01T00:00:00.000Z',
    },
    loading: false, profileLoading: false, profileError: null,
    signOut: vi.fn(async () => {}), refreshProfile: vi.fn(async () => {}),
  };
  return { useAuth: () => auth };
});
vi.mock('../context/CartContext.tsx', () => ({
  useCart: () => ({ addItem: vi.fn(), updateQuantity: vi.fn(), setIsOpen: vi.fn(), items: [] }),
}));
vi.mock('../context/CurrencyContext.tsx', () => ({
  useCurrency: () => ({ format: (n: number, code?: string) => `${code ?? 'USD'} ${n.toFixed(2)}` }),
}));
vi.mock('../services/api.ts', () => ({
  apiRequest: h.apiRequest,
  fetchMenuItems: vi.fn(async () => []),
  fetchPublicSettings: vi.fn(async () => null),
}));
vi.mock('../services/auth.ts', () => ({ updatePassword: vi.fn(async () => ({})) }));

import Account from './Account';

const RESERVATION = {
  id: 'res-1', name: 'Test User', date: '2026-11-20', time: '19:00:00', guests: 4,
  status: 'confirmed', feeAmount: 15, feeCurrency: 'USD', feePaymentStatus: 'paid',
  requests: [
    {
      id: 'req-old', proposedDate: '2026-11-22', proposedTime: null, proposedGuests: null,
      message: 'Could we move to Sunday?', status: 'declined',
      adminReply: 'Sunday is fully booked — Friday is open.', createdAt: '2026-10-20T09:00:00.000Z',
    },
  ],
};
const PENDING_RESERVATION = {
  id: 'res-2', name: 'Test User', date: '2026-12-01', time: '20:00:00', guests: 2,
  status: 'confirmed', feeAmount: null, feeCurrency: null, feePaymentStatus: 'none',
  requests: [
    {
      id: 'req-pending', proposedDate: null, proposedTime: '21:00:00', proposedGuests: null,
      message: '', status: 'pending', adminReply: null, createdAt: '2026-10-21T09:00:00.000Z',
    },
  ],
};

function mockApi(degraded = false) {
  h.apiRequest.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === '/api/v1/account/orders') return { ok: true, status: 200, data: { orders: [] }, error: null };
    if (path === '/api/v1/account/favorites') return { ok: true, status: 200, data: { items: [] }, error: null };
    if (path === '/api/v1/account/reservations') {
      return {
        ok: true, status: 200, error: null,
        data: h.reservationsResponse.current ?? {
          reservations: [RESERVATION, PENDING_RESERVATION], requestsDegraded: degraded,
        },
      };
    }
    if (path.endsWith('/requests') && init?.method === 'POST') {
      return { ok: true, status: 201, data: { request: { id: 'req-new' } }, error: null };
    }
    return { ok: false, status: 404, data: null, error: 'Not found' };
  });
}

async function openReservationsTab() {
  render(
    <MemoryRouter>
      <Account />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByText('Reservations'));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.reservationsResponse.current = null;
  mockApi();
});

afterEach(cleanup);

describe('Account — Your Reservations', () => {
  it('renders the booking with its fee state, and the declined request with the team’s reply', async () => {
    await openReservationsTab();
    expect(await screen.findByText(/Friday, 20 November 2026/)).toBeTruthy();
    expect(screen.getByText(/19:00 · Table for 4 guests/)).toBeTruthy();
    expect(screen.getByText(/Booking fee USD 15\.00 — paid/)).toBeTruthy();
    expect(screen.getByText('Declined')).toBeTruthy();
    expect(screen.getByText(/Asked for: Sun 22 Nov/)).toBeTruthy();
    expect(screen.getByText(/Our reply: Sunday is fully booked — Friday is open\./)).toBeTruthy();
  });

  it('sends a change request with only the filled-in fields', async () => {
    await openReservationsTab();
    fireEvent.click(await screen.findByText('Request a Change'));
    // The page's labels are unassociated by design (the existing form
    // pattern), so the fields are reached by type / placeholder.
    const guestsInput = document.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(guestsInput, { target: { value: '6' } });
    fireEvent.change(screen.getByPlaceholderText(/Anything we should know/), { target: { value: 'Window seat, please.' } });
    fireEvent.click(screen.getByText('Send Request'));
    await waitFor(() => {
      const post = h.apiRequest.mock.calls.find(
        ([path, init]) => path === '/api/v1/account/reservations/res-1/requests' && (init as { method?: string })?.method === 'POST',
      );
      expect(post).toBeTruthy();
      expect(JSON.parse((post![1] as { body: string }).body)).toEqual({ proposedGuests: 6, message: 'Window seat, please.' });
    });
    expect(await screen.findByText(/Your change request was sent/)).toBeTruthy();
  });

  it('refuses to send an empty request', async () => {
    await openReservationsTab();
    fireEvent.click(await screen.findByText('Request a Change'));
    fireEvent.click(screen.getByText('Send Request'));
    expect(await screen.findByText(/Tell us what you would like to change/)).toBeTruthy();
    const posts = h.apiRequest.mock.calls.filter(([path]) => String(path).endsWith('/requests'));
    expect(posts).toHaveLength(0);
  });

  it('a reservation with a pending request shows the waiting state instead of the form', async () => {
    await openReservationsTab();
    expect(await screen.findByText(/Your change request is with our team/)).toBeTruthy();
    // Exactly one "Request a Change" button exists — the other booking's.
    expect(screen.getAllByText('Request a Change')).toHaveLength(1);
  });

  it('pre-0015: bookings render and change requests honestly ask for a call', async () => {
    mockApi(true);
    await openReservationsTab();
    expect(await screen.findByText(/Friday, 20 November 2026/)).toBeTruthy();
    expect(screen.getAllByText(/online change requests are not available just yet/)).toHaveLength(2);
    expect(screen.queryByText('Request a Change')).toBeNull();
  });
});

// The featured order's progress tracker once laid its six steps out as
// a no-shrink flex row: each step's automatic minimum size was its
// label's min-content (~71px for CONFIRMED), the row's ~382px minimum
// widened the whole page grid column, and at ~390px the Account page
// scrolled sideways with the labels butted together. These pins hold
// the responsive contract that replaced it: a 3-over-3 grid below sm
// (6 across from sm up, geometrically identical to the old flex row),
// shrinkable steps, the row-break step's connector hidden only below
// sm, and action groups allowed to wrap instead of forcing width.
const FEATURED_ORDER = {
  id: '50b3d461-1111-4000-8000-000000000001', status: 'preparing', paymentStatus: 'pending',
  total: 86, currency: 'USD', createdAt: '2026-10-22T16:54:00.000Z',
  items: [
    { menuItemId: 1, name: 'Ember Classic Burger', unitPrice: 28.5, quantity: 2 },
    { menuItemId: 2, name: 'Forest Truffle Burger', unitPrice: 29, quantity: 1 },
  ],
};
const HISTORY_ORDER = {
  id: '9f2ac410-2222-4000-8000-000000000002', status: 'delivered', paymentStatus: 'paid',
  total: 86, currency: 'USD', createdAt: '2026-10-18T12:00:00.000Z',
  items: [{ menuItemId: 1, name: 'Ember Classic Burger', unitPrice: 28.5, quantity: 2 }],
};

function mockApiWithOrders() {
  h.apiRequest.mockImplementation(async (path: string) => {
    if (path === '/api/v1/account/orders') {
      return { ok: true, status: 200, data: { orders: [FEATURED_ORDER, HISTORY_ORDER] }, error: null };
    }
    if (path === '/api/v1/account/favorites') return { ok: true, status: 200, data: { items: [] }, error: null };
    if (path === '/api/v1/account/reservations') {
      return { ok: true, status: 200, error: null, data: { reservations: [], requestsDegraded: false } };
    }
    return { ok: false, status: 404, data: null, error: 'Not found' };
  });
}

describe('Account — Orders tab tracker (mobile layout contract)', () => {
  async function renderOrders() {
    mockApiWithOrders();
    render(
      <MemoryRouter>
        <Account />
      </MemoryRouter>,
    );
    expect(await screen.findByText('#50b3d461')).toBeTruthy();
    const placed = screen.getByText('Placed');
    const step = placed.parentElement as HTMLElement;
    return { tracker: step.parentElement as HTMLElement, step };
  }

  it('lays the six steps out as a responsive grid of shrinkable cells', async () => {
    const { tracker } = await renderOrders();
    expect(tracker.className).toContain('grid-cols-3');
    expect(tracker.className).toContain('sm:grid-cols-6');
    const steps = Array.from(tracker.children) as HTMLElement[];
    expect(steps).toHaveLength(6);
    for (const s of steps) {
      expect(s.className).toContain('min-w-0');
      expect(s.className).not.toContain('flex-1');
    }
    expect(steps.map((s) => s.lastElementChild?.textContent)).toEqual([
      'Placed', 'Confirmed', 'Preparing', 'Ready', 'On its way', 'Delivered',
    ]);
  });

  it('hides only the row-break step’s connector below sm', async () => {
    const { tracker } = await renderOrders();
    const steps = Array.from(tracker.children) as HTMLElement[];
    const connector = (i: number) => steps[i].querySelector('span');
    // Step 4 (Ready) starts the second mobile row: its incoming
    // connector would dangle at the row's left edge, so it is hidden
    // below sm and restored from sm up, where all six sit in one row.
    expect(connector(3)?.className).toContain('max-sm:hidden');
    expect(connector(1)?.className).not.toContain('max-sm:hidden');
    expect(connector(4)?.className).not.toContain('max-sm:hidden');
  });

  it('lets the order action groups wrap instead of forcing the card wide', async () => {
    await renderOrders();
    const againButtons = screen.getAllByText('Order Again');
    expect(againButtons.length).toBeGreaterThanOrEqual(2);
    for (const b of againButtons) {
      expect((b.parentElement as HTMLElement).className).toContain('flex-wrap');
    }
  });
});
