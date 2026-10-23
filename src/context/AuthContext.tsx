/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase.ts';
import { apiRequest } from '../services/api.ts';
import { signOut as authSignOut } from '../services/auth.ts';

export interface AccountProfile {
  id: string;
  email: string | null;
  role: 'customer' | 'admin' | 'staff' | 'manager';
  fullName: string | null;
  phone: string | null;
  addresses: unknown[];
  favorites: number[];
  createdAt: string;
}

interface AuthContextType {
  user: User | null;
  profile: AccountProfile | null;
  loading: boolean;
  /** True while a profile fetch is in flight with no profile to show yet. */
  profileLoading: boolean;
  /** Why the profile could not be loaded (set only when there is no profile). */
  profileError: string | null;
  /** True for admin, manager AND staff — any privileged role may enter the admin console. */
  canAccessAdmin: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  // Mirrors `profile` so refreshProfile can tell a first load (nothing to
  // show yet — screens must spinner or offer a retry) from a background
  // refresh (a good profile is already on screen and must be left alone).
  const profileRef = useRef<AccountProfile | null>(null);

  const applyProfile = useCallback((next: AccountProfile | null) => {
    profileRef.current = next;
    setProfile(next);
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!supabase) { applyProfile(null); setProfileError(null); return; }
    const { data } = await supabase.auth.getSession();
    if (!data.session) { applyProfile(null); setProfileError(null); return; }
    // Remember WHICH session this fetch belongs to. The session can
    // change while the request is in flight (sign-out, or a different
    // user signing in); a result that lands after that belongs to a
    // dead session and must be dropped — otherwise a signed-out user's
    // profile would resurrect, a failure would pin an error on a
    // session that never failed, or the previous user's profile would
    // briefly sit on the new user's session.
    const startedForUserId = data.session.user.id;
    if (!profileRef.current) setProfileLoading(true);
    const res = await apiRequest<{ profile: AccountProfile }>('/api/v1/account/profile');
    const { data: current } = await supabase.auth.getSession();
    if (current.session?.user.id !== startedForUserId) {
      // Stale result: neither the success nor the failure branch may
      // touch the profile or the error. The loading flag belongs to the
      // current session's own fetch (the auth listener starts one on
      // every sign-in), so a different live session's flag is left
      // alone; only when no session remains at all does this dead fetch
      // clear the flag, so it can never stick on with nobody left to
      // clear it (sign-out resets the rest of the state itself).
      if (!current.session) setProfileLoading(false);
      return;
    }
    if (res.ok && res.data) {
      applyProfile(res.data.profile);
      setProfileError(null);
    } else if (!profileRef.current) {
      // The fetch failed and there is no real profile to show. Keep the
      // profile null and surface the failure so screens render an honest
      // error with a retry — NEVER synthesize a profile from auth
      // metadata: an invented role:'customer' profile locked real admins
      // out of the console, and invented empty addresses/favorites were
      // presented as real account data.
      setProfileError(res.error ?? 'We could not load your profile — please try again.');
    }
    // A failed background refresh keeps the last good profile on screen
    // and stays silent; only a load with nothing to show becomes an error.
    setProfileLoading(false);
  }, [applyProfile]);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
      if (data.session) void refreshProfile();
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session) void refreshProfile();
      else { applyProfile(null); setProfileError(null); }
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, [refreshProfile, applyProfile]);

  const signOut = useCallback(async () => {
    await authSignOut();
    setUser(null);
    applyProfile(null);
    setProfileError(null);
    setProfileLoading(false);
  }, [applyProfile]);

  return (
    <AuthContext.Provider
      value={{
        user, profile, loading, profileLoading, profileError,
        canAccessAdmin: profile?.role === 'admin' || profile?.role === 'manager' || profile?.role === 'staff',
        signOut, refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
