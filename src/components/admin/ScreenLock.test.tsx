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
  googleSignIn: vi.fn(),
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
vi.mock('../../services/auth', () => ({
  signInWithEmail: h.signIn,
  signInWithGoogle: h.googleSignIn,
  isSupabaseConfigured: true,
}));
vi.mock('../../services/sessionEvents', () => ({
  reportAdminSessionEvent: h.reportEvent,
  reportAdminLoginFailed: vi.fn(async () => {}),
}));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { mfa: h.mfa } }, isSupabaseConfigured: true }));

import AdminLayout, { AdminGuard } from './AdminLayout';
import AdminOrders from '../../pages/admin/AdminOrders';
import { IDLE_LIMIT_MS, LockProvider, useLock } from './LockContext';
import UnlockReturnCourier from './UnlockReturnCourier';
import {
  UNLOCK_INTENT_KEY,
  UNLOCK_INTENT_TTL_MS,
  consumeUnlockIntent,
  peekUnlockIntent,
  persistUnlockIntent,
  readUnlockIntent,
  sanitizeUnlockReturnPath,
} from '../../lib/screenLock';

const LOCK_KEY = 'ember-admin-screen-lock';
// The persisted record names the account that set the lock; a cold
// mount honours it only for that account (Phase D audit M1).
const lockRecord = (userId: string) => JSON.stringify({ userId });
const USER = { id: 'admin-1', email: 'owner@example.com' };
// A Google-only account (the owner's shape): the session user
// carries a Google identity and NO email/password provider — the
// account has no password to re-enter. `lastSignInAt` is when the
// session in hand was signed in; a completed unlock round-trip is
// recognised by it postdating the planted intent.
const googleUser = (lastSignInAt: string) => ({
  id: 'admin-1',
  email: 'owner@example.com',
  app_metadata: { provider: 'google', providers: ['google'] },
  identities: [{ provider: 'google' }],
  last_sign_in_at: lastSignInAt,
});
const intentRecord = (userId: string, at: number) => JSON.stringify({ userId, at });
const intentRecordAt = (userId: string, at: number, returnPath: string) => JSON.stringify({ userId, at, returnPath });

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
  h.googleSignIn.mockResolvedValue({ error: null });
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
    // and renders the order with items and total visible…
    await waitFor(() => {
      expect(h.adminGet.mock.calls.filter((c) => String(c[0]).includes('/admin/orders')).length).toBeGreaterThan(1);
    });
    expect(screen.getByText(/Ember Classic/)).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
    // …while the customer name is reduced to first name + surname
    // initial — the full name, and the surname in particular,
    // appears NOWHERE in the rendered board…
    expect(screen.getByText('Ayesha K.')).toBeTruthy();
    expect(screen.queryByText('Ayesha Khan')).toBeNull();
    expect(document.body.textContent).not.toContain('Khan');
    // …and email and phone are masked…
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
    // The board is still the board — masked, name included.
    expect(await screen.findByText('Ayesha K.')).toBeTruthy();
    expect(screen.queryByText('Ayesha Khan')).toBeNull();
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
    // The shell is back — sidebar and the unmasked board, the full
    // customer name rendering exactly as it does unlocked.
    expect(await screen.findByText('Admin Console')).toBeTruthy();
    expect(await screen.findByText('Ayesha Khan')).toBeTruthy();
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

