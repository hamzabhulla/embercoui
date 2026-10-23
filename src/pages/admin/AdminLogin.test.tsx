/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Phase B — the dedicated admin sign-in page, rendered. AuthContext,
// the /me call, the sign-in service and the Supabase MFA API are all
// stubbed at their module seams, so what is pinned here is the page's
// own state machine: form → (customer) no-access state → MFA
// enrollment/challenge from the mocked /me → the panel.

const h = vi.hoisted(() => ({
  auth: { current: null as unknown },
  adminGet: vi.fn(),
  signIn: vi.fn(),
  googleSignIn: vi.fn(),
  reportEvent: vi.fn(async () => {}),
  mfa: {
    listFactors: vi.fn(),
    enroll: vi.fn(),
    unenroll: vi.fn(),
    challenge: vi.fn(),
    verify: vi.fn(),
  },
}));

vi.mock('../../context/AuthContext', () => ({ useAuth: () => h.auth.current }));
vi.mock('../../services/adminApi', () => ({ adminGet: h.adminGet }));
vi.mock('../../services/auth', () => ({ signInWithEmail: h.signIn, signInWithGoogle: h.googleSignIn, isSupabaseConfigured: true }));
vi.mock('../../services/sessionEvents', () => ({
  reportAdminSessionEvent: h.reportEvent,
  reportAdminLoginFailed: vi.fn(async () => {}),
}));
vi.mock('../../lib/supabase', () => ({ supabase: { auth: { mfa: h.mfa } }, isSupabaseConfigured: true }));

import AdminLogin from './AdminLogin';
import { ADMIN_LOGIN_RETURN_KEY, plantAdminLoginReturn } from '../../lib/adminLoginReturn';

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
const meFor = (mfa: { required: boolean; satisfied: boolean }) => ({
  id: 'admin-1', email: 'owner@example.com', role: 'admin', permissions: {}, mfa,
});

function renderPage(withPanelRoute = false) {
  return render(
    <MemoryRouter initialEntries={['/admin/login']}>
      <Routes>
        <Route path="/admin/login" element={<AdminLogin />} />
        {withPanelRoute && <Route path="/admin" element={<div>Panel home</div>} />}
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  h.auth.current = authState();
  h.signIn.mockResolvedValue({ error: null });
  h.googleSignIn.mockResolvedValue({ error: null });
  h.adminGet.mockResolvedValue(meFor({ required: false, satisfied: true }));
  h.mfa.listFactors.mockResolvedValue({ data: { all: [] }, error: null });
  h.mfa.enroll.mockResolvedValue({
    data: { id: 'fac-new', type: 'totp', totp: { qr_code: 'data:image/svg+xml;base64,QUJD', secret: 'JBSWY3DPEHPK3PXP', uri: 'otpauth://totp/Ember' } },
    error: null,
  });
  h.mfa.unenroll.mockResolvedValue({ data: {}, error: null });
  h.mfa.challenge.mockResolvedValue({ data: { id: 'ch-1' }, error: null });
  h.mfa.verify.mockResolvedValue({ data: {}, error: null });
});

afterEach(cleanup);

describe('AdminLogin — signed out', () => {
  it('renders the admin sign-in form — and no sign-up anywhere', () => {
    renderPage();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByText('Admin Console')).toBeTruthy();
    expect(screen.queryByText(/sign up|create account/i)).toBeNull();
  });

  it('submits the typed credentials to the sign-in service', async () => {
    const { container } = renderPage();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret123' } });
    fireEvent.submit(container.querySelector('form')!);
    await waitFor(() => expect(h.signIn).toHaveBeenCalledWith('owner@example.com', 'secret123'));
  });

  it('shows the sign-in error honestly instead of advancing', async () => {
    h.signIn.mockResolvedValue({ error: 'Invalid email or password' });
    const { container } = renderPage();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.submit(container.querySelector('form')!);
    expect((await screen.findByRole('alert')).textContent).toContain('Invalid email or password');
  });
});

