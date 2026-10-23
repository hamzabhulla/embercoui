/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

// Phase B — the admin guard + shell gating, rendered. The guard must
// route signed-out visitors (and signed-in customers) to the
// dedicated /admin/login; the shell must show an MFA-unsatisfied
// caller ONLY the verification flow — no sidebar, no page — and the
// full shell once /me reports them satisfied.

const h = vi.hoisted(() => ({
  auth: { current: null as unknown },
  perms: { current: null as unknown },
  mfa: { listFactors: vi.fn() },
}));

vi.mock('../../context/AuthContext', () => ({ useAuth: () => h.auth.current }));
vi.mock('./PermissionsContext', () => ({
  PermissionsProvider: ({ children }: { children: ReactNode }) => children,
  usePermissions: () => h.perms.current,
}));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { mfa: h.mfa } }, isSupabaseConfigured: true }));

import AdminLayout, { AdminGuard } from './AdminLayout';

function authState(over: Record<string, unknown> = {}) {
  return {
    user: null, profile: null, loading: false, profileLoading: false,
    profileError: null, canAccessAdmin: false,
    signOut: vi.fn(async () => {}), refreshProfile: vi.fn(async () => {}),
    ...over,
  };
}

const USER = { id: 'admin-1', email: 'owner@example.com' };
const profileFor = (role: string) => ({
  id: 'admin-1', email: 'owner@example.com', role, fullName: 'Owner',
  phone: null, addresses: [], favorites: [], createdAt: '2026-01-01T00:00:00.000Z',
});
const FULL_PERMISSIONS = Object.fromEntries(
  ['dashboard', 'orders', 'reservations', 'menu', 'customers', 'reviews', 'newsletter', 'coupons', 'finance', 'staff', 'settings', 'security']
    .map((s) => [s, 'manage']),
);
const permsFor = (mfa: { required: boolean; satisfied: boolean } | null) => ({
  me: mfa ? { id: 'admin-1', email: 'owner@example.com', role: 'admin', permissions: FULL_PERMISSIONS, mfa } : null,
  loading: !mfa,
  error: '',
  can: () => true,
  refresh: vi.fn(),
});

function renderAdmin() {
  return render(
    <MemoryRouter initialEntries={['/admin']}>
      <Routes>
        <Route path="/admin/login" element={<div>Admin login page</div>} />
        <Route path="/admin" element={<AdminGuard><AdminLayout /></AdminGuard>}>
          <Route index element={<div>Dashboard page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.current = authState({ user: USER, profile: profileFor('admin'), canAccessAdmin: true });
  h.perms.current = permsFor({ required: false, satisfied: true });
  h.mfa.listFactors.mockResolvedValue({
    data: { all: [{ id: 'fac-9', factor_type: 'totp', status: 'verified' }] },
    error: null,
  });
});

afterEach(cleanup);

describe('AdminGuard routing', () => {
  it('a signed-out visitor is redirected to the dedicated /admin/login', async () => {
    h.auth.current = authState();
    renderAdmin();
    expect(await screen.findByText('Admin login page')).toBeTruthy();
    expect(screen.queryByText('Dashboard page')).toBeNull();
  });

  it('a signed-in customer is redirected to /admin/login too (which shows the no-access state)', async () => {
    h.auth.current = authState({ user: USER, profile: profileFor('customer') });
    renderAdmin();
    expect(await screen.findByText('Admin login page')).toBeTruthy();
    expect(screen.queryByText('Dashboard page')).toBeNull();
  });
});

describe('AdminShell two-factor gate', () => {
  it('while /me is still loading, no admin screen renders', () => {
    h.perms.current = permsFor(null);
    renderAdmin();
    expect(screen.getByText('Loading…')).toBeTruthy();
    expect(screen.queryByText('Dashboard page')).toBeNull();
  });

  it('MFA required but unsatisfied: ONLY the verification flow — no sidebar, no page', async () => {
    h.perms.current = permsFor({ required: true, satisfied: false });
    renderAdmin();
    expect(await screen.findByText('Two-factor verification')).toBeTruthy();
    expect(screen.queryByText('Dashboard page')).toBeNull();
    expect(screen.queryByText('Orders')).toBeNull();
    expect(screen.queryByText('Admin Console')).toBeNull();
  });

  it('MFA satisfied: the full shell with sidebar and page', async () => {
    h.perms.current = permsFor({ required: true, satisfied: true });
    renderAdmin();
    expect(await screen.findByText('Dashboard page')).toBeTruthy();
    expect(screen.getByText('Orders')).toBeTruthy();
  });

  it('MFA not required: the full shell as before', async () => {
    h.perms.current = permsFor({ required: false, satisfied: true });
    renderAdmin();
    expect(await screen.findByText('Dashboard page')).toBeTruthy();
    expect(screen.getByText('Orders')).toBeTruthy();
  });
});
