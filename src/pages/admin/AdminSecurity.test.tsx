/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Phase C — the Security & Activity page, rendered. The admin API is
// stubbed at its module seam, so what is pinned here is the page's
// own behaviour: the two tabs and their fetches, the honest
// "Unverified report" badge on client-reported failures (and its
// absence on verified rows), the readable from → to change rendering,
// the empty + degraded states, and the CSV export carrying the
// applied filters.

const h = vi.hoisted(() => ({
  adminGet: vi.fn(),
  adminDownloadCsv: vi.fn(),
}));

vi.mock('../../services/adminApi', () => ({
  adminGet: h.adminGet,
  adminDownloadCsv: h.adminDownloadCsv,
}));

import AdminSecurity from './AdminSecurity';

const LOGIN_ROW = {
  id: 'ev-1',
  timestamp: '2026-10-22T09:15:00.000Z',
  category: 'auth',
  action: 'auth.login',
  actor: { id: 'admin-1', label: 'Hamza Owner', role: 'admin' },
  entity: { type: 'session', id: null, label: 'Admin sign-in' },
  summary: 'Admin sign-in',
  changes: null,
  metadata: { ip: '203.0.113.9', userAgent: 'TestBrowser/1.0', verified: true, source: 'server' },
};
const FAILED_ROW = {
  id: 'ev-2',
  timestamp: '2026-10-22T09:20:00.000Z',
  category: 'auth',
  action: 'auth.login_failed',
  actor: { id: null, label: 'intruder@example.com', role: null },
  entity: null,
  summary: 'Failed admin sign-in attempt (client report — unverified)',
  changes: null,
  metadata: { ip: '198.51.100.7', userAgent: 'curl/8', verified: false, source: 'client-report' },
};
const CHANGE_ROW = {
  id: 'ev-3',
  timestamp: '2026-10-22T10:00:00.000Z',
  category: 'change',
  action: 'menu_item.updated',
  actor: { id: 'staff-1', label: 'Floor Staff', role: 'staff' },
  entity: { type: 'menu_item', id: '1', label: 'Menu item "Ember Classic" updated' },
  summary: 'Menu item "Ember Classic" updated',
  changes: { price: { from: 24, to: 26 }, status: { from: 'pending', to: 'confirmed' } },
  metadata: { ip: '203.0.113.10', userAgent: 'TestBrowser/1.0', verified: true, source: 'server' },
};

function mockApi(over: { auth?: object; change?: object } = {}) {
  h.adminGet.mockImplementation(async (path: string) => {
    if (path.includes('category=change')) {
      return over.change ?? { events: [CHANGE_ROW], total: 1, degraded: false };
    }
    return over.auth ?? { events: [LOGIN_ROW, FAILED_ROW], total: 2, degraded: false };
  });
  h.adminDownloadCsv.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockApi();
});

afterEach(cleanup);

describe('AdminSecurity — Login Activity tab', () => {
  it('renders verified sign-ins and badges the failed report as unverified', async () => {
    render(<AdminSecurity />);
    expect(await screen.findByText('Sign-in')).toBeTruthy();
    expect(screen.getByText('Hamza Owner')).toBeTruthy();
    expect(screen.getByText('203.0.113.9')).toBeTruthy();
    expect(screen.getByText('Failed sign-in attempt')).toBeTruthy();
    expect(screen.getByText('intruder@example.com')).toBeTruthy();
    // Exactly ONE unverified badge in the list: the client report.
    // The verified sign-in row must never carry it.
    expect(screen.getAllByText('Unverified report')).toHaveLength(1);
    // The default fetch is the auth category.
    expect(h.adminGet).toHaveBeenCalledWith(expect.stringContaining('/api/v1/admin/security/events?category=auth'));
  });

  it('shows the honest empty state when nothing is recorded', async () => {
    mockApi({ auth: { events: [], total: 0, degraded: false } });
    render(<AdminSecurity />);
    expect(await screen.findByText('No logins recorded yet.')).toBeTruthy();
  });

  it('shows the activation note instead of implying emptiness when degraded (pre-migration)', async () => {
    mockApi({ auth: { events: [], total: 0, degraded: true } });
    render(<AdminSecurity />);
    expect(await screen.findByText(/Activity logging activates once the latest database update is applied/)).toBeTruthy();
    expect(screen.queryByText('No logins recorded yet.')).toBeNull();
  });
});

