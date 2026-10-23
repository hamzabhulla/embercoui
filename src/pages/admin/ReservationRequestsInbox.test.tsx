/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Phase G — the admin change-request inbox, rendered. The admin API
// is stubbed at its module seam, so what is pinned here is the
// inbox's own behaviour: the pending badge, booked-vs-requested
// side-by-side, the Apply form pre-filled with the proposal (and the
// save carrying the request id), decline requiring a reply, mark
// handled, the view-only read, and the pre-0015 degraded note.

const h = vi.hoisted(() => ({
  adminGet: vi.fn(),
  adminSend: vi.fn(),
}));

vi.mock('../../services/adminApi', () => ({
  adminGet: h.adminGet,
  adminSend: h.adminSend,
}));

import ReservationRequestsInbox from './ReservationRequestsInbox';

const REQUEST = {
  id: 'req-1', reservationId: 'res-1', requesterEmail: 'guest@example.com',
  proposedDate: '2026-11-25', proposedTime: '20:00:00', proposedGuests: 6,
  message: 'A quieter corner, if one is free.', status: 'pending', adminReply: null,
  createdAt: '2026-10-22T09:00:00.000Z',
  reservation: {
    id: 'res-1', name: 'Ayesha Khan', email: 'guest@example.com', phone: '+92 300 111 2222',
    date: '2026-11-20', time: '19:00:00', guests: 2, status: 'confirmed',
  },
};

function mockApi(over: Partial<{ requests: unknown[]; pendingTotal: number; degraded: boolean }> = {}) {
  h.adminGet.mockResolvedValue({
    requests: over.requests ?? [REQUEST],
    total: (over.requests ?? [REQUEST]).length,
    pendingTotal: over.pendingTotal ?? 1,
    degraded: over.degraded ?? false,
  });
  h.adminSend.mockResolvedValue({});
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi();
});

afterEach(cleanup);

describe('ReservationRequestsInbox', () => {
  it('renders the pending badge and the booked vs requested change side-by-side', async () => {
    render(<ReservationRequestsInbox canManage />);
    expect(await screen.findByText('1 pending')).toBeTruthy();
    expect(screen.getByText('Ayesha Khan')).toBeTruthy();
    expect(screen.getByText(/Fri, 20 Nov 2026 · 19:00 · 2 guests/)).toBeTruthy();
    expect(screen.getByText(/Wed, 25 Nov 2026/)).toBeTruthy();
    expect(screen.getByText(/20:00/)).toBeTruthy();
    expect(screen.getByText(/6 guests/)).toBeTruthy();
    expect(screen.getByText(/A quieter corner, if one is free\./)).toBeTruthy();
    expect(screen.getByText(/guest@example\.com/)).toBeTruthy();
  });

  it('Apply opens the edit pre-filled with the proposal and the save carries the request id', async () => {
    const onApplied = vi.fn();
    render(<ReservationRequestsInbox canManage onApplied={onApplied} />);
    fireEvent.click(await screen.findByText('Apply change'));
    const dateInput = screen.getByLabelText('Date') as HTMLInputElement;
    const timeInput = screen.getByLabelText('Time') as HTMLInputElement;
    const guestsInput = screen.getByLabelText('Guests') as HTMLInputElement;
    expect(dateInput.value).toBe('2026-11-25');
    expect(timeInput.value).toBe('20:00');
    expect(guestsInput.value).toBe('6');
    // Closing without saving must not call anything.
    fireEvent.click(screen.getByText('Cancel'));
    expect(h.adminSend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Apply change'));
    fireEvent.change(screen.getByLabelText('Note for the guest (optional)'), { target: { value: 'Done — see you then.' } });
    fireEvent.click(screen.getByText('Save & approve'));
    await waitFor(() => expect(h.adminSend).toHaveBeenCalledWith('PATCH', '/api/v1/admin/reservations/res-1', {
      date: '2026-11-25', time: '20:00', guests: 6, requestId: 'req-1', reply: 'Done — see you then.',
    }));
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
    expect(await screen.findByText(/Change applied/)).toBeTruthy();
  });

  it('Decline stays disabled until a reply is written, then posts it', async () => {
    render(<ReservationRequestsInbox canManage />);
    fireEvent.click(await screen.findByText('Decline'));
    const confirm = screen.getByText('Decline request') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Reply for the guest \(required/), { target: { value: 'Fully booked that evening.' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(h.adminSend).toHaveBeenCalledWith('POST', '/api/v1/admin/reservation-requests/req-1/decline', {
      reply: 'Fully booked that evening.',
    }));
  });

  it('Mark handled posts without a reply when none is written', async () => {
    render(<ReservationRequestsInbox canManage />);
    fireEvent.click(await screen.findByText('Mark handled'));
    // The opener and the confirm share the label; the confirm is the
    // second of the two once the panel is open.
    const buttons = await screen.findAllByText('Mark handled');
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(h.adminSend).toHaveBeenCalledWith('POST', '/api/v1/admin/reservation-requests/req-1/handled', {}));
  });

  it('a view-only holder sees the request but no handling actions', async () => {
    render(<ReservationRequestsInbox canManage={false} />);
    expect(await screen.findByText('Ayesha Khan')).toBeTruthy();
    expect(screen.queryByText('Apply change')).toBeNull();
    expect(screen.queryByText('Decline')).toBeNull();
    expect(screen.queryByText('Mark handled')).toBeNull();
  });

  it('switching the filter refetches with that status', async () => {
    render(<ReservationRequestsInbox canManage />);
    await screen.findByText('Ayesha Khan');
    fireEvent.click(screen.getByText('Declined'));
    await waitFor(() => expect(h.adminGet).toHaveBeenCalledWith(expect.stringContaining('status=declined')));
  });

  it('pre-0015: the degraded note replaces the list', async () => {
    mockApi({ requests: [], pendingTotal: 0, degraded: true });
    render(<ReservationRequestsInbox canManage />);
    expect(await screen.findByText(/Change requests activate once the latest database update is applied/)).toBeTruthy();
    expect(screen.queryByText('1 pending')).toBeNull();
  });

  it('an empty pending queue reads honestly', async () => {
    mockApi({ requests: [], pendingTotal: 0 });
    render(<ReservationRequestsInbox canManage />);
    expect(await screen.findByText('No pending change requests.')).toBeTruthy();
  });
});