describe('unlock intent (lib/screenLock)', () => {
  const NOW = 1_700_000_000_000;

  it('the freshness window is literally 5 minutes', () => {
    expect(UNLOCK_INTENT_TTL_MS).toBe(5 * 60 * 1000);
  });

  it('persist + read round-trips the record — return path included, defaulting to the console root', () => {
    persistUnlockIntent('admin-1', NOW);
    expect(readUnlockIntent()).toEqual({ userId: 'admin-1', at: NOW, returnPath: '/admin' });
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBe(
      JSON.stringify({ userId: 'admin-1', at: NOW, returnPath: '/admin' }),
    );
    persistUnlockIntent('admin-1', NOW, '/admin/orders');
    expect(readUnlockIntent()).toEqual({ userId: 'admin-1', at: NOW, returnPath: '/admin/orders' });
  });

  it('consume returns a fresh intent for its own account — and removes it', () => {
    persistUnlockIntent('admin-1', NOW - 60_000);
    expect(consumeUnlockIntent('admin-1', NOW)).toEqual({ userId: 'admin-1', at: NOW - 60_000, returnPath: '/admin' });
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();
  });

  it('an intent exactly at the TTL boundary still counts', () => {
    persistUnlockIntent('admin-1', NOW - UNLOCK_INTENT_TTL_MS);
    expect(consumeUnlockIntent('admin-1', NOW)).not.toBeNull();
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();
  });

  it('a stale intent proves nothing — and is discarded', () => {
    persistUnlockIntent('admin-1', NOW - UNLOCK_INTENT_TTL_MS - 1);
    expect(consumeUnlockIntent('admin-1', NOW)).toBeNull();
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();
  });

  it("another account's intent proves nothing — and is discarded", () => {
    persistUnlockIntent('someone-else', NOW - 1000);
    expect(consumeUnlockIntent('admin-1', NOW)).toBeNull();
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();
  });

  it('an intent timestamped in the future proves nothing', () => {
    persistUnlockIntent('admin-1', NOW + 60_000);
    expect(consumeUnlockIntent('admin-1', NOW)).toBeNull();
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();
  });

  it('a malformed stored value proves nothing — and is discarded', () => {
    sessionStorage.setItem(UNLOCK_INTENT_KEY, '{"userId":42}');
    expect(readUnlockIntent()).toBeNull();
    expect(consumeUnlockIntent('admin-1', NOW)).toBeNull();
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();
  });
});

describe('unlock return path (lib/screenLock)', () => {
  const NOW = 1_700_000_000_000;

  it('keeps plain admin paths — the console root and its sections', () => {
    expect(sanitizeUnlockReturnPath('/admin')).toBe('/admin');
    expect(sanitizeUnlockReturnPath('/admin/orders')).toBe('/admin/orders');
    expect(sanitizeUnlockReturnPath('/admin/settings')).toBe('/admin/settings');
  });

  it('rejects anything that is not a plain admin path back to the console root', () => {
    // Off-origin shapes — the stored record is never trusted as read.
    expect(sanitizeUnlockReturnPath('https://evil.example')).toBe('/admin');
    expect(sanitizeUnlockReturnPath('//evil.example')).toBe('/admin');
    expect(sanitizeUnlockReturnPath('/\\evil.example')).toBe('/admin');
    // Customer paths are not unlock destinations.
    expect(sanitizeUnlockReturnPath('/menu')).toBe('/admin');
    expect(sanitizeUnlockReturnPath('/')).toBe('/admin');
    // A mere prefix is not the console.
    expect(sanitizeUnlockReturnPath('/administrator')).toBe('/admin');
    // The lock never lives on the sign-in page.
    expect(sanitizeUnlockReturnPath('/admin/login')).toBe('/admin');
    expect(sanitizeUnlockReturnPath('/admin/login/again')).toBe('/admin');
    // Junk.
    expect(sanitizeUnlockReturnPath('')).toBe('/admin');
    expect(sanitizeUnlockReturnPath(undefined)).toBe('/admin');
    expect(sanitizeUnlockReturnPath(null)).toBe('/admin');
    expect(sanitizeUnlockReturnPath(42)).toBe('/admin');
  });

  it('a forged return path stored in the record is sanitised on the way out — and when planted', () => {
    sessionStorage.setItem(UNLOCK_INTENT_KEY, intentRecordAt('admin-1', NOW, '//evil.example'));
    expect(readUnlockIntent()?.returnPath).toBe('/admin');
    persistUnlockIntent('admin-1', NOW, 'https://evil.example/phish');
    expect(readUnlockIntent()?.returnPath).toBe('/admin');
  });

  it('a record with no return path at all (planted before the field existed) resolves to the console root', () => {
    sessionStorage.setItem(UNLOCK_INTENT_KEY, intentRecord('admin-1', NOW));
    expect(readUnlockIntent()).toEqual({ userId: 'admin-1', at: NOW, returnPath: '/admin' });
  });
});

