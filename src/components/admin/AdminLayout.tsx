import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

const NAV = [
  { to: '/admin', label: 'Dashboard', end: true },
  { to: '/admin/orders', label: 'Orders' },
  { to: '/admin/menu', label: 'Menu' },
  { to: '/admin/reservations', label: 'Reservations' },
  { to: '/admin/customers', label: 'Customers' },
  { to: '/admin/reviews', label: 'Reviews' },
  { to: '/admin/newsletter', label: 'Newsletter' },
  { to: '/admin/marketing', label: 'Marketing' },
  { to: '/admin/finance', label: 'Finance' },
  { to: '/admin/staff', label: 'Staff' },
  { to: '/admin/settings', label: 'Settings' },
];

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  if (loading) {
    return <div className="min-h-screen bg-[#0D1A0E] flex items-center justify-center"><p className="font-bodytext text-[#F5F0E8]/60 tracking-[0.2em] uppercase text-xs">Loading…</p></div>;
  }
  if (!user) {
    return (
      <div className="min-h-screen bg-[#0D1A0E] flex items-center justify-center px-6">
        <div className="text-center">
          <h1 className="font-display text-3xl text-[#F5F0E8] mb-3">Admin access</h1>
          <p className="font-bodytext text-[#F5F0E8]/60 mb-6">Please sign in with a staff or admin account.</p>
          <button onClick={() => navigate('/login')} className="px-8 py-3 bg-[#C17A3A] hover:bg-[#A66932] text-white font-bodytext text-xs tracking-[0.2em] uppercase transition-colors">Sign in</button>
        </div>
      </div>
    );
  }
  if (!profile || (profile.role !== 'admin' && profile.role !== 'staff')) {
    return (
      <div className="min-h-screen bg-[#0D1A0E] flex items-center justify-center px-6">
        <div className="text-center">
          <h1 className="font-display text-3xl text-[#F5F0E8] mb-3">No admin access</h1>
          <p className="font-bodytext text-[#F5F0E8]/60 mb-6">This account does not have staff permissions.</p>
          <button onClick={() => navigate('/')} className="px-8 py-3 bg-[#C17A3A] hover:bg-[#A66932] text-white font-bodytext text-xs tracking-[0.2em] uppercase transition-colors">Back to site</button>
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
  return (
    <div className="min-h-screen bg-[#0D1A0E] text-[#F5F0E8] flex">
      <aside className={`${menuOpen ? 'flex' : 'hidden'} md:flex fixed md:static inset-y-0 left-0 z-40 w-64 flex-col bg-[#1C2B1E] border-r border-white/10`}>
        <div className="p-6 border-b border-white/10">
          <p className="font-display text-2xl">Ember <span className="text-[#C17A3A]">&amp;</span> Co.</p>
          <p className="font-bodytext text-[10px] tracking-[0.3em] uppercase text-[#F5F0E8]/50 mt-1">Admin panel</p>
        </div>
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setMenuOpen(false)}
              className={({ isActive }) => `block px-4 py-2.5 font-bodytext text-xs tracking-[0.18em] uppercase transition-colors ${isActive ? 'bg-[#C17A3A] text-white' : 'text-[#F5F0E8]/70 hover:bg-white/5 hover:text-[#F5F0E8]'}`}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-white/10">
          <p className="font-bodytext text-xs text-[#F5F0E8]/60 truncate">{profile?.fullName ?? user?.email}</p>
          <p className="font-bodytext text-[10px] tracking-[0.2em] uppercase text-[#C17A3A]">{profile?.role}</p>
          <div className="flex gap-2 mt-3">
            <button onClick={() => navigate('/')} className="flex-1 px-3 py-2 border border-white/20 font-bodytext text-[10px] tracking-[0.18em] uppercase hover:bg-white/5 transition-colors">View site</button>
            <button onClick={() => void signOut()} className="flex-1 px-3 py-2 border border-white/20 font-bodytext text-[10px] tracking-[0.18em] uppercase hover:bg-white/5 transition-colors">Sign out</button>
          </div>
        </div>
      </aside>
      <div className="flex-1 min-w-0">
        <div className="md:hidden flex items-center justify-between p-4 border-b border-white/10">
          <p className="font-display text-xl">Ember &amp; Co. Admin</p>
          <button onClick={() => setMenuOpen(!menuOpen)} className="px-3 py-2 border border-white/20 font-bodytext text-[10px] tracking-[0.18em] uppercase">Menu</button>
        </div>
        <main className="p-6 md:p-10 max-w-6xl mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
