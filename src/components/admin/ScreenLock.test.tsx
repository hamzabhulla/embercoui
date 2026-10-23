/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

// Phase D — the monitoring screen lock, rendered. Auth, the /me
// permission seam, the admin API, the sign-in service and the
// Supabase MFA API are stubbed at their module seams; the lock
// context, the locked view and the real orders board run for real.
// Pinned here: the 15-minute idle lock and what resets it, manual
// lock, sessionStorage persistence + sign-out clearing, the locked
// board (live fetch, PII masked, no write controls), the password
// step-up (wrong password stays locked), and the TOTP step required
// exactly when the account holds a verified factor.

const h = vi.hoisted(() => ({
  auth: { current: null as unknown },
  perms: { current: null as unknown },
  adminGet: vi.fn(),
  adminSend: vi.fn(),
  signIn: vi.fn(),
  reportEvent: vi.fn(async () => {}),
  mfa: { listFactors: vi.fn(), challenge: vi.fn(), verify: vi.fn() },
}));

vi.mock('../../context/AuthContext', () => ({ useAuth: () => h.auth.current }));
vi.mock('./PermissionsContext', () => ({
  PermissionsProvider: ({ children }: { children: ReactNode }) => children,
  usePermissions: () => h.perms.current,
  SectionGate: ({ children }: { children: ReactNode }) => children,
  AccessRestricted: () => null,
}));
vi.mock('../../services/adminApi', () => ({ adminGet: h.adminGet, adminSend: h.adminSend }));
vi.mock('../../services/auth', () => ({ signInWithEmail: h.signIn, isSupabaseConfigured: true }));
vi.mock('../../services/sessionEvents', () => ({
  reportAdminSessionEvent: h.reportEvent,
  reportAdminLoginFailed: vi.fn(async () => {}),
}));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { mfa: h.mfa } }, isSupabaseConfigured: true }));

import AdminLayout, { AdminGuard } from './AdminLayout';
import AdminOrders from '../../pages/admin/AdminOrders';
import { IDLE_LIMIT_MS, LockProvider, useLock } from './LockContext';

const LOCK_KEY = 'ember-admin-screen-lock';
// The persisted record names the account that set the lock; a cold
// mount honours it only for that account (Phase D audit M1).
const lockRecord = (userId: string) => JSON.stringify({ userId });
const USER = { id: 'admin-1', email: 'owner@example.com' };

function authState(over: Record<string, unknown> = {}) {
  return {
    user: null, profile: null, loading: false, profileLoading: false,
    profileError: null, canAccessAdmin: false,
    signOut: vi.fn(async () => {}), refreshProfile: vi.fn(async () => {}),
    ...over,
  };
}
const profileFor = (role: string) => ({
  id: 'admin-1', email: 'owner@example.com', role, fullName: 'Owner',
  phone: null, addresses: [], favorites: [], createdAt: '2026-01-01T00:00:00.000Z',
});

const SECTIONS = ['dashboard', 'orders', 'reservations', 'menu', 'customers', 'reviews', 'newsletter', 'coupons', 'finance', 'staff', 'settings', 'security'];
const RANK: Record<string, number> = { none: 0, view: 1, manage: 2 };
function permsWith(map: Record<string, string>) {
  return {
    me: { id: 'admin-1', email: 'owner@example.com', role: 'admin', permissions: map, mfa: { required: false, satisfied: true } },
    loading: false,
    error: '',
    can: (section: string, level: string) => (RANK[map[section] ?? 'none'] ?? 0) >= (RANK[level] ?? 0),
    refresh: vi.fn(),
  };
}
const FULL = Object.fromEntries(SECTIONS.map((s) => [s, 'manage']));

const ORDER = {
  id: 'order-12345678', customerName: 'Ayesha Khan', customerEmail: 'ayesha@example.com',
  customerPhone: '+92 300 1234534', status: 'pending', paymentStatus: 'unpaid',
  subtotal: 4200, discount: 0, deliveryFee: 0, total: 4200, currency: 'PKR',
  items: [{ name: 'Ember Classic', quantity: 2, unitPrice: 2100 }],
  createdAt: '2026-10-22T10:00:00.000Z',
};

