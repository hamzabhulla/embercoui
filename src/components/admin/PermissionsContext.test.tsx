/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// AF-M1 — the admin shell's /me copy must stay truthful in-session.
// The provider mounts once for the whole /admin subtree and SPA
// navigation never remounts it, so without a background refetch an
// owner's permission change never reached an already-open session:
// a revocation left the old sections and write controls on screen
// (the server still 403'd the writes), and a grant stayed invisible
// until a hard reload. Pinned here, at the adminApi seam with the
// REAL provider: window focus and a 60-second interval re-fetch
// silently, the fresh /me record replaces the old one in place,
// failures keep the last known map with no error shown, and fetches
// never overlap.

const h = vi.hoisted(() => ({ adminGet: vi.fn() }));

vi.mock('../../services/adminApi', () => ({ adminGet: h.adminGet }));

import {
  PERMISSIONS_REFETCH_INTERVAL_MS,
  PermissionsProvider,
  usePermissions,
  type AdminMe,
} from './PermissionsContext';
import type { PermissionMap, PermissionLevel, SectionKey } from '../../lib/permissions';

const SECTIONS: SectionKey[] = [
  'dashboard', 'orders', 'reservations', 'menu', 'customers', 'reviews',
  'newsletter', 'coupons', 'finance', 'staff', 'settings', 'security',
];

function meWith(orders: PermissionLevel, over: Partial<AdminMe> = {}): AdminMe {
  const permissions = Object.fromEntries(SECTIONS.map((s) => [s, 'none'])) as PermissionMap;
  permissions.orders = orders;
  return {
    id: 'staff-1', email: 'staff@example.com', role: 'staff', permissions,
    mfa: { required: false, satisfied: true },
    ...over,
  };
}

function Probe() {
  const { me, loading, error, can } = usePermissions();
  return (
    <div>
      <span data-testid="state">{loading ? 'loading' : 'ready'}</span>
      <span data-testid="error">{error || 'no-error'}</span>
      <span data-testid="email">{me?.email ?? 'no-me'}</span>
      <span data-testid="orders-level">{me ? me.permissions.orders : 'no-me'}</span>
      <span data-testid="orders-can">
        {!me ? 'no-me' : can('orders', 'manage') ? 'manage' : can('orders', 'view') ? 'view' : 'none'}
      </span>
      <span data-testid="menu-can">{me && can('menu', 'view') ? 'yes' : 'no'}</span>
      <span data-testid="mfa">{me ? `${me.mfa.required}:${me.mfa.satisfied}` : 'no-me'}</span>
    </div>
  );
}

function renderProvider() {
  return render(
    <PermissionsProvider>
      <Probe />
    </PermissionsProvider>,
  );
}

const meCalls = () => h.adminGet.mock.calls.filter((c) => c[0] === '/api/v1/admin/me').length;
const text = (id: string) => screen.getByTestId(id).textContent;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let current: AdminMe;

beforeEach(() => {
  vi.clearAllMocks();
  current = meWith('view');
  h.adminGet.mockImplementation(async () => current);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
});

describe('initial load (unchanged semantics)', () => {
  it('blocks until /me resolves, then can() answers from the map', async () => {
    const gate = deferred<AdminMe>();
    h.adminGet.mockImplementation(() => gate.promise);
    renderProvider();
    expect(text('state')).toBe('loading');
    expect(text('orders-can')).toBe('no-me');

    gate.resolve(meWith('manage'));
    await waitFor(() => expect(text('state')).toBe('ready'));
    expect(text('orders-can')).toBe('manage');
    expect(text('error')).toBe('no-error');
    expect(meCalls()).toBe(1);
  });

  it('an initial failure surfaces the error and no map', async () => {
    h.adminGet.mockRejectedValue(new Error('Session expired'));
    renderProvider();
    await waitFor(() => expect(text('error')).toBe('Session expired'));
    expect(text('state')).toBe('ready');
    expect(text('orders-can')).toBe('no-me');
  });
});

