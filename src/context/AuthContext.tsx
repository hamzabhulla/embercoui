/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase.ts';
import { apiRequest } from '../services/api.ts';
import { signOut as authSignOut } from '../services/auth.ts';

export interface AccountProfile {
  id: string;
  email: string | null;
  role: 'customer' | 'admin' | 'staff';
  fullName: string | null;
  phone: string | null;
  addresses: unknown[];
  favorites: number[];
}

interface AuthContextType {
  user: User | null;
  profile: AccountProfile | null;
  loading: boolean;
  isAdmin: boolean;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    if (!supabase) { setProfile(null); return; }
    const { data } = await supabase.auth.getSession();
    if (!data.session) { setProfile(null); return; }
    const res = await apiRequest<{ profile: AccountProfile }>('/api/v1/account/profile');
    if (res.ok && res.data) {
      setProfile(res.data.profile);
    } else {
      // API unreachable — fall back to auth metadata so the UI still works.
      const u = data.session.user;
      setProfile({
        id: u.id,
        email: u.email ?? null,
        role: 'customer',
        fullName: (u.user_metadata?.full_name as string) ?? null,
        phone: (u.user_metadata?.phone as string) ?? null,
        addresses: [],
        favorites: [],
      });
    }
  }, []);

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
      else setProfile(null);
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, [refreshProfile]);

  const signOut = useCallback(async () => {
    await authSignOut();
    setUser(null);
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, profile, loading, isAdmin: profile?.role === 'admin' || profile?.role === 'staff', signOut, refreshProfile }}
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