function renderShell(initial = '/admin/orders') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/admin/login" element={<div>Admin login page</div>} />
        <Route path="/admin" element={<AdminGuard><AdminLayout /></AdminGuard>}>
          <Route index element={<div>Dashboard page</div>} />
          <Route path="orders" element={<AdminOrders />} />
          <Route path="settings" element={<div>Settings page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function Probe() {
  const { locked, lock, unlock } = useLock();
  return (
    <div>
      <span>{locked ? 'LOCKED' : 'OPEN'}</span>
      <button onClick={lock}>lock now</button>
      <button onClick={unlock}>unlock now</button>
      <Link to="/other">go elsewhere</Link>
    </div>
  );
}
function renderProbe() {
  return render(
    <MemoryRouter initialEntries={['/here']}>
      <Routes>
        <Route path="*" element={<LockProvider><Probe /></LockProvider>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  h.auth.current = authState({ user: USER, profile: profileFor('admin'), canAccessAdmin: true });
  h.perms.current = permsWith(FULL);
  h.adminGet.mockImplementation(async (url: string) => {
    if (url.includes('/admin/orders')) return { orders: [ORDER], total: 1 };
    throw new Error(`unexpected adminGet ${url}`);
  });
  h.adminSend.mockResolvedValue({});
  h.signIn.mockResolvedValue({ error: null });
  h.mfa.listFactors.mockResolvedValue({ data: { all: [] }, error: null });
  h.mfa.challenge.mockResolvedValue({ data: { id: 'ch-1' }, error: null });
  h.mfa.verify.mockResolvedValue({ data: {}, error: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('idle lock (LockProvider)', () => {
  it('locks after 15 minutes idle — and persists the flag', () => {
    vi.useFakeTimers();
    renderProbe();
    expect(screen.getByText('OPEN')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(IDLE_LIMIT_MS - 1000); });
    expect(screen.getByText('OPEN')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('LOCKED')).toBeTruthy();
    expect(sessionStorage.getItem(LOCK_KEY)).toBe(lockRecord(USER.id));
  });

  it('the idle limit is literally 15 minutes', () => {
    // A literal pin, not the symbolic constant: quietly shortening
    // the idle limit (15 min -> 5 min) must turn this red.
    expect(IDLE_LIMIT_MS).toBe(15 * 60 * 1000);
  });

  it('pointer and keyboard activity push the deadline out', () => {
    vi.useFakeTimers();
    renderProbe();
    act(() => { vi.advanceTimersByTime(IDLE_LIMIT_MS - 60_000); });
    act(() => { window.dispatchEvent(new Event('pointerdown')); });
    act(() => { vi.advanceTimersByTime(IDLE_LIMIT_MS - 60_000); });
    expect(screen.getByText('OPEN')).toBeTruthy();
    act(() => { window.dispatchEvent(new Event('keydown')); });
    act(() => { vi.advanceTimersByTime(IDLE_LIMIT_MS - 60_000); });
    expect(screen.getByText('OPEN')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText('LOCKED')).toBeTruthy();
  });

  it('in-app navigation counts as activity', () => {
    vi.useFakeTimers();
    renderProbe();
    act(() => { vi.advanceTimersByTime(IDLE_LIMIT_MS - 60_000); });
    fireEvent.click(screen.getByText('go elsewhere'));
    act(() => { vi.advanceTimersByTime(IDLE_LIMIT_MS - 60_000); });
    expect(screen.getByText('OPEN')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.getByText('LOCKED')).toBeTruthy();
  });

  it('activity while locked does not unlock or reset anything', () => {
    vi.useFakeTimers();
    renderProbe();
    fireEvent.click(screen.getByText('lock now'));
    expect(screen.getByText('LOCKED')).toBeTruthy();
    act(() => { window.dispatchEvent(new Event('pointerdown')); });
    act(() => { window.dispatchEvent(new Event('keydown')); });
    act(() => { vi.advanceTimersByTime(IDLE_LIMIT_MS * 2); });
    expect(screen.getByText('LOCKED')).toBeTruthy();
  });

  it('manual lock persists across a remount; unlock clears it for good', () => {
    const first = renderProbe();
    fireEvent.click(screen.getByText('lock now'));
    expect(screen.getByText('LOCKED')).toBeTruthy();
    first.unmount();
    const second = renderProbe();
    expect(screen.getByText('LOCKED')).toBeTruthy();
    fireEvent.click(screen.getByText('unlock now'));
    expect(screen.getByText('OPEN')).toBeTruthy();
    expect(sessionStorage.getItem(LOCK_KEY)).toBeNull();
    second.unmount();
    renderProbe();
    expect(screen.getByText('OPEN')).toBeTruthy();
  });

  it('a different account on the same tab does not inherit the lock', () => {
    sessionStorage.setItem(LOCK_KEY, lockRecord(USER.id));
    const view = renderProbe();
    expect(screen.getByText('LOCKED')).toBeTruthy();
    h.auth.current = authState({
      user: { id: 'staff-2', email: 'staff@example.com' },
      profile: { ...profileFor('staff'), id: 'staff-2', email: 'staff@example.com' },
      canAccessAdmin: true,
    });
    view.rerender(
      <MemoryRouter initialEntries={['/here']}>
        <Routes>
          <Route path="*" element={<LockProvider><Probe /></LockProvider>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText('OPEN')).toBeTruthy();
    expect(sessionStorage.getItem(LOCK_KEY)).toBeNull();
  });
});

describe('cold-mount restore (persisted lock ownership)', () => {
  it("a persisted lock owned by a DIFFERENT account is not honoured — the provider mounts open and clears it", () => {
    // The overnight case: the board was left locked, the session
    // expired without any in-app sign-out, and a colleague signs in
    // on the same tab. Their cold mount must not inherit the lock.
    sessionStorage.setItem(LOCK_KEY, lockRecord('night-owner-9'));
    h.auth.current = authState({
      user: { id: 'morning-staff-2', email: 'morning@example.com' },
      profile: { ...profileFor('staff'), id: 'morning-staff-2', email: 'morning@example.com' },
      canAccessAdmin: true,
    });
    renderProbe();
    expect(screen.getByText('OPEN')).toBeTruthy();
    expect(sessionStorage.getItem(LOCK_KEY)).toBeNull();
  });

  it('a persisted lock owned by the SAME account is honoured — the provider mounts locked', () => {
    sessionStorage.setItem(LOCK_KEY, lockRecord(USER.id));
    renderProbe();
    expect(screen.getByText('LOCKED')).toBeTruthy();
    expect(sessionStorage.getItem(LOCK_KEY)).toBe(lockRecord(USER.id));
  });
});

describe('locked shell', () => {
  it('manual Lock screen swaps the shell for the locked view — board live, PII masked, no write controls', async () => {
    renderShell('/admin/orders');
    expect(await screen.findByText('Ayesha Khan')).toBeTruthy();
    expect(screen.getByText(/ayesha@example\.com/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'confirmed' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Lock screen' }));

    expect(await screen.findByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    // The sidebar and its nav are gone entirely.
    expect(screen.queryByText('Admin Console')).toBeNull();
    expect(screen.queryByText('Reservations')).toBeNull();
    // The board kept working: it fetched again for the locked view
    // and renders the order with name, items and total visible…
    await waitFor(() => {
      expect(h.adminGet.mock.calls.filter((c) => String(c[0]).includes('/admin/orders')).length).toBeGreaterThan(1);
    });
    expect(screen.getByText('Ayesha Khan')).toBeTruthy();
    expect(screen.getByText(/Ember Classic/)).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
    // …while email and phone are masked…
    expect(screen.queryByText(/ayesha@example\.com/)).toBeNull();
    expect(screen.getByText(/••••••••/)).toBeTruthy();
    expect(screen.queryByText(/\+92 300 1234534/)).toBeNull();
    expect(screen.getByText(/••• ••• ••34/)).toBeTruthy();
    // …and every status-change control is gone.
    expect(screen.queryByRole('button', { name: 'confirmed' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'cancelled' })).toBeNull();
  });

  it('a direct URL to another section renders the locked view instead', async () => {
    sessionStorage.setItem(LOCK_KEY, lockRecord(USER.id));
    renderShell('/admin/settings');
    expect(await screen.findByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    expect(screen.queryByText('Settings page')).toBeNull();
    expect(screen.queryByText('Admin Console')).toBeNull();
    // The board is still the board — masked.
    expect(await screen.findByText('Ayesha Khan')).toBeTruthy();
    expect(screen.queryByText(/ayesha@example\.com/)).toBeNull();
  });

  it('signing out from the unlock panel clears the persisted lock', async () => {
    const signOut = vi.fn(async () => {});
    h.auth.current = authState({ user: USER, profile: profileFor('admin'), canAccessAdmin: true, signOut });
    sessionStorage.setItem(LOCK_KEY, lockRecord(USER.id));
    renderShell('/admin/orders');
    expect(await screen.findByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(sessionStorage.getItem(LOCK_KEY)).toBeNull();
  });

  it('without orders:view the locked shell shows the unlock panel and the honest note — and the board never fetches', async () => {
    h.perms.current = permsWith({ ...FULL, orders: 'none' });
    sessionStorage.setItem(LOCK_KEY, lockRecord(USER.id));
    renderShell('/admin/orders');
    expect(await screen.findByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    // The unlock panel is fully there…
    expect(screen.getByLabelText('Your password')).toBeTruthy();
    // …next to the honest note in place of the board…
    expect(screen.getByText(/The live orders board is not part of your account's access/)).toBeTruthy();
    // …and the board itself neither fetched nor rendered.
    expect(h.adminGet.mock.calls.filter((c) => String(c[0]).includes('/admin/orders'))).toHaveLength(0);
    expect(screen.queryByText('Ayesha Khan')).toBeNull();
  });
});

describe('step-up unlock', () => {
  beforeEach(() => {
    sessionStorage.setItem(LOCK_KEY, lockRecord(USER.id));
  });

  it('a wrong password keeps the lock and shows the sign-in error', async () => {
    h.signIn.mockResolvedValue({ error: 'Invalid email or password' });
    renderShell('/admin/orders');
    expect(await screen.findByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'wrong-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Invalid email or password');
    expect(screen.getByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    expect(sessionStorage.getItem(LOCK_KEY)).toBe(lockRecord(USER.id));
  });

  it('the correct password unlocks when the account holds no TOTP factor', async () => {
    renderShell('/admin/orders');
    expect(await screen.findByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    // The shell is back — sidebar and the unmasked board.
    expect(await screen.findByText('Admin Console')).toBeTruthy();
    expect(await screen.findByText(/ayesha@example\.com/)).toBeTruthy();
    expect(h.signIn).toHaveBeenCalledWith('owner@example.com', 'correct-password');
    expect(sessionStorage.getItem(LOCK_KEY)).toBeNull();
    // No factor, no MFA step — and no session event was invented.
    expect(h.mfa.challenge).not.toHaveBeenCalled();
    expect(h.reportEvent).not.toHaveBeenCalled();
  });

  it('a verified TOTP factor adds a code step — a wrong code stays locked, the right one unlocks', async () => {
    h.mfa.listFactors.mockResolvedValue({
      data: { all: [{ id: 'fac-1', factor_type: 'totp', status: 'verified' }] },
      error: null,
    });
    h.mfa.verify
      .mockResolvedValueOnce({ data: null, error: { message: 'Invalid TOTP code entered' } })
      .mockResolvedValue({ data: {}, error: null });
    renderShell('/admin/orders');
    expect(await screen.findByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));

    const codeInput = await screen.findByLabelText('6-digit code');
    expect(screen.getByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    fireEvent.change(codeInput, { target: { value: '000000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and unlock' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    expect(sessionStorage.getItem(LOCK_KEY)).toBe(lockRecord(USER.id));

    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and unlock' }));
    expect(await screen.findByText('Admin Console')).toBeTruthy();
    expect(sessionStorage.getItem(LOCK_KEY)).toBeNull();
    // The genuine MFA verification is the one event reported.
    expect(h.reportEvent).toHaveBeenCalledWith('mfa_verified');
  });

  it('an UNVERIFIED factor alone does not add a code step', async () => {
    h.mfa.listFactors.mockResolvedValue({
      data: { all: [{ id: 'fac-2', factor_type: 'totp', status: 'unverified' }] },
      error: null,
    });
    renderShell('/admin/orders');
    expect(await screen.findByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('Admin Console')).toBeTruthy();
    expect(screen.queryByLabelText('6-digit code')).toBeNull();
  });
});