describe('AdminSecurity — Change History tab', () => {
  it('switching tabs fetches the change category and renders diffs readably', async () => {
    render(<AdminSecurity />);
    await screen.findByText('Sign-in');
    fireEvent.click(screen.getByRole('button', { name: 'Change History' }));
    expect(await screen.findByText('Menu item updated')).toBeTruthy();
    expect(h.adminGet).toHaveBeenCalledWith(expect.stringContaining('category=change'));
    expect(screen.getByText('Floor Staff')).toBeTruthy();
    // The price diff renders with the 2-decimal money shape.
    expect(screen.getByText(/24\.00/)).toBeTruthy();
    expect(screen.getByText(/26\.00/)).toBeTruthy();
    expect(screen.getByText(/pending/)).toBeTruthy();
    expect(screen.getByText(/confirmed/)).toBeTruthy();
  });
});

describe('AdminSecurity — Phase G reservation events (final deep audit M2)', () => {
  const G_ROW = (id: string, action: string) => ({
    ...CHANGE_ROW,
    id,
    action,
    entity: { type: 'reservation_request', id: 'req-1', label: 'Change request' },
    summary: 'Change requested for a reservation',
    changes: null,
  });

  it('renders human labels for reservation.updated and every reservation_request.* action — never the raw strings', async () => {
    mockApi({
      change: {
        events: [
          G_ROW('ev-g1', 'reservation.updated'),
          G_ROW('ev-g2', 'reservation_request.created'),
          G_ROW('ev-g3', 'reservation_request.approved'),
          G_ROW('ev-g4', 'reservation_request.declined'),
          G_ROW('ev-g5', 'reservation_request.handled'),
        ],
        total: 5,
        degraded: false,
      },
    });
    render(<AdminSecurity />);
    await screen.findByText('Sign-in');
    fireEvent.click(screen.getByRole('button', { name: 'Change History' }));
    expect(await screen.findByText('Reservation updated')).toBeTruthy();
    expect(screen.getByText('Change request sent')).toBeTruthy();
    expect(screen.getByText('Change request approved')).toBeTruthy();
    expect(screen.getByText('Change request declined')).toBeTruthy();
    expect(screen.getByText('Change request handled')).toBeTruthy();
    for (const raw of ['reservation.updated', 'reservation_request.created', 'reservation_request.approved', 'reservation_request.declined', 'reservation_request.handled']) {
      expect(screen.queryByText(raw)).toBeNull();
    }
  });

  it('the Type filter offers BOTH reservation prefixes, and each one is sent as the action prefix', async () => {
    render(<AdminSecurity />);
    await screen.findByText('Sign-in');
    fireEvent.click(screen.getByRole('button', { name: 'Change History' }));
    await screen.findByText('Menu item updated');
    const select = screen.getByLabelText('Type') as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value);
    // 'reservation.' cannot match 'reservation_request.*' (the next
    // character is '_', not '.') — both prefixes must exist.
    expect(values).toContain('reservation.');
    expect(values).toContain('reservation_request.');
    expect(screen.getByRole('option', { name: 'Reservation requests' })).toBeTruthy();

    fireEvent.change(select, { target: { value: 'reservation_request.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => {
      expect(h.adminGet).toHaveBeenCalledWith(expect.stringContaining('action=reservation_request.'));
    });

    fireEvent.change(select, { target: { value: 'reservation.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => {
      expect(h.adminGet).toHaveBeenCalledWith(expect.stringContaining('action=reservation.'));
    });
  });
});

describe('AdminSecurity — filters + export', () => {
  it('the CSV export carries the applied filters', async () => {
    render(<AdminSecurity />);
    await screen.findByText('Sign-in');
    fireEvent.change(screen.getByLabelText('Person, item or action'), { target: { value: 'harvest' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => {
      expect(h.adminGet).toHaveBeenCalledWith(expect.stringContaining('q=harvest'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(h.adminDownloadCsv).toHaveBeenCalled());
    const [path, filename] = h.adminDownloadCsv.mock.calls[0] as [string, string];
    expect(path).toContain('/api/v1/admin/security/events.csv');
    expect(path).toContain('category=auth');
    expect(path).toContain('q=harvest');
    expect(filename).toBe('security-activity.csv');
  });
});
