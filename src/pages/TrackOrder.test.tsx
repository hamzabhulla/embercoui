/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mega-audit Area 2, M3 — TrackOrder, behaviourally. The order fetch
// is stubbed at the services/api seam and Supabase at the lib seam
// (a recording fake channel), so what is pinned is the page's own
// behaviour: the stepper reflecting the fetched status (including
// terminal states), the items/totals/address from the payload, the
// realtime subscription wiring for THIS order id (opened on mount,
// removed on unmount), a pushed channel event re-fetching and
// re-rendering the advanced status, and the honest not-found state
// for an unknown id.

const h = vi.hoisted(() => {
  const channel: { on: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> } = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);
  return {
    apiRequest: vi.fn(),
    channel,
    channelFn: vi.fn(() => channel),
    removeChannel: vi.fn(),
  };
});

vi.mock('../context/CurrencyContext.tsx', () => ({
  useCurrency: () => ({ format: (n: number) => `$${n.toFixed(2)}`, currency: 'USD' }),
}));
vi.mock('../services/api.ts', () => ({
  apiRequest: h.apiRequest,
  fetchMenuItems: vi.fn(async () => []),
  fetchPublicSettings: vi.fn(async () => null),
}));
vi.mock('../lib/supabase.ts', () => ({
  supabase: { channel: h.channelFn, removeChannel: h.removeChannel },
  isSupabaseConfigured: true,
}));

import TrackOrder from './TrackOrder';

const ORDER_ID = '50b3d461-1111-4000-8000-000000000001';

function makeOrder(status: string, paymentStatus = 'unpaid') {
  return {
    id: ORDER_ID, status, paymentStatus,
    subtotal: 57, deliveryFee: 3, discount: 5, total: 55, currency: 'USD',
    items: [
      { menuItemId: 1, name: 'Ember Classic Burger', unitPrice: 28.5, quantity: 2 },
    ],
    createdAt: '2026-10-23T10:00:00.000Z',
    address: { line1: '1 Ember Lane', city: 'Lahore' },
    customerName: 'Test Guest',
  };
}

function mockOrder(order: ReturnType<typeof makeOrder>) {
  h.apiRequest.mockImplementation(async () => ({ ok: true, status: 200, data: { order }, error: null }));
}

function setup(id = ORDER_ID) {
  return render(
    <MemoryRouter initialEntries={[`/track-order/${id}`]}>
      <Routes>
        <Route path="/track-order/:id" element={<TrackOrder />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps implementations, but re-pin the channel chain
  // explicitly so no earlier test's state can leak into the wiring.
  h.channel.on.mockReturnValue(h.channel);
  h.channel.subscribe.mockReturnValue(h.channel);
  h.channelFn.mockReturnValue(h.channel);
});

afterEach(cleanup);

describe('TrackOrder — rendering the fetched order', () => {
  it('preparing: the stepper marks Preparing current, and items/totals/payment/address come from the payload', async () => {
    mockOrder(makeOrder('preparing'));
    setup();
    expect(await screen.findByText('Order #50b3d461')).toBeTruthy();
    expect(screen.getByText('Preparing — the kitchen is working on it')).toBeTruthy();
    expect(screen.getByText(/Payment: Pay on delivery/)).toBeTruthy();
    expect(screen.getByText('2 × Ember Classic Burger')).toBeTruthy();
    expect(screen.getAllByText('$57.00')).toHaveLength(2); // line total AND subtotal
    expect(screen.getByText('−$5.00')).toBeTruthy();
    expect(screen.getByText('$3.00')).toBeTruthy();
    expect(screen.getByText('$55.00')).toBeTruthy();
    expect(screen.getByText('Delivering to 1 Ember Lane, Lahore')).toBeTruthy();
    // Steps before Preparing are plain (done), steps after are plain (upcoming).
    expect(screen.getByText('Order placed')).toBeTruthy();
    expect(screen.getByText('On its way')).toBeTruthy();
  });

  it('delivered (terminal): Delivered is the current step and payment reads Paid', async () => {
    mockOrder(makeOrder('delivered', 'paid'));
    setup();
    expect(await screen.findByText('Delivered')).toBeTruthy();
    expect(screen.getByText(/Payment: Paid/)).toBeTruthy();
    expect(screen.queryByText(/was cancelled/)).toBeNull();
  });

  it('cancelled (terminal): the cancellation banner replaces the stepper', async () => {
    mockOrder(makeOrder('cancelled'));
    setup();
    expect(await screen.findByText(/This order was cancelled/)).toBeTruthy();
    expect(screen.queryByText('Order placed')).toBeNull();
  });

  it('an unknown id (404) shows the not-found state, never the order UI', async () => {
    h.apiRequest.mockImplementation(async () => ({ ok: false, status: 404, data: null, error: 'Order not found' }));
    setup('00000000-0000-4000-8000-000000000000');
    expect(await screen.findByText('We could not find that order')).toBeTruthy();
    expect(screen.queryByText(/Your Order/)).toBeNull();
  });
});

describe('TrackOrder — realtime wiring', () => {
  it('subscribes to this order’s UPDATE channel on mount and removes the channel on unmount', async () => {
    mockOrder(makeOrder('preparing'));
    const { unmount } = setup();
    expect(await screen.findByText('Order #50b3d461')).toBeTruthy();

    expect(h.channelFn).toHaveBeenCalledWith(`order-tracking-${ORDER_ID}`);
    expect(h.channel.on).toHaveBeenCalledWith(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${ORDER_ID}` },
      expect.any(Function),
    );
    expect(h.channel.subscribe).toHaveBeenCalledTimes(1);
    expect(h.removeChannel).not.toHaveBeenCalled();

    unmount();
    expect(h.removeChannel).toHaveBeenCalledTimes(1);
    expect(h.removeChannel).toHaveBeenCalledWith(h.channel);
  });

  it('a pushed channel event re-fetches and the stepper advances to the new status', async () => {
    let current = makeOrder('preparing');
    h.apiRequest.mockImplementation(async () => ({ ok: true, status: 200, data: { order: current }, error: null }));
    setup();
    expect(await screen.findByText('Preparing — the kitchen is working on it')).toBeTruthy();
    const callsBefore = h.apiRequest.mock.calls.length;

    current = makeOrder('ready');
    const pushed = h.channel.on.mock.calls[0][2] as () => void;
    await act(async () => { pushed(); });

    // Preparing is now a completed (plain) step; the working-on-it
    // suffix is gone and one more fetch happened behind the event.
    expect(await screen.findByText('Preparing')).toBeTruthy();
    expect(screen.queryByText(/the kitchen is working on it/)).toBeNull();
    expect(h.apiRequest.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
