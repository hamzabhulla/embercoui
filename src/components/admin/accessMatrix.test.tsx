/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Phase E — the frontend half of the access matrix (light by design).
// The BACKEND matrix (backend/tests/access-matrix.test.ts) is the
// authoritative sweep; what is pinned here is only what the browser
// decides: which sidebar sections a role sees, what SectionGate does
// with a direct URL, the stripped-account state, and whether a
// view-only holder gets write controls. The permission maps below
// are HAND-WRITTEN mirrors of the approved plan (the same table the
// backend matrix encodes) — not imported from production code — and
// /admin/me is stubbed at the adminApi seam, so the REAL
// PermissionsProvider, SectionGate, shell and orders page render.

const h = vi.hoisted(() => ({
  auth: { current: null as unknown },
  me: { current: null as unknown },
  adminGet: vi.fn(),
  adminSend: vi.fn(),
}));

vi.mock('../../context/AuthContext', () => ({ useAuth: () => h.auth.current }));
vi.mock('../../services/adminApi', () => ({ adminGet: h.adminGet, adminSend: h.adminSend }));
vi.mock('../../services/sessionEvents', () => ({
  reportAdminSessionEvent: vi.fn(async () => {}),
  reportAdminLoginFailed: vi.fn(async () => {}),
}));
vi.mock('../../services/auth', () => ({ signInWithEmail: vi.fn(), isSupabaseConfigured: true }));
vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { mfa: { listFactors: vi.fn(), challenge: vi.fn(), verify: vi.fn() } } },
  isSupabaseConfigured: true,
}));

import AdminLayout, { AdminGuard } from './AdminLayout';
import { SectionGate } from './PermissionsContext';
import AdminOrders from '../../pages/admin/AdminOrders';

// Hand-written expectation maps — the approved plan, per role.
const OWNER_MAP = {
  dashboard: 'manage', orders: 'manage', reservations: 'manage', menu: 'manage',
  customers: 'manage', reviews: 'manage', newsletter: 'manage', coupons: 'manage',
  finance: 'manage', staff: 'manage', settings: 'manage', security: 'manage',
};
const MANAGER_MAP = {
  dashboard: 'view', orders: 'manage', reservations: 'manage', menu: 'manage',
  customers: 'view', reviews: 'manage', newsletter: 'view', coupons: 'view',
  finance: 'none', staff: 'none', settings: 'none', security: 'none',
};
const STAFF_MAP = {
  dashboard: 'view', orders: 'manage', reservations: 'manage', menu: 'manage',
  customers: 'none', reviews: 'manage', newsletter: 'none', coupons: 'view',
  finance: 'none', staff: 'none', settings: 'none', security: 'none',
};
const NONE_MAP = Object.fromEntries(Object.keys(OWNER_MAP).map((s) => [s, 'none']));
const ORDERS_VIEW_MAP = { ...NONE_MAP, orders: 'view' };
const ORDERS_MANAGE_MAP = { ...NONE_MAP, orders: 'manage' };

const ALL_LABELS = [
  'Dashboard', 'Orders', 'Reservations', 'Menu', 'Customers', 'Reviews',
  'Newsletter', 'Coupons', 'Finance', 'Staff', 'Settings', 'Security & Activity',
];

const ORDER = {
  id: 'order-12345678', customerName: 'Ayesha Khan', customerEmail: 'ayesha@example.com',
  customerPhone: '+92 300 1234534', status: 'pending', paymentStatus: 'unpaid',
  subtotal: 24, discount: 0, deliveryFee: 0, total: 24, currency: 'USD',
  items: [{ name: 'Ember Classic', quantity: 1, unitPrice: 24 }],
  createdAt: '2026-10-22T10:00:00.000Z',
};

function authState(role: string) {
  return {
    user: { id: 'u-1', email: `${role}@example.com` },
    profile: {
      id: 'u-1', email: `${role}@example.com`, role, fullName: 'Test Person',
      phone: null, addresses: [], favorites: [], createdAt: '2026-01-01T00:00:00.000Z',
    },
    loading: false, profileLoading: false, profileError: null, canAccessAdmin: true,
    signOut: vi.fn(async () => {}), refreshProfile: vi.fn(async () => {}),
  };
}

function signInAs(role: string, permissions: Record<string, string>) {
  h.auth.current = authState(role);
  h.me.current = {
    id: 'u-1', email: `${role}@example.com`, role, permissions,
    mfa: { required: false, satisfied: true },
  };
}

