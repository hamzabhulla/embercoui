/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { adminGet } from '../../services/adminApi';
import { levelAtLeast, type PermissionLevel, type PermissionMap, type SectionKey } from '../../lib/permissions';
import type { MfaState } from '../../lib/mfa';
import { ErrorNote, LoadingNote } from './ui';

export interface AdminMe {
  id: string;
  email: string | null;
  role: 'admin' | 'manager' | 'staff';
  permissions: PermissionMap;
  /** The caller's two-factor state (Phase B) — resolved by the backend. */
  mfa: MfaState;
}

interface PermissionsContextType {
  me: AdminMe | null;
  loading: boolean;
  error: string;
  /** can('orders', 'manage') — false until the map has loaded. */
  can: (section: SectionKey, level: PermissionLevel) => boolean;
  refresh: () => void;
}

const PermissionsContext = createContext<PermissionsContextType | null>(null);

/**
 * How often an open admin session re-reads /admin/me in the
 * background (AF-M1). Permission changes are rare and owner-made, so
 * a minute is plenty: it bounds how long a change can stay invisible
 * to a board left open for hours, without turning every open tab
 * into a request storm.
 */
export const PERMISSIONS_REFETCH_INTERVAL_MS = 60 * 1000;

/**
 * Loads the caller's effective permission map for the admin shell
 * (GET /admin/me) and shares it with the sidebar, the route gates
 * and every page's control-level gating. The backend re-resolves
 * the same map per request, so an owner's change is enforced
 * immediately; this provider keeps the SHELL's copy truthful too.
 * The initial load blocks exactly as the gates expect (loading
 * resolves when it settles; a failure surfaces as the error state).
 * After that, the provider re-fetches in the BACKGROUND — on window
 * focus, and every PERMISSIONS_REFETCH_INTERVAL_MS while mounted —
 * and a fresh result replaces the whole /me record in place, so nav
 * sections, can() answers and write controls follow an owner's
 * change (a revocation OR a grant) in the same session, with no
 * reload and no remount. Focus covers the "owner edits in another
 * tab, this tab is refocused" path instantly; the interval bounds
 * staleness for the hours-long unattended board.
 *
 * Background refetches are SILENT: they never flip the loading
 * state (the shell never blanks or re-gates), never disturb the
 * MFA gate or the screen lock, and a failed one keeps the last
 * known map and shows no error — a network blip must not evict a
 * working session. Storm controls: fetches never overlap (a
 * background trigger that lands while one is in flight is dropped,
 * not queued) and interval ticks are skipped while the tab is
 * hidden — the focus refetch catches up when the tab returns. A
 * manual refresh() is the one exception to dropping: the MFA and
 * lock flows call it as a correctness step after a proof, so it
 * queues a single trailing fetch instead. Listeners and the timer
 * are removed on unmount.
 */
export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const inFlight = useRef(false);
  const queuedManual = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const fetchMe = useCallback((silent: boolean) => {
    if (inFlight.current) {
      // Never two /me fetches at once. Background triggers are
      // dropped outright; a manual refresh queues one trailing run.
      if (!silent) queuedManual.current = true;
      return;
    }
    inFlight.current = true;
    adminGet<AdminMe>('/api/v1/admin/me')
      .then((d) => { if (alive.current) { setMe(d); setError(''); } })
      .catch((e: Error) => { if (alive.current && !silent) setError(e.message); })
      .finally(() => {
        inFlight.current = false;
        if (!alive.current) return;
        // loading is the initial/manual path's alone: a silent
        // background fetch must never flip it in either direction.
        if (!silent) setLoading(false);
        if (queuedManual.current) {
          queuedManual.current = false;
          fetchMe(false);
        }
      });
  }, []);

  // Initial load + manual refresh() (the tick): the blocking
  // semantics the shell's gate ordering is built around.
  useEffect(() => { fetchMe(false); }, [tick, fetchMe]);

  // Background refetch (AF-M1): window focus + the fixed interval,
  // interval ticks skipped while the tab is hidden.
  useEffect(() => {
    const onFocus = () => fetchMe(true);
    window.addEventListener('focus', onFocus);
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      fetchMe(true);
    }, PERMISSIONS_REFETCH_INTERVAL_MS);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.clearInterval(timer);
    };
  }, [fetchMe]);

  const can = (section: SectionKey, level: PermissionLevel): boolean =>
    !!me && levelAtLeast(me.permissions[section], level);

  return (
    <PermissionsContext.Provider value={{ me, loading, error, can, refresh: () => setTick((t) => t + 1) }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions(): PermissionsContextType {
  const ctx = useContext(PermissionsContext);
  if (!ctx) throw new Error('usePermissions must be used inside PermissionsProvider');
  return ctx;
}

/** The "no access to this section" panel, in the admin design system. */
export function AccessRestricted() {
  return (
    <div className="bg-white border border-[#EAE3D3] rounded-[14px] px-6 py-10 text-center">
      <h2 className="font-display text-2xl text-[#16241A] mb-2">Access restricted</h2>
      <p className="font-bodytext text-[13.5px] text-[#5C665C] max-w-md mx-auto">
        Your account does not have access to this section. If you need it, ask the owner to grant it from Staff &amp; Permissions.
      </p>
    </div>
  );
}

/**
 * Route gate for one admin section: renders the page only when the
 * caller holds at least 'view' on the section; 'none' shows the
 * restricted panel instead of a page whose every request would 403.
 */
export function SectionGate({ section, children }: { section: SectionKey; children: ReactNode }) {
  const { me, loading, error, can, refresh } = usePermissions();
  if (loading && !me) return <LoadingNote />;
  if (!me) {
    return (
      <div>
        {error && <ErrorNote message={error} />}
        <AccessRestricted />
        <div className="mt-4 text-center">
          <button type="button" onClick={refresh} className="font-bodytext text-[13px] font-medium text-[#8A551F] underline underline-offset-2">Try again</button>
        </div>
      </div>
    );
  }
  if (!can(section, 'view')) return <AccessRestricted />;
  return <>{children}</>;
}
