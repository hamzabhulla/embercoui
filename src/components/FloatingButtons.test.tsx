/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mega-audit Area 2, M3 — the FloatingButtons chat widget,
// behaviourally. The REAL widget runs against the REAL CartProvider;
// the API service is stubbed at its module seam. What is pinned:
//  - a chat response carrying cart actions applies them to the real
//    cart through the live menu (right dish, right quantity), with
//    accumulation respecting the cart's per-line cap of 50;
//  - the assistant's reply renders verbatim (the server strips its
//    [[ADD:…]] markers before replying — no marker text is visible);
//  - the "Added to your cart" note appears and the cart drawer is
//    opened for review;
//  - a response with no actions changes nothing (and never even
//    fetches the menu);
//  - the outgoing request carries the conversation and the cart as
//    ids + quantities only;
//  - the WhatsApp button exists iff a number is configured.

const h = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  fetchMenuItems: vi.fn(),
  fetchPublicSettings: vi.fn(),
  confirmPayment: vi.fn(),
  settings: { current: null as unknown },
  chatResponse: { current: null as unknown },
  elementsOptions: { current: null as unknown },
}));

vi.mock('../services/api.ts', () => ({
  apiRequest: h.apiRequest,
  fetchMenuItems: h.fetchMenuItems,
  fetchPublicSettings: h.fetchPublicSettings,
}));

// Stripe stubbed at the same seams as the Checkout/Reservation
// suites: the react-stripe-js hooks/elements and the publishable-key
// module. Elements records the options it was handed so a test can
// prove the panel mounted with the response's own client secret.
vi.mock('@stripe/react-stripe-js', async () => {
  const React = await import('react');
  return {
    Elements: ({ children, options }: { children: React.ReactNode; options?: unknown }) => {
      h.elementsOptions.current = options;
      return React.createElement(React.Fragment, null, children);
    },
    PaymentElement: () => React.createElement('div', { 'data-testid': 'payment-element' }),
    useStripe: () => ({ confirmPayment: h.confirmPayment }),
    useElements: () => ({}),
  };
});

vi.mock('../lib/stripe.ts', () => ({
  stripePromise: Promise.resolve(null),
  isStripeConfigured: true,
}));

// Harness plumbing: jsdom has no Element.scrollTo, which the
// widget's transcript auto-scroll effect calls on every render.
// Real browsers all provide it; stub the no-op so the effect runs.
if (typeof Element.prototype.scrollTo !== 'function') {
  Element.prototype.scrollTo = () => { /* jsdom stub */ };
}

import { CartProvider, useCart, type CartContextType } from '../context/CartContext';
import FloatingButtons from './FloatingButtons';

const MENU = [
  { id: 1, name: 'Ember Classic Burger', description: 'Charred beef, smoked gouda', price: 28.5, image: '/burger.jpg', category: 'Mains', tags: [] as string[] },
  { id: 2, name: 'Forest Truffle Burger', description: 'Truffle cream, wild mushrooms', price: 29, image: '/truffle.jpg', category: 'Mains', tags: [] as string[] },
];
const BURGER_LINE = { id: 1, name: 'Ember Classic Burger', price: 28.5, image: '/burger.jpg' };

let cart: CartContextType;
function Probe() {
  cart = useCart();
  return (
    <div data-testid="lines">
      {cart.items.map((i) => `${i.id}:${i.quantity}`).join(',')}
    </div>
  );
}

function lines() {
  return screen.getByTestId('lines').textContent;
}

function setup(seed?: unknown[]) {
  if (seed) localStorage.setItem('ember_cart', JSON.stringify(seed));
  render(
    <CartProvider>
      <Probe />
      <FloatingButtons />
    </CartProvider>,
  );
}

function sendMessage(text: string) {
  fireEvent.click(screen.getByLabelText('Speed Dial'));
  fireEvent.click(screen.getByLabelText('Ask Ember - AI Assistant'));
  fireEvent.change(screen.getByLabelText('Message Ember AI'), { target: { value: text } });
  fireEvent.click(screen.getByLabelText('Send message'));
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  h.settings.current = null;
  h.chatResponse.current = null;
  h.elementsOptions.current = null;
  h.fetchPublicSettings.mockImplementation(async () => h.settings.current);
  h.fetchMenuItems.mockImplementation(async () => MENU);
  h.apiRequest.mockImplementation(async () => h.chatResponse.current);
});

afterEach(cleanup);

