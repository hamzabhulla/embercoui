/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
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
 * Loads the caller's effective permission map once for the admin shell
 * (GET /admin/me) and shares it with the sidebar, the route gates and
 * every page's control-level gating. The backend re-resolves the same
 * map per request, so an owner's change is enforced immediately; the
 * shell re-fetches on the next full navigation.
 */
export function PermissionsProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<AdminMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let active = true;
    adminGet<AdminMe>('/api/v1/admin/me')
      .then((d) => { if (active) { setMe(d); setError(''); } })
      .catch((e: Error) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tick]);

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