describe('AdminLogin — signed-in customer', () => {
  it('gets the honest no-access state with a working sign-out — never a silent bounce', async () => {
    const signOut = vi.fn(async () => {});
    h.auth.current = authState({ user: USER, profile: profileFor('customer'), signOut });
    renderPage();
    expect(await screen.findByText(/doesn't\s+have admin access/)).toBeTruthy();
    expect(screen.getByText('owner@example.com')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalled();
    // The customer never triggers an admin /me read or an MFA call.
    expect(h.adminGet).not.toHaveBeenCalled();
    expect(h.mfa.listFactors).not.toHaveBeenCalled();
  });
});

describe('AdminLogin — privileged, MFA driven by the mocked /me', () => {
  it('no factor yet: enrollment — QR, secret, and a code field', async () => {
    h.auth.current = authState({ user: USER, profile: profileFor('admin') });
    h.adminGet.mockResolvedValue(meFor({ required: true, satisfied: false }));
    renderPage();
    expect(await screen.findByText('Set up two-factor authentication')).toBeTruthy();
    expect(screen.getByAltText('Two-factor setup QR code')).toBeTruthy();
    expect(screen.getByText('JBSWY3DPEHPK3PXP')).toBeTruthy();
    expect(screen.getByLabelText('6-digit code')).toBeTruthy();
    expect(h.mfa.enroll).toHaveBeenCalledWith(expect.objectContaining({ factorType: 'totp' }));
  });

  it('an abandoned (unverified) factor is removed before re-enrolling', async () => {
    h.auth.current = authState({ user: USER, profile: profileFor('manager') });
    h.adminGet.mockResolvedValue(meFor({ required: true, satisfied: false }));
    h.mfa.listFactors.mockResolvedValue({
      data: { all: [{ id: 'fac-stale', factor_type: 'totp', status: 'unverified' }] },
      error: null,
    });
    renderPage();
    expect(await screen.findByText('Set up two-factor authentication')).toBeTruthy();
    expect(h.mfa.unenroll).toHaveBeenCalledWith({ factorId: 'fac-stale' });
    expect(h.mfa.enroll).toHaveBeenCalled();
  });

  it('verified factor: challenge only — and a good code walks through to the panel', async () => {
    h.auth.current = authState({ user: USER, profile: profileFor('admin') });
    h.adminGet
      .mockResolvedValueOnce(meFor({ required: true, satisfied: false }))
      .mockResolvedValue(meFor({ required: true, satisfied: true }));
    h.mfa.listFactors.mockResolvedValue({
      data: { all: [{ id: 'fac-9', factor_type: 'totp', status: 'verified' }] },
      error: null,
    });
    renderPage(true);
    expect(await screen.findByText('Two-factor verification')).toBeTruthy();
    expect(screen.queryByAltText('Two-factor setup QR code')).toBeNull();
    expect(h.mfa.enroll).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('6-digit code'), { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: 'Verify and continue' }));
    await waitFor(() => expect(h.mfa.verify).toHaveBeenCalledWith({ factorId: 'fac-9', challengeId: 'ch-1', code: '123456' }));
    // After verification the page re-reads /me and routes into the panel.
    expect(await screen.findByText('Panel home')).toBeTruthy();
  });

  it('already satisfied: straight into the panel, no MFA UI at all', async () => {
    h.auth.current = authState({ user: USER, profile: profileFor('staff') });
    h.adminGet.mockResolvedValue(meFor({ required: false, satisfied: true }));
    renderPage(true);
    expect(await screen.findByText('Panel home')).toBeTruthy();
    expect(h.mfa.listFactors).not.toHaveBeenCalled();
  });

  it('a failed /me read is an honest error with a retry — not a denial, not a pass', async () => {
    h.auth.current = authState({ user: USER, profile: profileFor('admin') });
    h.adminGet.mockRejectedValueOnce(new Error('Network unreachable'));
    renderPage();
    expect(await screen.findByText("We couldn't verify your access")).toBeTruthy();
    expect(screen.getByText('Network unreachable')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});


describe('AdminLogin — Google sign-in (accounts created with Google hold no password)', () => {
  // A session user as the OAuth return delivers it: a Google
  // identity, and a last_sign_in_at stamped by the round-trip.
  const googleAdmin = (lastSignInAt: string) => ({
    ...USER,
    app_metadata: { provider: 'google', providers: ['google'] },
    identities: [{ provider: 'google' }],
    last_sign_in_at: lastSignInAt,
  });

  it('offers Continue with Google beside the form — no sign-up, no explainer note', () => {
    renderPage();
    expect(screen.getByRole('button', { name: /Continue with Google/ })).toBeTruthy();
    // Owner decision 2026-10-23: the "This page is sign-in only…"
    // explainer note was removed from the page — keep it gone.
    expect(screen.queryByText(/This page is sign-in only/)).toBeNull();
    expect(screen.queryByText(/create account/i)).toBeNull();
  });

  it('clicking it plants the return record and starts OAuth back to THIS page — never the customer home', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }));
    await waitFor(() => expect(h.googleSignIn).toHaveBeenCalledWith('/admin/login'));
    const planted = JSON.parse(sessionStorage.getItem(ADMIN_LOGIN_RETURN_KEY) ?? 'null') as { returnPath?: unknown; at?: unknown } | null;
    expect(planted?.returnPath).toBe('/admin/login');
    expect(typeof planted?.at).toBe('number');
    expect(Math.abs(Date.now() - (planted?.at as number))).toBeLessThan(5000);
  });

  it('an OAuth start failure surfaces the service wording in the page alert — and leaves no record behind', async () => {
    h.googleSignIn.mockResolvedValue({ error: "Google sign-in isn't available yet — an admin will need to enable it." });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/ }));
    expect((await screen.findByRole('alert')).textContent).toContain("Google sign-in isn't available yet");
    expect(sessionStorage.getItem(ADMIN_LOGIN_RETURN_KEY)).toBeNull();
  });

  it('the return landing: fresh Google session + planted record → the login is reported and the panel opens', async () => {
    plantAdminLoginReturn('/admin/login', Date.now() - 60_000);
    h.auth.current = authState({
      user: googleAdmin(new Date(Date.now() - 30_000).toISOString()),
      profile: profileFor('admin'),
    });
    renderPage(true);
    expect(await screen.findByText('Panel home')).toBeTruthy();
    // The session this page started counts as a sign-in performed
    // here — the same Login Activity entry the password path writes.
    expect(h.reportEvent).toHaveBeenCalledWith('login');
    // The record is single-use: consumed by the landing.
    expect(sessionStorage.getItem(ADMIN_LOGIN_RETURN_KEY)).toBeNull();
  });

  it('the return landing with MFA due enters the same MfaFlow the password path reaches — no bypass', async () => {
    plantAdminLoginReturn('/admin/login', Date.now() - 60_000);
    h.auth.current = authState({
      user: googleAdmin(new Date(Date.now() - 30_000).toISOString()),
      profile: profileFor('admin'),
    });
    h.adminGet.mockResolvedValue(meFor({ required: true, satisfied: false }));
    renderPage(true);
    expect(await screen.findByText('Set up two-factor authentication')).toBeTruthy();
    expect(screen.queryByText('Panel home')).toBeNull();
  });

  it('a Google account without an admin role gets the identical no-access state as a password account', async () => {
    plantAdminLoginReturn('/admin/login', Date.now() - 60_000);
    const signOut = vi.fn(async () => {});
    h.auth.current = authState({
      user: googleAdmin(new Date(Date.now() - 30_000).toISOString()),
      profile: profileFor('customer'),
      signOut,
    });
    renderPage();
    expect(await screen.findByText(/doesn't\s+have admin access/)).toBeTruthy();
    expect(screen.getByText('owner@example.com')).toBeTruthy();
    expect(h.adminGet).not.toHaveBeenCalled();
    expect(h.reportEvent).not.toHaveBeenCalledWith('login');
  });

  it('a pre-existing session merely visiting with a record in the window is NOT logged as a fresh login', async () => {
    // The record is fresh, but this session was signed in two hours
    // ago — long before the plant. The freshness binding refuses to
    // credit it as the sign-in this page started; routing is
    // unaffected (a live privileged session still opens the panel).
    plantAdminLoginReturn('/admin/login', Date.now() - 60_000);
    h.auth.current = authState({
      user: googleAdmin(new Date(Date.now() - 2 * 3_600_000).toISOString()),
      profile: profileFor('admin'),
    });
    renderPage(true);
    expect(await screen.findByText('Panel home')).toBeTruthy();
    expect(h.reportEvent).not.toHaveBeenCalledWith('login');
    expect(sessionStorage.getItem(ADMIN_LOGIN_RETURN_KEY)).toBeNull();
  });
});