describe('FloatingButtons — chat cart actions', () => {
  it('applies a response’s actions to the real cart, clamping accumulation at the per-line cap', async () => {
    h.chatResponse.current = {
      ok: true, status: 200, error: null,
      data: { reply: 'Of course — adding that for you now.', actions: [{ menuItemId: 1, quantity: 2 }] },
    };
    setup([{ ...BURGER_LINE, quantity: 49 }]);
    sendMessage('Two more burgers, please');

    // 49 in the cart + 2 requested = 51 → the store clamps to 50.
    // Explicit 3000ms timeout (house pattern, cf. ScreenLock.test.tsx):
    // the chat → menu → cart chain can exceed the 1s default under load.
    await waitFor(() => expect(lines()).toBe('1:50'), { timeout: 3000 });
    expect(screen.getByText('Of course — adding that for you now.')).toBeTruthy();
    expect(screen.getByText(/Added to your cart: 2 × Ember Classic Burger/)).toBeTruthy();
    // No raw action marker is ever visible in the transcript.
    expect(document.body.textContent).not.toContain('[[');

    // The outgoing request carried the conversation plus the cart as
    // ids + quantities only — no names, no prices.
    const chatCall = h.apiRequest.mock.calls.find(([path]) => path === '/api/v1/chat');
    expect(chatCall).toBeTruthy();
    const body = JSON.parse((chatCall![1] as { body: string }).body) as { messages: unknown; cart: unknown };
    expect(body.cart).toEqual([{ menuItemId: 1, quantity: 49 }]);
    expect(body.messages).toEqual([{ role: 'user', content: 'Two more burgers, please' }]);

    // …and after the beat, the cart drawer opens for review.
    // Poll the open state itself instead of sleeping a fixed ~1100ms:
    // the component opens the drawer on a 900ms timer, so a fixed sleep
    // races it under load; waitFor with an explicit timeout does not.
    await waitFor(() => expect(cart.isOpen).toBe(true), { timeout: 3000 });
  });

  it('accumulates below the cap exactly (existing line + action quantity)', async () => {
    h.chatResponse.current = {
      ok: true, status: 200, error: null,
      data: { reply: 'Done — anything else?', actions: [{ menuItemId: 1, quantity: 2 }] },
    };
    setup([{ ...BURGER_LINE, quantity: 1 }]);
    sendMessage('Add two burgers');
    await waitFor(() => expect(lines()).toBe('1:3'), { timeout: 3000 });
    expect(screen.getByText('Done — anything else?')).toBeTruthy();
  });

  it('a response with no actions changes nothing and never fetches the menu', async () => {
    h.chatResponse.current = {
      ok: true, status: 200, error: null,
      data: { reply: 'We open at noon and serve until late.' },
    };
    setup([{ ...BURGER_LINE, quantity: 1 }]);
    sendMessage('What are your hours?');
    expect(await screen.findByText('We open at noon and serve until late.', {}, { timeout: 3000 })).toBeTruthy();
    expect(lines()).toBe('1:1');
    expect(screen.queryByText(/Added to your cart/)).toBeNull();
    expect(h.fetchMenuItems).not.toHaveBeenCalled();
  });
});