describe('background refetch on window focus (AF-M1)', () => {
  it('(a) a revocation applies in-session: orders view -> none on focus, no remount, no loading flip', async () => {
    renderProvider();
    await waitFor(() => expect(text('orders-can')).toBe('view'));
    expect(meCalls()).toBe(1);

    current = meWith('none');
    act(() => { window.dispatchEvent(new Event('focus')); });
    // The fetch is in flight but the shell is NOT re-gated: the old
    // (still last-known) map keeps rendering, loading never flips.
    expect(text('state')).toBe('ready');
    expect(text('orders-can')).toBe('view');

    await waitFor(() => expect(text('orders-can')).toBe('none'));
    expect(text('orders-level')).toBe('none');
    expect(text('state')).toBe('ready');
    expect(meCalls()).toBe(2);
  });

  it('(c) a grant appears in-session the same way — and the whole /me record is replaced', async () => {
    renderProvider();
    await waitFor(() => expect(text('orders-can')).toBe('view'));
    expect(text('menu-can')).toBe('no');

    const granted = meWith('manage');
    granted.permissions.menu = 'view';
    granted.email = 'promoted@example.com';
    granted.mfa = { required: true, satisfied: true };
    current = granted;
    act(() => { window.dispatchEvent(new Event('focus')); });

    await waitFor(() => expect(text('orders-can')).toBe('manage'));
    // Not just the permission map: every /me-derived field the
    // provider owns (identity, MFA state) follows the fresh record.
    expect(text('menu-can')).toBe('yes');
    expect(text('email')).toBe('promoted@example.com');
    expect(text('mfa')).toBe('true:true');
    expect(meCalls()).toBe(2);
  });

  it('(d) a failed background refetch keeps the last known map and shows no error', async () => {
    renderProvider();
    await waitFor(() => expect(text('orders-can')).toBe('view'));

    h.adminGet.mockRejectedValueOnce(new Error('network blip'));
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(meCalls()).toBe(2));
    // Let the rejection settle through the provider.
    await act(async () => { await Promise.resolve(); });

    expect(text('orders-can')).toBe('view');
    expect(text('orders-level')).toBe('view');
    expect(text('error')).toBe('no-error');
    expect(text('state')).toBe('ready');
  });

  it('(e) storm control: repeated focus events during an in-flight fetch produce exactly one request', async () => {
    renderProvider();
    await waitFor(() => expect(text('orders-can')).toBe('view'));
    expect(meCalls()).toBe(1);

    const gate = deferred<AdminMe>();
    h.adminGet.mockImplementationOnce(() => gate.promise);
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(meCalls()).toBe(2);
    act(() => { window.dispatchEvent(new Event('focus')); });
    act(() => { window.dispatchEvent(new Event('focus')); });
    act(() => { window.dispatchEvent(new Event('focus')); });
    expect(meCalls()).toBe(2);

    gate.resolve(meWith('none'));
    await waitFor(() => expect(text('orders-can')).toBe('none'));
    // The dropped triggers were dropped, not queued for later.
    expect(meCalls()).toBe(2);
  });
});

describe('background refetch on the interval (AF-M1)', () => {
  it('the interval is literally 60 seconds', () => {
    expect(PERMISSIONS_REFETCH_INTERVAL_MS).toBe(60 * 1000);
  });

  it('(b) advancing the timers by the interval refetches and the new map applies', async () => {
    vi.useFakeTimers();
    renderProvider();
    await act(async () => { await Promise.resolve(); });
    expect(text('orders-can')).toBe('view');
    expect(meCalls()).toBe(1);

    current = meWith('none');
    act(() => { vi.advanceTimersByTime(PERMISSIONS_REFETCH_INTERVAL_MS - 1); });
    expect(meCalls()).toBe(1);
    expect(text('orders-can')).toBe('view');

    act(() => { vi.advanceTimersByTime(1); });
    expect(meCalls()).toBe(2);
    await act(async () => { await Promise.resolve(); });
    expect(text('orders-can')).toBe('none');
    expect(text('state')).toBe('ready');

    // And it keeps ticking: a later grant lands the same way.
    current = meWith('manage');
    act(() => { vi.advanceTimersByTime(PERMISSIONS_REFETCH_INTERVAL_MS); });
    await act(async () => { await Promise.resolve(); });
    expect(text('orders-can')).toBe('manage');
    expect(meCalls()).toBe(3);
  });

  it('interval ticks are skipped while the tab is hidden — focus on return is the catch-up', async () => {
    vi.useFakeTimers();
    renderProvider();
    await act(async () => { await Promise.resolve(); });
    expect(meCalls()).toBe(1);

    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => { vi.advanceTimersByTime(PERMISSIONS_REFETCH_INTERVAL_MS * 3); });
    await act(async () => { await Promise.resolve(); });
    expect(meCalls()).toBe(1);

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    current = meWith('none');
    act(() => { window.dispatchEvent(new Event('focus')); });
    await act(async () => { await Promise.resolve(); });
    expect(meCalls()).toBe(2);
    expect(text('orders-can')).toBe('none');
  });
});
