import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Heart, LogOut, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useCart } from '../context/CartContext.tsx';
import { useCurrency } from '../context/CurrencyContext.tsx';
import { apiRequest, fetchMenuItems, fetchPublicSettings } from '../services/api.ts';
import type { PublicSettings } from '../services/api.ts';
import { updatePassword } from '../services/auth.ts';
import type { MenuItem } from '../data/menu.ts';

interface OrderItem { menuItemId: number | null; name: string; unitPrice: number; quantity: number }
interface Order {
  id: string; status: string; paymentStatus: string; total: number; currency: string; createdAt: string; items: OrderItem[];
}
interface Address { label?: string; line1: string; city: string; postalCode?: string; phone?: string; isDefault?: boolean }

const TABS = ['Orders', 'Favorites', 'Addresses', 'Profile', 'Leave a Review'] as const;
type Tab = (typeof TABS)[number];

const ACTIVE_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'];
const STEPS = [
  { key: 'pending', label: 'Placed' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'out_for_delivery', label: 'On its way' },
  { key: 'delivered', label: 'Delivered' },
];
const chipColor: Record<string, string> = {
  pending: '#C17A3A', confirmed: '#D9A45B', preparing: '#E3B959', ready: '#9DBE9C',
  out_for_delivery: '#D9A45B', delivered: '#9DBE9C', cancelled: '#D9907E',
};
const TITLES = new Set(['ch', 'ch.', 'mr', 'mr.', 'mrs', 'mrs.', 'ms', 'dr', 'dr.', 'mian']);