describe('FloatingButtons — chat booking fee payment (Step 10, M3)', () => {
  const FEE_PAYMENT = { clientSecret: 'pi_res_secret_test', paymentIntentId: 'pi_res', amount: 5, currency: 'USD' };
  const feeBookingResponse = () => ({
    ok: true, status: 200, error: null,
    data: {
      reply: 'Your booking is made — a table for four. To hold the table, the booking fee of USD 5.00 is payable by card: your table is held, and your booking confirmed, the moment it is paid — until then, it is not yet confirmed.',
      booking: { id: 'res-fee-1', date: '2027-01-15', time: '19:00', guests: 4, status: 'pending', feePaymentStatus: 'pending', feePayment: FEE_PAYMENT },
    },
  });

  it('a fee booking renders the card step in the conversation, mounted with the response’s clientSecret', async () => {
    h.chatResponse.current = feeBookingResponse();
    setup();
    sendMessage('Book a table for four, please');

    expect(await screen.findByTestId('payment-element', {}, { timeout: 3000 })).toBeTruthy();
    // Elements was handed THIS booking's secret — nothing else.
    expect(h.elementsOptions.current).toMatchObject({ clientSecret: 'pi_res_secret_test' });
    expect(screen.getByText('Booking Fee')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Pay/ })).toBeTruthy();
    expect(screen.getByText(/charged by card now/)).toBeTruthy();
    // The payment handle never rides back out: the outgoing request
    // carried only the conversation (fee panels are display-only).
    const chatCall = h.apiRequest.mock.calls.find(([path]) => path === '/api/v1/chat');
    const body = JSON.parse((chatCall![1] as { body: string }).body) as { messages: unknown };
    expect(body.messages).toEqual([{ role: 'user', content: 'Book a table for four, please' }]);
    expect(JSON.stringify(body)).not.toContain('pi_res_secret_test');
  });

  it('a follow-up message never echoes the fee payment handle back to the server', async () => {
    h.chatResponse.current = feeBookingResponse();
    setup();
    sendMessage('Book a table for four, please');
    expect(await screen.findByTestId('payment-element', {}, { timeout: 3000 })).toBeTruthy();

    // The transcript now holds the fee panel — and with it the
    // clientSecret — in local state. The guest asks something else;
    // the SECOND request must carry the plain conversation only:
    // the outgoing-history filter admits user/assistant turns, so
    // the display-only fee panel (and any note) never rides back.
    // This pins the secret-echo protection behaviourally: revert
    // the filter to excluding only notes and this test goes red.
    h.chatResponse.current = { ok: true, status: 200, error: null, data: { reply: 'We seat until ten — is there anything else?' } };
    fireEvent.change(screen.getByLabelText('Message Ember AI'), { target: { value: 'Thank you — one more thing' } });
    fireEvent.click(screen.getByLabelText('Send message'));
    await waitFor(() => expect(h.apiRequest.mock.calls.filter(([path]) => path === '/api/v1/chat')).toHaveLength(2), { timeout: 3000 });

    const secondCall = h.apiRequest.mock.calls.filter(([path]) => path === '/api/v1/chat')[1];
    const rawBody = (secondCall[1] as { body: string }).body;
    expect(rawBody).not.toContain('pi_res_secret_test');
    expect(rawBody).not.toContain('feePayment');
    const parsed = JSON.parse(rawBody) as { messages: { role: string; content: string }[] };
    expect(parsed.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(parsed.messages[2].content).toBe('Thank you — one more thing');
  });

  it('confirm success replaces the panel with the factual outcome — fee paid via Stripe, confirmation still to follow', async () => {
    h.chatResponse.current = feeBookingResponse();
    h.confirmPayment.mockResolvedValue({ paymentIntent: { status: 'succeeded' } });
    setup();
    sendMessage('Book a table for four, please');
    expect(await screen.findByTestId('payment-element', {}, { timeout: 3000 })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Pay/ }));
    expect(await screen.findByText('Booking Fee Paid', {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByText(/paid through Stripe/)).toBeTruthy();
    // The website's post-payment register, mirrored: reservation
    // received, the team reviews and calls to confirm — the panel
    // never claims more than that.
    expect(screen.getByText(/call you to confirm/)).toBeTruthy();
    expect(screen.queryByTestId('payment-element')).toBeNull();
    expect(screen.queryByText('Booking Fee')).toBeNull();
  });

  it('a non-completed confirm keeps the panel open with the shared form’s honest error copy', async () => {
    h.chatResponse.current = feeBookingResponse();
    h.confirmPayment.mockResolvedValue({ paymentIntent: { status: 'requires_action' } });
    setup();
    sendMessage('Book a table for four, please');
    expect(await screen.findByTestId('payment-element', {}, { timeout: 3000 })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Pay/ }));
    expect(await screen.findByText(/That payment was not completed, so the booking fee was not paid and your table is not held yet/, {}, { timeout: 3000 })).toBeTruthy();
    // The step stays open for another try; no success is claimed.
    expect(screen.getByTestId('payment-element')).toBeTruthy();
    expect(screen.getByText('Booking Fee')).toBeTruthy();
    expect(screen.queryByText('Booking Fee Paid')).toBeNull();
  });

  it('a booking without a feePayment renders exactly as before — no panel, no Elements', async () => {
    h.chatResponse.current = {
      ok: true, status: 200, error: null,
      data: {
        reply: 'It is done — a table for four is reserved, and your reference is abcd1234.',
        booking: { id: 'res-free-1', date: '2027-01-15', time: '19:00', guests: 4, status: 'pending', feePaymentStatus: 'none' },
      },
    };
    setup();
    sendMessage('Book a table for four, please');
    expect(await screen.findByText(/a table for four is reserved/, {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.queryByTestId('payment-element')).toBeNull();
    expect(screen.queryByText('Booking Fee')).toBeNull();
    expect(h.elementsOptions.current).toBeNull();
  });
});

describe('FloatingButtons — WhatsApp button', () => {
  it('is present when a WhatsApp number is configured', async () => {
    h.settings.current = { whatsappNumber: '+92 300 1234567' };
    setup();
    expect(await screen.findByLabelText('Chat with us on WhatsApp', {}, { timeout: 3000 })).toBeTruthy();
  });

  it('is absent when no number is configured', async () => {
    h.settings.current = { whatsappNumber: null };
    setup();
    // Wait until the settings fetch has actually resolved, so the
    // absence is the settled state, not a not-yet-loaded one.
    await waitFor(() => expect(h.fetchPublicSettings).toHaveBeenCalled(), { timeout: 3000 });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByLabelText('Chat with us on WhatsApp')).toBeNull();
  });
});
