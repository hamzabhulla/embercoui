import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Avatar, primaryBtn } from './ui';

const ic = (path: React.ReactNode) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{path}</svg>
);

const NAV_GROUPS: { label: string; items: { to: string; label: string; end?: boolean; adminOnly?: boolean; icon: React.ReactNode }[] }[] = [
  {
    label: 'Overview',
    items: [
      { to: '/admin', label: 'Dashboard', end: true, icon: ic(<><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="5" rx="1.5" /><rect x="13" y="10" width="8" height="11" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /></>) },
      { to: '/admin/orders', label: 'Orders', icon: ic(<><path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z" /><path d="M9 8h6M9 12h6" /></>) },
      { to: '/admin/reservations', label: 'Reservations', icon: ic(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>) },
      { to: '/admin/menu', label: 'Menu', icon: ic(<><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19a2 2 0 0 1 2-2h13" /></>) },
    ],
  },
  {
    label: 'Manage',
    items: [
      { to: '/admin/customers', label: 'Customers', adminOnly: true, icon: ic(<><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><path d="M16 5a3.5 3.5 0 0 1 0 6.5M21 20c0-2.8-1.8-4.7-4.5-5.3" /></>) },
      { to: '/admin/reviews', label: 'Reviews', icon: ic(<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z" />) },
      { to: '/admin/newsletter', label: 'Newsletter', adminOnly: true, icon: ic(<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 6.5L12 13l8.5-6.5" /></>) },
      { to: '/admin/marketing', label: 'Coupons', icon: ic(<><path d="M3 9V5a2 2 0 0 1 2-2h4l12 12-6 6L3 9z" /><circle cx="8" cy="7.5" r="1.4" /></>) },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/admin/finance', label: 'Finance', adminOnly: true, icon: ic(<><path d="M4 20V10M10 20V4M16 20v-8M22 20H2" /></>) },
      { to: '/admin/staff', label: 'Staff', adminOnly: true, icon: ic(<><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="2" /><path d="M5.5 17c.6-1.8 1.9-2.7 3.5-2.7s2.9.9 3.5 2.7M15.5 9.5h4M15.5 13h4" /></>) },
      { to: '/admin/settings', label: 'Settings', adminOnly: true, icon: ic(<><path d="M5 7h9M18 7h1M5 17h3M12 17h7" /><circle cx="16" cy="7" r="2.2" /><circle cx="10" cy="17" r="2.2" /></>) },
    ],
  },
];

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  if (loading) {
    return <div className="min-h-screen bg-[#F7F4EE] flex items-center justify-center"><p className="font-bodytext text-[#98A096] tracking-[0.2em] uppercase text-xs">Loading…</p></div>;
  }
  if (!user) {
    return (
      <div className="min-h-screen bg-[#F7F4EE] flex items-center justify-center px-6">
        <div className="text-center bg-white border border-[#EAE3D3] rounded-2xl px-8 py-10 max-w-sm w-full shadow-[0_18px_40px_-24px_rgba(22,36,26,0.35)]">
          <h1 className="font-display text-3xl text-[#16241A] mb-3">Admin access</h1>
          <p className="font-bodytext text-[#5C665C] text-sm mb-6">Please sign in with a staff or admin account.</p>
          <button onClick={() => navigate('/login')} className={primaryBtn}>Sign in</button>
        </div>
      </div>
    );
  }
  if (!profile || (profile.role !== 'admin' && profile.role !== 'staff')) {
    return (
      <div className="min-h-screen bg-[#F7F4EE] flex items-center justify-center px-6">
        <div className="text-center bg-white border border-[#EAE3D3] rounded-2xl px-8 py-10 max-w-sm w-full shadow-[0_18px_40px_-24px_rgba(22,36,26,0.35)]">
          <h1 className="font-display text-3xl text-[#16241A] mb-3">No admin access</h1>
          <p className="font-bodytext text-[#5C665C] text-sm mb-6">This account does not have staff permissions.</p>
          <button onClick={() => navigate('/')} className={primaryBtn}>Back to site</button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export default function AdminLayout() {
  const { profile, user, signOut } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = profile?.role === 'admin';
  // Admin-only sections are hidden from staff entirely (the backend 403s
  // them too); groups left empty by the filter are not rendered.
  const visibleGroups = NAV_GROUPS
    .map((group) => ({ ...group, items: group.items.filter((item) => isAdmin || !item.adminOnly) }))
    .filter((group) => group.items.length > 0);
  const displayName = profile?.fullName ?? user?.email ?? 'Admin';
  return (
    <div className="min-h-screen bg-[#F7F4EE] text-[#16241A] flex font-bodytext">
      <aside className={`${menuOpen ? 'flex' : 'hidden'} md:flex fixed md:sticky top-0 inset-y-0 left-0 z-40 w-[230px] shrink-0 h-screen flex-col bg-white border-r border-[#EAE3D3]`}>
        <div className="flex items-center gap-3 px-[18px] pt-5 pb-4 border-b border-[#EFE9DB]">
          <span className="w-[38px] h-[38px] rounded-full border border-[#C17A3A]/50 text-[#C17A3A] flex items-center justify-center font-display text-[19px] shadow-[0_0_0_4px_rgba(193,122,58,0.10)] shrink-0">✦</span>
          <div>
            <p className="font-display text-[19px] font-semibold leading-none text-[#16241A]">Ember &amp; Co.</p>
            <p className="font-bodytext text-[9.5px] tracking-[0.26em] uppercase text-[#98A096] mt-[5px]">Admin Console</p>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          {visibleGroups.map((group) => (
            <div key={group.label} className="mb-4">
              <p className="font-bodytext text-[9.5px] tracking-[0.22em] uppercase text-[#98A096] font-semibold px-2 mb-1.5">{group.label}</p>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setMenuOpen(false)}
                  className={({ isActive }) => `flex items-center gap-[11px] px-[11px] py-2 rounded-[9px] font-bodytext text-[13.5px] font-medium mb-0.5 transition-colors ${isActive ? 'bg-[#FBF2E4] text-[#8A551F] shadow-[inset_3px_0_0_#C17A3A]' : 'text-[#5C665C] hover:bg-[#FBF8F1] hover:text-[#16241A]'}`}>
                  <span className="opacity-80 shrink-0">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="p-4 border-t border-[#EFE9DB]">
          <div className="flex items-center gap-2.5 min-w-0">
            <Avatar name={displayName} size={32} />
            <div className="min-w-0">
              <p className="font-bodytext text-[13px] font-semibold text-[#16241A] truncate">{displayName}</p>
              <p className="font-bodytext text-[11px] text-[#98A096] capitalize">{profile?.role ?? ''}</p>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => navigate('/')} className="flex-1 h-8 px-2 rounded-lg border border-[#EAE3D3] bg-white font-bodytext text-[12px] font-medium text-[#16241A] hover:bg-[#FBF8F1] transition-colors">View site</button>
            <button onClick={() => void signOut()} className="flex-1 h-8 px-2 rounded-lg border border-[#EAE3D3] bg-white font-bodytext text-[12px] font-medium text-[#16241A] hover:bg-[#FBF8F1] transition-colors">Sign out</button>
          </div>
        </div>
      </aside>
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 bg-white/95 backdrop-blur border-b border-[#EAE3D3]">
          <p className="font-display text-lg font-semibold">Ember &amp; Co. <span className="text-[#98A096] text-sm font-bodytext">Admin</span></p>
          <button onClick={() => setMenuOpen(!menuOpen)} className="h-8 px-3 rounded-lg border border-[#EAE3D3] bg-white font-bodytext text-[12px] font-medium">Menu</button>
        </div>
        <main className="flex-1 w-full max-w-[1440px] mx-auto px-5 py-6 md:px-[30px] md:py-[26px]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