function nameParts(fullName: string | null | undefined): { first: string; initials: string } {
  const tokens = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  const parts = tokens.length > 1 && TITLES.has(tokens[0].toLowerCase()) ? tokens.slice(1) : tokens;
  const first = parts[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  return { first, initials: `${first.charAt(0)}${last.charAt(0)}`.toUpperCase() || 'E' };
}

const JOST = 'Jost, sans-serif';
const SERIF = 'Cormorant Garamond, serif';
const labelStyle: React.CSSProperties = {
  fontFamily: JOST, textTransform: 'uppercase', letterSpacing: '0.24em',
  fontSize: '10px', color: 'rgba(245,240,232,0.38)', display: 'block', marginBottom: '8px',
};
const inputStyle: React.CSSProperties = {
  fontFamily: JOST, fontSize: '14.5px', color: '#F5F0E8', background: 'rgba(12,23,13,0.6)',
  border: '1px solid rgba(245,240,232,0.16)', padding: '13px 15px', width: '100%', outline: 'none',
};
const emberButton: React.CSSProperties = {
  background: 'linear-gradient(180deg, #CD8543, #C17A3A)', color: '#FFF7EC', textTransform: 'uppercase', letterSpacing: '0.2em',
  fontFamily: JOST, fontSize: '11.5px', padding: '13px 24px', border: '1px solid transparent', cursor: 'pointer',
};
const ghostButton: React.CSSProperties = {
  background: 'transparent', color: 'rgba(245,240,232,0.58)', textTransform: 'uppercase', letterSpacing: '0.2em',
  fontFamily: JOST, fontSize: '11.5px', padding: '13px 24px', border: '1px solid rgba(245,240,232,0.16)', cursor: 'pointer',
};
const cardBg = 'linear-gradient(180deg, rgba(245,240,232,0.028), rgba(245,240,232,0.012))';

export default function Account() {
  const { format } = useCurrency();
  const navigate = useNavigate();
  const { user, profile, loading, signOut, refreshProfile } = useAuth();
  const { addItem, updateQuantity, setIsOpen, items: cartItems } = useCart();
  const [tab, setTab] = useState<Tab>('Orders');
  const [orders, setOrders] = useState<Order[]>([]);
  const [favorites, setFavorites] = useState<MenuItem[]>([]);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // profile form
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  useEffect(() => {
    setFullName(profile?.fullName ?? '');
    setPhone(profile?.phone ?? '');
  }, [profile?.fullName, profile?.phone]);

  // password form
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // address form
  const [addr, setAddr] = useState<Address>({ label: '', line1: '', city: '', postalCode: '', phone: '' });
  const [addrFormOpen, setAddrFormOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const addresses = (profile?.addresses ?? []) as Address[];

  // review form
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [country, setCountry] = useState('');

  const loadOrders = useCallback(async () => {
    setDataLoading(true);
    const res = await apiRequest<{ orders: Order[] }>('/api/v1/account/orders');
    if (res.ok && res.data) setOrders(res.data.orders);
    setDataLoading(false);
  }, []);

  const loadFavorites = useCallback(async () => {
    const res = await apiRequest<{ items: MenuItem[] }>('/api/v1/account/favorites');
    if (res.ok && res.data) setFavorites(res.data.items);
  }, []);

  useEffect(() => { window.scrollTo(0, 0); }, []);
  useEffect(() => {
    if (!user) return;
    void loadOrders();
    void loadFavorites();
    void fetchPublicSettings().then(setSettings);
  }, [user, loadOrders, loadFavorites]);
  useEffect(() => {
    if (!user) return;
    if (tab === 'Orders') void loadOrders();
    if (tab === 'Favorites') void loadFavorites();
  }, [user, tab, loadOrders, loadFavorites]);

  const flash = (msg: string) => { setNotice(msg); setError(null); setTimeout(() => setNotice(null), 4000); };
  const fail = (msg: string | null) => setError(msg ?? 'Something went wrong — please try again');

  const reorder = async (order: Order) => {
    const menu = await fetchMenuItems();
    if (!menu) { fail('Could not load the menu right now — please try again.'); return; }
    const byId = new Map(menu.map((m) => [m.id, m]));
    // Seed from the cart once, then accumulate locally — the cartItems state
    // does not change during this loop, and one order can hold the same dish
    // on two lines (the API stores lines as posted).
    const running = new Map(cartItems.map((i) => [i.id, i.quantity]));
    const addedIds = new Set<number>();
    let missing = 0;
    for (const it of order.items) {
      const m = it.menuItemId != null ? byId.get(it.menuItemId) : undefined;
      if (!m) { missing += 1; continue; }
      addItem({ id: m.id, name: m.name, price: m.price, image: m.image });
      const target = (running.get(m.id) ?? 0) + it.quantity;
      updateQuantity(m.id, target);
      running.set(m.id, target);
      addedIds.add(m.id);
    }
    if (addedIds.size > 0) {
      flash(missing > 0
        ? `Added ${addedIds.size} dish${addedIds.size > 1 ? 'es' : ''} to your cart — ${missing} item${missing > 1 ? 's are' : ' is'} no longer on the menu.`
        : 'Your previous order was added to the cart.');
      setIsOpen(true);
    } else {
      fail('Those dishes are no longer on the menu.');
    }
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiRequest('/api/v1/account/profile', { method: 'PATCH', body: JSON.stringify({ fullName, phone }) });
    if (res.ok) { await refreshProfile(); flash('Profile saved.'); } else fail(res.error);
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) { fail('Your new password needs at least 8 characters.'); return; }
    if (newPassword !== confirmPassword) { fail('The new passwords do not match.'); return; }
    const res = await updatePassword(newPassword);
    if (!res.error) { setNewPassword(''); setConfirmPassword(''); flash('Password updated.'); }
    else fail(res.error);
  };

  const saveAddresses = async (next: Address[]): Promise<boolean> => {
    const res = await apiRequest('/api/v1/account/profile', { method: 'PATCH', body: JSON.stringify({ addresses: next }) });
    if (res.ok) { await refreshProfile(); flash('Addresses updated.'); return true; }
    fail(res.error);
    return false;
  };

  const submitAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addr.line1 || !addr.city) { fail('Please add an address line and city.'); return; }
    let next: Address[];
    if (editIndex != null) {
      next = addresses.map((a, i) => (i === editIndex ? { ...addr, isDefault: a.isDefault } : a));
    } else {
      const isDefault = !addresses.some((a) => a.isDefault);
      next = [...addresses, { ...addr, isDefault }];
    }
    const saved = await saveAddresses(next);
    if (saved) { setAddr({ label: '', line1: '', city: '', postalCode: '', phone: '' }); setEditIndex(null); setAddrFormOpen(false); }
  };

  const startEditAddress = (i: number) => {
    setAddr({ ...addresses[i] });
    setEditIndex(i);
    setAddrFormOpen(true);
  };

  const deleteAddress = async (i: number) => {
    const wasDefault = addresses[i]?.isDefault;
    let next = addresses.filter((_, x) => x !== i);
    if (wasDefault && next.length > 0 && !next.some((a) => a.isDefault)) {
      next = next.map((a, x) => (x === 0 ? { ...a, isDefault: true } : a));
    }
    await saveAddresses(next);
  };

  const makeDefault = async (i: number) => {
    await saveAddresses(addresses.map((a, x) => ({ ...a, isDefault: x === i })));
  };

  const toggleFavorite = async (item: MenuItem) => {
    const res = await apiRequest<{ favorites: number[] }>('/api/v1/account/favorites', {
      method: 'POST', body: JSON.stringify({ menuItemId: item.id }),
    });
    if (res.ok) { await refreshProfile(); void loadFavorites(); } else fail(res.error);
  };

  const submitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiRequest('/api/v1/reviews', {
      method: 'POST',
      body: JSON.stringify({ rating, comment, country: country || undefined }),
    });
    if (res.ok) { setComment(''); flash('Thank you — your review was submitted for moderation.'); }
    else fail(res.error);
  };

  const handleSignOut = async () => { await signOut(); navigate('/'); };

  if (loading) {
    return (
      <div className="min-h-screen pt-[120px] px-6" style={{ background: '#0D1A0E' }}>
        <div className="max-w-5xl mx-auto animate-pulse">
          <div className="h-10 w-64 mb-8" style={{ background: 'rgba(245,240,232,0.08)' }} />
          <div className="h-40" style={{ background: 'rgba(245,240,232,0.05)' }} />
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 py-24" style={{ background: '#0D1A0E' }}>
        <div className="text-center max-w-md">
          <p className="uppercase mb-3" style={{ fontFamily: JOST, fontSize: '10px', letterSpacing: '0.25em', color: '#C17A3A' }}>✦ &nbsp; My Account</p>
          <h1 className="mb-4" style={{ fontFamily: SERIF, fontWeight: 600, color: '#F5F0E8', fontSize: '40px' }}>Sign in to view your account</h1>
          <p className="mb-8" style={{ fontFamily: JOST, fontSize: '13px', color: 'rgba(245,240,232,0.55)', lineHeight: 1.7 }}>
            Your orders, saved dishes and addresses live here once you are signed in.
          </p>
          <button onClick={() => navigate('/login')} style={emberButton} className="transition-all duration-300 hover:brightness-110">
            Sign In
          </button>
        </div>
      </div>
    );
  }

  const { first, initials } = nameParts(profile?.fullName);
  const featured = orders.find((o) => ACTIVE_STATUSES.includes(o.status));
  const history = featured ? orders.filter((o) => o.id !== featured.id) : orders;
  const memberSince = profile?.createdAt
    ? new Date(profile.createdAt).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : null;

  return (
    <div className="min-h-screen relative" style={{ background: '#0C170D', color: '#F5F0E8' }}>
      <div aria-hidden style={{ position: 'absolute', inset: '0 0 auto 0', height: '480px', pointerEvents: 'none', background: 'radial-gradient(900px 420px at 50% -120px, rgba(193,122,58,0.13), transparent 65%)' }} />
      <div className="relative mx-auto px-6 pt-[130px] pb-24" style={{ maxWidth: '1180px' }}>
        <p style={{ fontFamily: JOST, fontSize: '11px', letterSpacing: '0.34em', color: '#C17A3A' }}>✦ &nbsp;MY ACCOUNT</p>
        <h1 style={{ fontFamily: SERIF, fontWeight: 600, fontSize: '54px', lineHeight: 1.05, color: '#F5F0E8', margin: '14px 0 8px' }}>
          Welcome back{first ? <>, <em style={{ color: '#D9A45B' }}>{first}</em></> : ''}
        </h1>
        <p style={{ fontFamily: JOST, fontSize: '14.5px', letterSpacing: '0.04em', color: 'rgba(245,240,232,0.58)' }}>
          <span style={{ color: '#F5F0E8' }}>{profile?.email}</span>
          {memberSince ? <> &nbsp;·&nbsp; Member since {memberSince}</> : null}
        </p>
        <div style={{ height: '1px', margin: '30px 0 38px', background: 'linear-gradient(90deg, #C17A3A, rgba(193,122,58,0.25), transparent)' }} />

        <div className="grid gap-8 lg:grid-cols-[296px_1fr] items-start">
          {/* ── profile rail ─────────────────────────── */}
          <aside className="relative text-center" style={{ background: 'linear-gradient(180deg, #182A13, #13220F)', border: '1px solid rgba(245,240,232,0.1)', padding: '30px 26px', overflow: 'hidden' }}>
            <div aria-hidden style={{ position: 'absolute', inset: '7px', border: '1px solid rgba(217,164,91,0.22)', pointerEvents: 'none' }} />
            <div className="relative">
              <div className="mx-auto flex items-center justify-center" style={{ width: '86px', height: '86px', borderRadius: '50%', fontFamily: SERIF, fontSize: '32px', color: '#D9A45B', background: 'radial-gradient(circle at 35% 30%, #22391B, #101D0D)', border: '1px solid rgba(217,164,91,0.55)', boxShadow: '0 0 0 5px rgba(193,122,58,0.1)' }}>
                {initials}
              </div>
              <p style={{ fontFamily: SERIF, fontSize: '25px', fontWeight: 600, color: '#F5F0E8', marginTop: '16px', lineHeight: 1.15 }}>{profile?.fullName ?? 'Ember Guest'}</p>
              <p style={{ fontFamily: JOST, fontSize: '13px', color: 'rgba(245,240,232,0.38)', marginTop: '3px' }}>{profile?.email}</p>
              <span className="inline-block" style={{ marginTop: '16px', fontFamily: JOST, fontSize: '10px', letterSpacing: '0.3em', color: '#D9A45B', border: '1px solid rgba(217,164,91,0.4)', padding: '5px 12px 4px' }}>EMBER CIRCLE · MEMBER</span>
              <div className="grid grid-cols-3" style={{ borderTop: '1px solid rgba(245,240,232,0.1)', borderBottom: '1px solid rgba(245,240,232,0.1)', margin: '20px 0', padding: '15px 0 13px' }}>
                <div><span className="block" style={{ fontFamily: SERIF, fontSize: '23px', fontWeight: 600, color: '#D9A45B' }}>{orders.length}</span><span style={{ fontSize: '9.5px', letterSpacing: '0.18em', color: 'rgba(245,240,232,0.38)' }}>ORDERS</span></div>
                <div><span className="block" style={{ fontFamily: SERIF, fontSize: '23px', fontWeight: 600, color: '#D9A45B' }}>{favorites.length}</span><span style={{ fontSize: '9.5px', letterSpacing: '0.18em', color: 'rgba(245,240,232,0.38)' }}>FAVORITES</span></div>
                <div><span className="block" style={{ fontFamily: SERIF, fontSize: '23px', fontWeight: 600, color: '#D9A45B' }}>{addresses.length}</span><span style={{ fontSize: '9.5px', letterSpacing: '0.18em', color: 'rgba(245,240,232,0.38)' }}>ADDRESSES</span></div>
              </div>
              <button onClick={() => setTab('Profile')} style={{ ...emberButton, width: '100%' }} className="transition-all duration-300 hover:brightness-110">Edit Profile</button>
              <button onClick={handleSignOut} style={{ ...ghostButton, width: '100%', marginTop: '10px' }} className="transition-colors">
                <span className="inline-flex items-center gap-2"><LogOut size={13} /> Sign Out</span>
              </button>
            </div>
          </aside>

          {/* ── content ──────────────────────────────── */}
          <main>
            <div className="flex flex-wrap" style={{ gap: '34px', borderBottom: '1px solid rgba(245,240,232,0.1)' }}>
              {TABS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className="relative uppercase transition-colors"
                  style={{ fontFamily: JOST, fontSize: '12px', letterSpacing: '0.24em', padding: '4px 2px 15px', background: 'none', border: 'none', cursor: 'pointer', color: tab === t ? '#F5F0E8' : 'rgba(245,240,232,0.38)' }}
                >
                  {t}
                  {tab === t && <span style={{ position: 'absolute', left: 0, right: 0, bottom: '-1px', height: '2px', background: 'linear-gradient(90deg, #C17A3A, #D9A45B)' }} />}
                </button>
              ))}
            </div>

            {notice && (
              <div className="flex items-center gap-2 mt-6 px-4 py-3" style={{ background: 'rgba(157,190,156,0.1)', border: '1px solid rgba(157,190,156,0.35)' }}>
                <Check size={14} color="#9DBE9C" />
                <span style={{ fontFamily: JOST, fontSize: '12.5px', color: '#9DBE9C' }}>{notice}</span>
              </div>
            )}
            {error && (
              <p className="mt-6" style={{ fontFamily: JOST, fontSize: '12.5px', color: '#D9907E' }}>{error}</p>
            )}

            {tab === 'Orders' && (
              <div style={{ paddingTop: '30px' }}>
                {dataLoading && orders.length === 0 && <p style={{ fontFamily: JOST, fontSize: '13px', color: 'rgba(245,240,232,0.4)' }}>Loading your orders…</p>}
                {!dataLoading && orders.length === 0 && (
                  <p style={{ fontFamily: JOST, fontSize: '13px', color: 'rgba(245,240,232,0.4)' }}>
                    No orders yet — your order history will appear here.
                  </p>
                )}

                {featured && (
                  <>
                    <p style={{ fontFamily: JOST, fontSize: '10.5px', letterSpacing: '0.3em', color: 'rgba(245,240,232,0.38)', marginBottom: '14px' }}>CURRENT ORDER</p>
                    <div style={{ border: '1px solid rgba(217,164,91,0.38)', background: 'linear-gradient(180deg, rgba(193,122,58,0.07), rgba(245,240,232,0.012))', padding: '26px 28px', marginBottom: '16px' }}>
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p style={{ fontFamily: JOST, fontSize: '13px', letterSpacing: '0.08em', color: '#F5F2EB' }}>Order <b style={{ fontWeight: 500 }}>#{featured.id.slice(0, 8)}</b></p>
                          <p style={{ fontFamily: JOST, fontSize: '12.5px', color: 'rgba(245,240,232,0.38)', marginTop: '3px' }}>
                            {new Date(featured.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })} · {featured.paymentStatus === 'paid' ? 'Paid by card' : featured.paymentStatus === 'failed' ? 'Card payment failed' : featured.paymentStatus === 'refunded' ? 'Refunded' : 'Pay on delivery'}
                          </p>
                        </div>
                        <span className="uppercase" style={{ fontFamily: JOST, fontSize: '10px', letterSpacing: '0.22em', padding: '6px 13px 5px', color: chipColor[featured.status] ?? '#F5F0E8', border: `1px solid ${chipColor[featured.status] ?? '#888'}88` }}>
                          {featured.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="flex" style={{ margin: '26px 2px 6px' }}>
                        {STEPS.map((step, i) => {
                          const cur = STEPS.findIndex((s) => s.key === featured.status);
                          const state = i < cur ? 'done' : i === cur ? 'now' : 'todo';
                          return (
                            <div key={step.key} className="relative flex-1 text-center">
                              {i > 0 && <span style={{ position: 'absolute', top: '11px', left: '-50%', width: '100%', height: '1px', background: state !== 'todo' || i <= cur ? '#C17A3A' : 'rgba(245,240,232,0.14)', opacity: i <= cur ? 1 : undefined, ...(i > cur ? { background: 'rgba(245,240,232,0.14)' } : {}) }} />}
                              <div className="relative mx-auto flex items-center justify-center" style={{ width: '23px', height: '23px', borderRadius: '50%', fontSize: '11px', zIndex: 1, background: state === 'done' ? '#C17A3A' : '#1B2B16', border: `1px solid ${state === 'done' ? '#C17A3A' : state === 'now' ? '#D9A45B' : 'rgba(245,240,232,0.16)'}`, color: state === 'done' ? '#FFF3E2' : 'transparent' }}>
                                {state === 'done' ? '✓' : state === 'now' ? <span className="animate-ping" style={{ width: '7px', height: '7px', borderRadius: '50%', background: '#D9A45B' }} /> : ''}
                              </div>
                              <span className="block uppercase" style={{ fontFamily: JOST, fontSize: '9.5px', letterSpacing: '0.16em', marginTop: '8px', color: state === 'now' ? '#D9A45B' : state === 'done' ? 'rgba(245,240,232,0.58)' : 'rgba(245,240,232,0.38)' }}>{step.label}</span>
                            </div>
                          );
                        })}
                      </div>
                      <p style={{ fontFamily: JOST, fontSize: '14px', color: 'rgba(245,240,232,0.58)', marginTop: '14px' }}>
                        {featured.items.map((i, idx) => <span key={`${i.menuItemId ?? 'x'}-${idx}`}><b style={{ color: '#F5F0E8', fontWeight: 400 }}>{i.quantity} ×</b> {i.name}&nbsp;&nbsp;·&nbsp;&nbsp;</span>)}
                      </p>
                      <p style={{ fontFamily: JOST, fontSize: '13px', color: 'rgba(245,240,232,0.58)', marginTop: '10px' }}>
                        {featured.status === 'pending' && 'Your order is with the kitchen — waiting to be confirmed.'}
                        {featured.status === 'confirmed' && <>The kitchen has confirmed your order{settings ? <> — estimated arrival <b style={{ color: '#D9A45B', fontWeight: 400 }}>{settings.waitMin}–{settings.waitMax} minutes</b></> : ''}.</>}
                        {featured.status === 'preparing' && <>Your food is being prepared{settings ? <> — estimated arrival <b style={{ color: '#D9A45B', fontWeight: 400 }}>{settings.waitMin}–{settings.waitMax} minutes</b></> : ''}.</>}
                        {featured.status === 'ready' && 'Your order is ready — the rider is about to leave with it.'}
                        {featured.status === 'out_for_delivery' && 'Your order is on its way to you.'}
                        {' '}Live updates appear on the tracking page.
                      </p>
                      <div className="flex flex-wrap items-center justify-between gap-4" style={{ marginTop: '16px' }}>
                        <div>
                          <span className="block" style={{ fontFamily: JOST, fontSize: '10px', letterSpacing: '0.2em', color: 'rgba(245,240,232,0.38)' }}>TOTAL</span>
                          <span style={{ fontFamily: SERIF, fontSize: '27px', fontWeight: 600, color: '#D9A45B' }}>{format(featured.total, featured.currency)}</span>
                        </div>
                        <div className="flex gap-2.5">
                          <button onClick={() => void reorder(featured)} style={{ ...ghostButton, padding: '10px 18px', fontSize: '10.5px' }} className="transition-colors">Order Again</button>
                          <button onClick={() => navigate(`/track-order/${featured.id}`)} style={{ ...emberButton, padding: '10px 18px', fontSize: '10.5px' }} className="transition-all hover:brightness-110">Track Order →</button>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {history.length > 0 && (
                  <>
                    <p style={{ fontFamily: JOST, fontSize: '10.5px', letterSpacing: '0.3em', color: 'rgba(245,240,232,0.38)', margin: '34px 0 14px' }}>ORDER HISTORY</p>
                    <div className="flex flex-col gap-4">
                      {history.map((order) => (
                        <div key={order.id} style={{ background: cardBg, border: '1px solid rgba(245,240,232,0.1)', padding: '26px 28px', opacity: order.status === 'cancelled' ? 0.72 : 1 }}>
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div>
                              <p style={{ fontFamily: JOST, fontSize: '13px', letterSpacing: '0.08em', color: '#F5F2EB' }}>Order <b style={{ fontWeight: 500 }}>#{order.id.slice(0, 8)}</b></p>
                              <p style={{ fontFamily: JOST, fontSize: '12.5px', color: 'rgba(245,240,232,0.38)', marginTop: '3px' }}>
                                {new Date(order.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                              </p>
                            </div>
                            <span className="uppercase" style={{ fontFamily: JOST, fontSize: '10px', letterSpacing: '0.22em', padding: '6px 13px 5px', color: chipColor[order.status] ?? '#F5F0E8', border: `1px solid ${chipColor[order.status] ?? '#888'}88` }}>
                              {order.status.replace(/_/g, ' ')}
                            </span>
                          </div>
                          <p style={{ fontFamily: JOST, fontSize: '14px', color: 'rgba(245,240,232,0.58)', marginTop: '14px' }}>
                            {order.items.map((i) => `${i.quantity} × ${i.name}`).join(' · ')}
                          </p>
                          <div className="flex flex-wrap items-center justify-between gap-4" style={{ marginTop: '14px' }}>
                            <div>
                              <span className="block" style={{ fontFamily: JOST, fontSize: '10px', letterSpacing: '0.2em', color: 'rgba(245,240,232,0.38)' }}>TOTAL</span>
                              <span style={{ fontFamily: SERIF, fontSize: '27px', fontWeight: 600, color: '#D9A45B' }}>{format(order.total, order.currency)}</span>
                            </div>
                            <div className="flex gap-2.5">
                              <button onClick={() => void reorder(order)} style={{ ...ghostButton, padding: '10px 18px', fontSize: '10.5px' }} className="transition-colors">Order Again</button>
                              {order.status !== 'cancelled' && (
                                <button onClick={() => navigate(`/track-order/${order.id}`)} style={{ ...ghostButton, padding: '10px 18px', fontSize: '10.5px' }} className="transition-colors">Track Order →</button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'Favorites' && (
              <div style={{ paddingTop: '30px' }}>
                <p style={{ fontFamily: JOST, fontSize: '10.5px', letterSpacing: '0.3em', color: 'rgba(245,240,232,0.38)', marginBottom: '14px' }}>SAVED DISHES</p>
                {favorites.length === 0 && (
                  <p style={{ fontFamily: JOST, fontSize: '13px', color: 'rgba(245,240,232,0.4)' }}>
                    No saved dishes yet. Tap the heart on any dish while signed in and it will wait for you here.
                  </p>
                )}
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
                  {favorites.map((item) => (
                    <div key={item.id} style={{ border: '1px solid rgba(245,240,232,0.1)', background: cardBg, overflow: 'hidden' }}>
                      <div className="relative flex items-center justify-center" style={{ height: '150px', background: 'radial-gradient(320px 130px at 50% 0%, rgba(193,122,58,0.22), transparent), linear-gradient(160deg, #1E3315, #101D0D)' }}>
                        <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: '52px', color: 'rgba(217,164,91,0.85)' }}>{item.name.charAt(0)}</span>
                        {item.image && <img src={item.image} alt={item.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
                        <button onClick={() => toggleFavorite(item)} aria-label="Remove from favorites" className="absolute transition-transform hover:scale-110" style={{ top: '10px', right: '12px', zIndex: 1 }}>
                          <Heart size={17} color="#C17A3A" fill="#C17A3A" />
                        </button>
                        {item.category && <span className="uppercase" style={{ position: 'absolute', bottom: '10px', left: 0, right: 0, textAlign: 'center', fontFamily: JOST, fontSize: '9px', letterSpacing: '0.3em', color: 'rgba(245,240,232,0.6)', textShadow: '0 1px 6px rgba(0,0,0,0.8)' }}>{item.category}</span>}
                      </div>
                      <div style={{ padding: '18px' }}>
                        <h3 style={{ fontFamily: SERIF, fontSize: '21px', fontWeight: 600, lineHeight: 1.15, color: '#F5F0E8' }}>{item.name}</h3>
                        {item.description && <p style={{ fontFamily: JOST, fontSize: '12.5px', color: 'rgba(245,240,232,0.38)', margin: '6px 0 14px', lineHeight: 1.55 }}>{item.description}</p>}
                        <div className="flex items-center justify-between" style={{ marginTop: item.description ? 0 : '14px' }}>
                          <span style={{ fontFamily: SERIF, fontSize: '21px', fontWeight: 600, color: '#D9A45B' }}>{format(item.price)}</span>
                          <button
                            onClick={() => { addItem({ id: item.id, name: item.name, price: item.price, image: item.image }); flash(`${item.name} added to your cart.`); setIsOpen(true); }}
                            style={{ ...emberButton, padding: '10px 18px', fontSize: '10.5px' }}
                            className="transition-all hover:brightness-110"
                          >
                            <span className="inline-flex items-center gap-1"><Plus size={13} /> Add to Cart</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === 'Addresses' && (
              <div style={{ paddingTop: '30px' }}>
                <p style={{ fontFamily: JOST, fontSize: '10.5px', letterSpacing: '0.3em', color: 'rgba(245,240,232,0.38)', marginBottom: '14px' }}>DELIVERY ADDRESSES</p>
                {addresses.length === 0 && !addrFormOpen && (
                  <p style={{ fontFamily: JOST, fontSize: '13px', color: 'rgba(245,240,232,0.4)', marginBottom: '16px' }}>No saved addresses yet.</p>
                )}
                <div className="grid md:grid-cols-2 gap-4">
                  {addresses.map((a, i) => (
                    <div key={i} style={{ border: '1px solid rgba(245,240,232,0.1)', background: cardBg, padding: '24px 26px' }}>
                      <p className="flex items-center gap-3 uppercase" style={{ fontFamily: JOST, fontSize: '11px', letterSpacing: '0.26em', color: '#F5F0E8' }}>
                        {a.label || 'Address'}
                        {a.isDefault && <span style={{ fontSize: '9px', letterSpacing: '0.2em', color: '#0C170D', background: '#D9A45B', padding: '3px 8px 2px', fontWeight: 600 }}>DEFAULT</span>}
                      </p>
                      <p style={{ fontFamily: JOST, fontSize: '14px', color: 'rgba(245,240,232,0.58)', lineHeight: 1.65, margin: '12px 0 16px' }}>
                        {a.line1}<br />{a.city}{a.postalCode ? ` · ${a.postalCode}` : ''}{a.phone ? <><br />{a.phone}</> : null}
                      </p>
                      <div className="flex flex-wrap" style={{ gap: '20px' }}>
                        <button onClick={() => startEditAddress(i)} className="uppercase inline-flex items-center gap-1.5" style={{ fontFamily: JOST, fontSize: '10.5px', letterSpacing: '0.2em', color: '#C17A3A', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}><Pencil size={11} /> Edit</button>
                        {!a.isDefault && <button onClick={() => void makeDefault(i)} className="uppercase" style={{ fontFamily: JOST, fontSize: '10.5px', letterSpacing: '0.2em', color: '#C17A3A', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Make Default</button>}
                        <button onClick={() => void deleteAddress(i)} className="uppercase inline-flex items-center gap-1.5" style={{ fontFamily: JOST, fontSize: '10.5px', letterSpacing: '0.2em', color: 'rgba(245,240,232,0.38)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}><Trash2 size={11} /> Delete</button>
                      </div>
                    </div>
                  ))}
                  {!addrFormOpen && (
                    <button onClick={() => { setEditIndex(null); setAddr({ label: '', line1: '', city: '', postalCode: '', phone: '' }); setAddrFormOpen(true); }} className="flex flex-col items-center justify-center gap-2 uppercase transition-colors" style={{ border: '1px dashed rgba(245,240,232,0.22)', minHeight: '158px', color: 'rgba(245,240,232,0.38)', fontFamily: JOST, fontSize: '11px', letterSpacing: '0.26em', background: 'transparent', cursor: 'pointer', width: '100%' }}>
                      <span style={{ fontFamily: SERIF, fontSize: '34px', color: '#C17A3A', lineHeight: 1 }}>+</span>
                      Add New Address
                    </button>
                  )}
                </div>

                {addrFormOpen && (
                  <form onSubmit={submitAddress} style={{ border: '1px solid rgba(245,240,232,0.1)', background: cardBg, padding: '28px', marginTop: '16px' }}>
                    <h3 style={{ fontFamily: SERIF, fontSize: '23px', fontWeight: 600, marginBottom: '20px', color: '#F5F0E8' }}>{editIndex != null ? 'Edit address' : 'New address'}</h3>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div><label style={labelStyle}>Label (optional)</label><input value={addr.label} onChange={(e) => setAddr({ ...addr, label: e.target.value })} style={inputStyle} placeholder="Home" /></div>
                      <div><label style={labelStyle}>Phone (optional)</label><input value={addr.phone} onChange={(e) => setAddr({ ...addr, phone: e.target.value })} style={inputStyle} /></div>
                      <div className="md:col-span-2"><label style={labelStyle}>Address Line</label><input value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} style={inputStyle} /></div>
                      <div><label style={labelStyle}>City</label><input value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} style={inputStyle} /></div>
                      <div><label style={labelStyle}>Postal Code</label><input value={addr.postalCode} onChange={(e) => setAddr({ ...addr, postalCode: e.target.value })} style={inputStyle} /></div>
                    </div>
                    <div className="flex gap-2.5" style={{ marginTop: '22px' }}>
                      <button type="submit" style={emberButton} className="transition-all hover:brightness-110">{editIndex != null ? 'Save Changes' : 'Save Address'}</button>
                      <button type="button" onClick={() => { setAddrFormOpen(false); setEditIndex(null); }} style={ghostButton}>Cancel</button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {tab === 'Profile' && (
              <div style={{ paddingTop: '30px' }}>
                <form onSubmit={saveProfile} style={{ border: '1px solid rgba(245,240,232,0.1)', background: cardBg, padding: '28px', marginBottom: '16px' }}>
                  <h3 style={{ fontFamily: SERIF, fontSize: '23px', fontWeight: 600, marginBottom: '4px', color: '#F5F0E8' }}>Profile details</h3>
                  <p style={{ fontFamily: JOST, fontSize: '12.5px', color: 'rgba(245,240,232,0.38)', marginBottom: '20px' }}>Your name appears on orders and reservations.</p>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div><label style={labelStyle}>Full Name</label><input value={fullName} onChange={(e) => setFullName(e.target.value)} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} /></div>
                    <div><label style={labelStyle}>Email</label><input value={profile?.email ?? ''} disabled style={{ ...inputStyle, opacity: 0.5 }} /><p style={{ fontFamily: JOST, fontSize: '11.5px', color: 'rgba(245,240,232,0.38)', marginTop: '7px' }}>Email is your sign-in and can't be changed here.</p></div>
                  </div>
                  <div style={{ marginTop: '22px' }}><button type="submit" style={emberButton} className="transition-all hover:brightness-110">Save Changes</button></div>
                </form>

                <form onSubmit={changePassword} style={{ border: '1px solid rgba(245,240,232,0.1)', background: cardBg, padding: '28px' }}>
                  <h3 style={{ fontFamily: SERIF, fontSize: '23px', fontWeight: 600, marginBottom: '4px', color: '#F5F0E8' }}>Change password</h3>
                  <p style={{ fontFamily: JOST, fontSize: '12.5px', color: 'rgba(245,240,232,0.38)', marginBottom: '20px' }}>Use at least 8 characters. You'll stay signed in on this device.</p>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div><label style={labelStyle}>New password</label><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={inputStyle} placeholder="••••••••" autoComplete="new-password" /></div>
                    <div><label style={labelStyle}>Confirm new password</label><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={inputStyle} placeholder="••••••••" autoComplete="new-password" /></div>
                  </div>
                  <div style={{ marginTop: '22px' }}><button type="submit" style={ghostButton}>Update Password</button></div>
                </form>
              </div>
            )}

            {tab === 'Leave a Review' && (
              <div style={{ paddingTop: '30px' }}>
                <form onSubmit={submitReview} style={{ border: '1px solid rgba(245,240,232,0.1)', background: cardBg, padding: '28px' }}>
                  <h3 style={{ fontFamily: SERIF, fontSize: '23px', fontWeight: 600, marginBottom: '4px', color: '#F5F0E8' }}>Share your experience</h3>
                  <p style={{ fontFamily: JOST, fontSize: '12.5px', color: 'rgba(245,240,232,0.38)', marginBottom: '20px' }}>Reviews appear on the site after a quick moderation check.</p>
                  <div style={{ marginBottom: '18px' }}>
                    <label style={labelStyle}>Your Rating</label>
                    <div className="flex gap-1.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} stars`} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                          <Star size={26} color="#D9A45B" fill={n <= rating ? '#D9A45B' : 'transparent'} />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ marginBottom: '18px' }}><label style={labelStyle}>Tell us more</label>
                    <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} style={inputStyle} placeholder="The food, the delivery, the little things…" /></div>
                  <div><label style={labelStyle}>Country (optional)</label><input value={country} onChange={(e) => setCountry(e.target.value)} style={inputStyle} /></div>
                  <div style={{ marginTop: '22px' }}><button type="submit" style={emberButton} className="transition-all hover:brightness-110">Submit Review</button></div>
                </form>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