describe('peekUnlockIntent (the courier’s read)', () => {
  const NOW = 1_700_000_000_000;

  it('a fresh intent for the account is returned — and LEFT IN PLACE for the lock provider to consume', () => {
    persistUnlockIntent('admin-1', NOW - 60_000, '/admin/orders');
    expect(peekUnlockIntent('admin-1', NOW)).toEqual({ userId: 'admin-1', at: NOW - 60_000, returnPath: '/admin/orders' });
    // Peeking is not consuming: the proof record survives for
    // LockProvider, and a real consume still works afterwards.
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).not.toBeNull();
    expect(consumeUnlockIntent('admin-1', NOW)).not.toBeNull();
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();
  });

  it('a stale intent is discarded on sight', () => {
    persistUnlockIntent('admin-1', NOW - UNLOCK_INTENT_TTL_MS - 1);
    expect(peekUnlockIntent('admin-1', NOW)).toBeNull();
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();
  });

  it("another account's intent is discarded on sight", () => {
    persistUnlockIntent('someone-else', NOW - 1000);
    expect(peekUnlockIntent('admin-1', NOW)).toBeNull();
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();
  });

  it('a malformed stored value is discarded on sight', () => {
    sessionStorage.setItem(UNLOCK_INTENT_KEY, 'not json at all');
    expect(peekUnlockIntent('admin-1', NOW)).toBeNull();
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();
  });

  it('no intent — nothing to peek, nothing to clear', () => {
    expect(peekUnlockIntent('admin-1', NOW)).toBeNull();
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();
  });
});