function renderShell(initial = '/admin') {
  return render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/admin/login" element={<div>Admin login page</div>} />
        <Route path="/admin" element={<AdminGuard><AdminLayout /></AdminGuard>}>
          <Route index element={<SectionGate section="dashboard"><div>Dashboard page</div></SectionGate>} />
          <Route path="orders" element={<SectionGate section="orders"><AdminOrders /></SectionGate>} />
          <Route path="finance" element={<SectionGate section="finance"><div>Finance page</div></SectionGate>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

const nav = () => document.querySelector('nav')!;
const navLabels = () => [...nav().querySelectorAll('a')].map((a) => a.textContent?.trim());

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  h.adminGet.mockImplementation(async (path: string) => {
    if (path === '/api/v1/admin/me') return h.me.current;
    if (path.startsWith('/api/v1/admin/orders')) return { orders: [ORDER], total: 1 };
    throw new Error(`unexpected fetch: ${path}`);
  });
  h.adminSend.mockResolvedValue({});
});

afterEach(cleanup);

describe('sidebar visibility per role (from the /me map)', () => {
  it('owner: all twelve sections', async () => {
    signInAs('admin', OWNER_MAP);
    renderShell();
    // Wait on a label that exists only in the nav: by the time it
    // renders, /me has resolved and the sidebar shows its final set.
    expect(await screen.findByText('Security & Activity')).toBeTruthy();
    expect(navLabels()).toEqual(ALL_LABELS);
  });

  it('staff: exactly its six sections — no Customers, Newsletter, Finance, Staff, Settings or Security', async () => {
    signInAs('staff', STAFF_MAP);
    renderShell();
    expect(await screen.findByText('Coupons')).toBeTruthy();
    expect(navLabels()).toEqual(['Dashboard', 'Orders', 'Reservations', 'Menu', 'Reviews', 'Coupons']);
    for (const hidden of ['Customers', 'Newsletter', 'Finance', 'Staff', 'Settings', 'Security & Activity']) {
      expect(within(nav()).queryByText(hidden), hidden).toBeNull();
    }
  });

  it('manager: the floor sections plus Customers and Newsletter — money/people/settings/security stay hidden', async () => {
    signInAs('manager', MANAGER_MAP);
    renderShell();
    expect(await screen.findByText('Newsletter')).toBeTruthy();
    expect(navLabels()).toEqual([
      'Dashboard', 'Orders', 'Reservations', 'Menu', 'Customers', 'Reviews', 'Newsletter', 'Coupons',
    ]);
    for (const hidden of ['Finance', 'Staff', 'Settings', 'Security & Activity']) {
      expect(within(nav()).queryByText(hidden), hidden).toBeNull();
    }
  });

  it('an all-none account gets the "No sections assigned" state, not an empty shell', async () => {
    signInAs('staff', NONE_MAP);
    renderShell();
    expect(await screen.findByText('No sections assigned')).toBeTruthy();
    expect(navLabels()).toEqual([]);
    expect(screen.queryByText('Dashboard page')).toBeNull();
  });
});

describe('SectionGate on a direct URL', () => {
  it('staff at /admin/finance: the restricted panel, never the page', async () => {
    signInAs('staff', STAFF_MAP);
    renderShell('/admin/finance');
    expect(await screen.findByText('Access restricted')).toBeTruthy();
    expect(screen.queryByText('Finance page')).toBeNull();
  });

  it('manager at /admin/finance: restricted too (built-in default is none)', async () => {
    signInAs('manager', MANAGER_MAP);
    renderShell('/admin/finance');
    expect(await screen.findByText('Access restricted')).toBeTruthy();
    expect(screen.queryByText('Finance page')).toBeNull();
  });

  it('owner at /admin/finance: the page renders', async () => {
    signInAs('admin', OWNER_MAP);
    renderShell('/admin/finance');
    expect(await screen.findByText('Finance page')).toBeTruthy();
    expect(screen.queryByText('Access restricted')).toBeNull();
  });
});

describe('write controls follow the level — the orders page', () => {
  // The status-action buttons render the raw next-status text
  // ('confirmed', 'cancelled', lowercase); the filter chips render
  // capitalised labels, so exact textContent tells them apart.
  const statusButtons = () => screen.queryAllByRole('button')
    .filter((b) => ['confirmed', 'cancelled'].includes((b.textContent ?? '').trim()));

  it('a view-only holder SEES the orders but gets no status controls', async () => {
    signInAs('staff', ORDERS_VIEW_MAP);
    renderShell('/admin/orders');
    expect(await screen.findByText('Ayesha Khan')).toBeTruthy();
    expect(statusButtons()).toHaveLength(0);
  });

  it('a manage holder gets the status controls', async () => {
    signInAs('staff', ORDERS_MANAGE_MAP);
    renderShell('/admin/orders');
    expect(await screen.findByText('Ayesha Khan')).toBeTruthy();
    expect(statusButtons()).toHaveLength(2);
  });
});