describe('Google unlock (OAuth re-auth)', () => {
  beforeEach(() => {
    sessionStorage.setItem(LOCK_KEY, lockRecord(USER.id));
  });

  it('a Google-only account is offered Verify with Google — never a password form it cannot satisfy', async () => {
    h.auth.current = authState({
      user: googleUser(new Date(Date.now() - 3_600_000).toISOString()),
      profile: profileFor('admin'),
      canAccessAdmin: true,
    });
    renderShell('/admin/orders');
    expect(await screen.findByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Verify with Google/ })).toBeTruthy();
    expect(screen.queryByLabelText('Your password')).toBeNull();
    // The board is still live and masked behind the panel.
    expect(await screen.findByText('Ayesha K.')).toBeTruthy();
    expect(screen.queryByText('Ayesha Khan')).toBeNull();
    expect(screen.queryByText(/ayesha@example\.com/)).toBeNull();
  });

  it('clicking Verify with Google plants the account-bound intent and starts OAuth back to the locked path', async () => {
    h.auth.current = authState({
      user: googleUser(new Date(Date.now() - 3_600_000).toISOString()),
      profile: profileFor('admin'),
      canAccessAdmin: true,
    });
    renderShell('/admin/orders');
    expect(await screen.findByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Verify with Google/ }));
    await waitFor(() => expect(h.googleSignIn).toHaveBeenCalledWith('/admin/orders'));
    const planted = JSON.parse(sessionStorage.getItem(UNLOCK_INTENT_KEY) ?? 'null') as { userId?: unknown; at?: unknown; returnPath?: unknown } | null;
    expect(planted?.userId).toBe(USER.id);
    expect(typeof planted?.at).toBe('number');
    expect(Math.abs(Date.now() - (planted?.at as number))).toBeLessThan(5000);
    // The planted intent also carries the page the admin was locked
    // on — the copy of the destination the return courier acts on
    // when the OAuth landing puts the browser somewhere else.
    expect(planted?.returnPath).toBe('/admin/orders');
    // Nothing unlocked by the click itself — the proof is the return.
    expect(screen.getByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    expect(sessionStorage.getItem(LOCK_KEY)).toBe(lockRecord(USER.id));
  });

  it('a completed round-trip unlocks: fresh intent, same account, sign-in after the intent, no factor', async () => {
    const t0 = Date.now();
    sessionStorage.setItem(UNLOCK_INTENT_KEY, intentRecord(USER.id, t0 - 60_000));
    h.auth.current = authState({
      user: googleUser(new Date(t0 - 30_000).toISOString()),
      profile: profileFor('admin'),
      canAccessAdmin: true,
    });
    renderShell('/admin/orders');
    expect(await screen.findByText('Admin Console')).toBeTruthy();
    expect(await screen.findByText(/ayesha@example\.com/)).toBeTruthy();
    expect(sessionStorage.getItem(LOCK_KEY)).toBeNull();
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();
    // No password was involved, and no event was invented for the proof.
    expect(h.signIn).not.toHaveBeenCalled();
    expect(h.reportEvent).not.toHaveBeenCalled();
  });

  it('the TOTP step still gates after a Google re-auth when a verified factor exists', async () => {
    const t0 = Date.now();
    sessionStorage.setItem(UNLOCK_INTENT_KEY, intentRecord(USER.id, t0 - 60_000));
    h.auth.current = authState({
      user: googleUser(new Date(t0 - 30_000).toISOString()),
      profile: profileFor('admin'),
      canAccessAdmin: true,
    });
    h.mfa.listFactors.mockResolvedValue({
      data: { all: [{ id: 'fac-1', factor_type: 'totp', status: 'verified' }] },
      error: null,
    });
    renderShell('/admin/orders');
    const codeInput = await screen.findByLabelText('6-digit code');
    // Still locked, and the code step credits the right proof.
    expect(screen.getByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    expect(screen.queryByText('Admin Console')).toBeNull();
    expect(screen.getByText(/Identity verified\./)).toBeTruthy();
    expect(sessionStorage.getItem(LOCK_KEY)).toBe(lockRecord(USER.id));
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();

    fireEvent.change(codeInput, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and unlock' }));
    expect(await screen.findByText('Admin Console')).toBeTruthy();
    expect(sessionStorage.getItem(LOCK_KEY)).toBeNull();
    expect(h.reportEvent).toHaveBeenCalledWith('mfa_verified');
  });

  it('a stale intent unlocks nothing — and is discarded', async () => {
    const t0 = Date.now();
    sessionStorage.setItem(UNLOCK_INTENT_KEY, intentRecord(USER.id, t0 - 10 * 60_000));
    h.auth.current = authState({
      user: googleUser(new Date(t0 - 60_000).toISOString()),
      profile: profileFor('admin'),
      canAccessAdmin: true,
    });
    renderShell('/admin/orders');
    expect(await screen.findByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();
    expect(sessionStorage.getItem(LOCK_KEY)).toBe(lockRecord(USER.id));
    // The Google path remains on offer for a fresh attempt.
    expect(screen.getByRole('button', { name: /Verify with Google/ })).toBeTruthy();
  });

  it("a different account's intent unlocks nothing — and is discarded", async () => {
    const t0 = Date.now();
    sessionStorage.setItem(UNLOCK_INTENT_KEY, intentRecord('someone-else', t0 - 60_000));
    h.auth.current = authState({
      user: googleUser(new Date(t0 - 30_000).toISOString()),
      profile: profileFor('admin'),
      canAccessAdmin: true,
    });
    renderShell('/admin/orders');
    expect(await screen.findByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();
    expect(sessionStorage.getItem(LOCK_KEY)).toBe(lockRecord(USER.id));
  });

  it('a cancelled round-trip unlocks nothing: the intent is fresh but no new sign-in stands behind it', async () => {
    const t0 = Date.now();
    sessionStorage.setItem(UNLOCK_INTENT_KEY, intentRecord(USER.id, t0 - 60_000));
    h.auth.current = authState({
      // Backing out at Google lands with the OLD session — signed in
      // two hours ago, long before the intent was planted.
      user: googleUser(new Date(t0 - 2 * 3_600_000).toISOString()),
      profile: profileFor('admin'),
      canAccessAdmin: true,
    });
    renderShell('/admin/orders');
    expect(await screen.findByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    expect(screen.queryByText('Admin Console')).toBeNull();
    // Board still masked — no intermediate state unmasked anything.
    expect(await screen.findByText('Ayesha K.')).toBeTruthy();
    expect(screen.queryByText('Ayesha Khan')).toBeNull();
    expect(screen.queryByText(/ayesha@example\.com/)).toBeNull();
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();
    expect(sessionStorage.getItem(LOCK_KEY)).toBe(lockRecord(USER.id));
  });

  it('an intent found with no session is discarded and locks nothing', () => {
    sessionStorage.setItem(UNLOCK_INTENT_KEY, intentRecord(USER.id, Date.now() - 1000));
    h.auth.current = authState({ user: null, profile: null });
    renderProbe();
    expect(screen.getByText('OPEN')).toBeTruthy();
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();
  });

  it('a consumed intent cannot replay: a later manual lock demands proof again', async () => {
    const t0 = Date.now();
    sessionStorage.setItem(UNLOCK_INTENT_KEY, intentRecord(USER.id, t0 - 60_000));
    h.auth.current = authState({
      user: googleUser(new Date(t0 - 30_000).toISOString()),
      profile: profileFor('admin'),
      canAccessAdmin: true,
    });
    renderShell('/admin/orders');
    expect(await screen.findByText('Admin Console')).toBeTruthy();
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Lock screen' }));
    expect(await screen.findByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    // No new round-trip happened, so nothing re-opens the screen.
    expect(screen.queryByText('Admin Console')).toBeNull();
    expect(screen.getByRole('button', { name: /Verify with Google/ })).toBeTruthy();
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();
  });

  it('an OAuth start failure speaks in the panel voice, keeps the lock, and leaves no intent behind', async () => {
    h.googleSignIn.mockResolvedValue({ error: "Google sign-in isn't available yet — please use email and password for now." });
    h.auth.current = authState({
      user: googleUser(new Date(Date.now() - 3_600_000).toISOString()),
      profile: profileFor('admin'),
      canAccessAdmin: true,
    });
    renderShell('/admin/orders');
    expect(await screen.findByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Verify with Google/ }));
    const alert = await screen.findByRole('alert');
    // The panel's own sentence — not the provider's email-and-
    // password advice, which this account could never act on.
    expect(alert.textContent).toContain("Google verification isn't available right now");
    expect(alert.textContent).toContain('sign out below and sign back in');
    expect(alert.textContent).not.toContain('email and password');
    expect(screen.getByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();
    expect(sessionStorage.getItem(LOCK_KEY)).toBe(lockRecord(USER.id));
  });

  it('an account with both password and Google keeps its password path — and gains the Google alternative', async () => {
    h.auth.current = authState({
      user: {
        id: 'admin-1',
        email: 'owner@example.com',
        app_metadata: { provider: 'email', providers: ['email', 'google'] },
        identities: [{ provider: 'email' }, { provider: 'google' }],
      },
      profile: profileFor('admin'),
      canAccessAdmin: true,
    });
    renderShell('/admin/orders');
    expect(await screen.findByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    expect(screen.getByLabelText('Your password')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Verify with Google/ })).toBeTruthy();
    // The password path itself is untouched.
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'correct-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByText('Admin Console')).toBeTruthy();
    expect(h.signIn).toHaveBeenCalledWith('owner@example.com', 'correct-password');
    expect(sessionStorage.getItem(LOCK_KEY)).toBeNull();
  });
});


describe('OAuth return courier — the round-trip that lands on the customer site', () => {
  // The app root as App renders it: the courier inside the router,
  // the customer home at '/', and the admin shell under '/admin'.
  function renderSite(initial = '/') {
    return render(
      <MemoryRouter initialEntries={[initial]}>
        <UnlockReturnCourier />
        <Routes>
          <Route path="/" element={<div>Customer home</div>} />
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

  function asGoogleAdmin(lastSignInAt: string) {
    h.auth.current = authState({
      user: googleUser(lastSignInAt),
      profile: profileFor('admin'),
      canAccessAdmin: true,
    });
  }

  it('carries a completed round-trip back to the locked admin page — and unlocks there', async () => {
    // The state the owner actually came home to: browser on the
    // customer home, lock persisted, fresh intent planted 60s ago
    // naming /admin/orders, session signed in 30s ago (after the
    // plant — a completed round-trip).
    sessionStorage.setItem(LOCK_KEY, lockRecord(USER.id));
    const t = Date.now();
    sessionStorage.setItem(UNLOCK_INTENT_KEY, intentRecordAt(USER.id, t - 60_000, '/admin/orders'));
    asGoogleAdmin(new Date(t - 30_000).toISOString());

    renderSite('/');
    // The courier navigated, the lock provider consumed the intent
    // on the admin mount, the proof checked out, and the panel's
    // pipeline finished: the console is open ON the orders page.
    expect(await screen.findByText('Admin Console')).toBeTruthy();
    expect(screen.queryByText('Customer home')).toBeNull();
    expect(await screen.findByText(/ayesha@example\.com/)).toBeTruthy(); // unmasked board = unlocked shell
    expect(sessionStorage.getItem(LOCK_KEY)).toBeNull();
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull();
    // As on the direct landing: no factor, no event invented for the proof.
    expect(h.reportEvent).not.toHaveBeenCalled();
  });

  it('the TOTP step still gates — in place, on the admin page the courier returned to', async () => {
    sessionStorage.setItem(LOCK_KEY, lockRecord(USER.id));
    const t = Date.now();
    sessionStorage.setItem(UNLOCK_INTENT_KEY, intentRecordAt(USER.id, t - 60_000, '/admin/orders'));
    asGoogleAdmin(new Date(t - 30_000).toISOString());
    h.mfa.listFactors.mockResolvedValue({
      data: { all: [{ id: 'fac-1', factor_type: 'totp', status: 'verified' }] },
      error: null,
    });

    renderSite('/');
    // Carried back to the admin page, identity proven — and still
    // locked behind the code step, on that page. (The longer wait:
    // the chain here is navigation → guard → layout → provider →
    // panel pipeline, more hops than a direct admin landing.)
    expect(await screen.findByText(/Identity verified\./, {}, { timeout: 3000 })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Screen locked' })).toBeTruthy();
    expect(screen.queryByText('Customer home')).toBeNull();
    // The board behind the panel stays masked while the step gates.
    expect(screen.getByText('Ayesha K.')).toBeTruthy();
    expect(screen.queryByText('Ayesha Khan')).toBeNull();
    expect(screen.queryByText(/ayesha@example\.com/)).toBeNull();

    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and unlock' }));
    expect(await screen.findByText('Admin Console')).toBeTruthy();
    expect(sessionStorage.getItem(LOCK_KEY)).toBeNull();
  });

  it('an intent with no return path (planted by the previous build) returns to the console root', async () => {
    sessionStorage.setItem(LOCK_KEY, lockRecord(USER.id));
    const t = Date.now();
    sessionStorage.setItem(UNLOCK_INTENT_KEY, intentRecord(USER.id, t - 60_000));
    asGoogleAdmin(new Date(t - 30_000).toISOString());

    renderSite('/');
    expect(await screen.findByText('Dashboard page')).toBeTruthy();
    expect(screen.queryByText('Customer home')).toBeNull();
  });

  it('a forged return path in the stored intent can only ever land on the console root', async () => {
    sessionStorage.setItem(LOCK_KEY, lockRecord(USER.id));
    const t = Date.now();
    sessionStorage.setItem(UNLOCK_INTENT_KEY, intentRecordAt(USER.id, t - 60_000, '//evil.example/phish'));
    asGoogleAdmin(new Date(t - 30_000).toISOString());

    renderSite('/');
    expect(await screen.findByText('Dashboard page')).toBeTruthy();
    expect(screen.queryByText('Customer home')).toBeNull();
  });

  it('a slow round-trip (>5 min on the chooser): the stale intent is discarded, no navigation — and the lock honestly remains for the next /admin visit', async () => {
    sessionStorage.setItem(LOCK_KEY, lockRecord(USER.id));
    const t = Date.now();
    sessionStorage.setItem(
      UNLOCK_INTENT_KEY,
      intentRecordAt(USER.id, t - UNLOCK_INTENT_TTL_MS - 60_000, '/admin/orders'),
    );
    asGoogleAdmin(new Date(t - 30_000).toISOString());

    renderSite('/');
    await waitFor(() => expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull());
    expect(screen.getByText('Customer home')).toBeTruthy();
    expect(screen.queryByText('Admin Console')).toBeNull();
    // Nothing was unlocked or forgiven: the persisted lock is
    // exactly as it was, so opening /admin shows the locked board
    // with the panel offering Verify with Google again.
    expect(sessionStorage.getItem(LOCK_KEY)).toBe(lockRecord(USER.id));
  });

  it("another account's intent on the landing is discarded, not acted on", async () => {
    sessionStorage.setItem(LOCK_KEY, lockRecord(USER.id));
    const t = Date.now();
    sessionStorage.setItem(UNLOCK_INTENT_KEY, intentRecordAt('someone-else', t - 60_000, '/admin/orders'));
    asGoogleAdmin(new Date(t - 30_000).toISOString());

    renderSite('/');
    await waitFor(() => expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).toBeNull());
    expect(screen.getByText('Customer home')).toBeTruthy();
    expect(screen.queryByText('Admin Console')).toBeNull();
  });

  it('an ordinary signed-in visit to the site navigates nowhere', async () => {
    asGoogleAdmin(new Date().toISOString());
    renderSite('/');
    expect(await screen.findByText('Customer home')).toBeTruthy();
    expect(screen.queryByText('Admin Console')).toBeNull();
  });

  it('the courier never consumes the intent itself — without a lock provider at the destination, the record is still there', async () => {
    // Rendered against a bare route (no AdminLayout, so no
    // LockProvider): the courier must still navigate — and must
    // leave the intent in place, because consuming it is the lock
    // provider's proof, not the courier's.
    const t = Date.now();
    sessionStorage.setItem(UNLOCK_INTENT_KEY, intentRecordAt(USER.id, t - 60_000, '/admin/orders'));
    asGoogleAdmin(new Date(t - 30_000).toISOString());
    render(
      <MemoryRouter initialEntries={['/']}>
        <UnlockReturnCourier />
        <Routes>
          <Route path="/" element={<div>Customer home</div>} />
          <Route path="/admin/orders" element={<div>Bare admin page</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Bare admin page')).toBeTruthy();
    expect(sessionStorage.getItem(UNLOCK_INTENT_KEY)).not.toBeNull();
    expect(readUnlockIntent()?.returnPath).toBe('/admin/orders');
  });
});
