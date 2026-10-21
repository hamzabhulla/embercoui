import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Heart, LogOut, Plus, Star, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { useCart } from '../context/CartContext.tsx';
import { useCurrency } from '../context/CurrencyContext.tsx';
import { apiRequest } from '../services/api.ts';
import type { MenuItem } from '../data/menu.ts';

interface OrderItem { menuItemId: number | null; name: string; unitPrice: number; quantity: number }
interface Order {
  id: string; status: string; paymentStatus: string; total: number; currency: string; createdAt: string; items: OrderItem[];
}
interface Address { label?: string; line1: string; city: string; postalCode?: string; phone?: string }

const TABS = ['Orders', 'Favorites', 'Addresses', 'Profile', 'Leave a Review'] as const;
type Tab = (typeof TABS)[number];

const statusColor: Record<string, string> = {
  pending: '#C17A3A', confirmed: '#60a5fa', preparing: '#facc15', ready: '#4ade80',
  out_for_delivery: '#a78bfa', delivered: '#22c55e', cancelled: '#ef4444',
};

const headingFont: React.CSSProperties = { fontFamily: 'Cormorant Garamond, serif', fontWeight: 300, color: '#F5F0E8' };
const labelStyle: React.CSSProperties = {
  fontFamily: 'Jost, sans-serif', textTransform: 'uppercase', letterSpacing: '0.12em',
  fontSize: '10px', color: '#C17A3A', display: 'block', marginBottom: '6px',
};
const inputStyle: React.CSSProperties = {
  fontFamily: 'Jost, sans-serif', fontSize: '14px', color: '#F5F0E8', background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.12)', padding: '10px 12px', width: '100%', outline: 'none',
};
const emberButton: React.CSSProperties = {
  background: '#C17A3A', color: 'white', textTransform: 'uppercase', letterSpacing: '0.18em',
  fontFamily: 'Jost, sans-serif', fontSize: '11px', padding: '14px 28px',
};
const cardStyle: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' };

export default function Account() {
  const { format } = useCurrency();
  const navigate = useNavigate();
  const { user, profile, loading, signOut, refreshProfile } = useAuth();
  const { addItem } = useCart();
  const [tab, setTab] = useState<Tab>('Orders');
  const [orders, setOrders] = useState<Order[]>([]);
  const [favorites, setFavorites] = useState<MenuItem[]>([]);
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

  // address form
  const [addr, setAddr] = useState<Address>({ label: '', line1: '', city: '', postalCode: '' });
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
    if (tab === 'Orders') void loadOrders();
    if (tab === 'Favorites') void loadFavorites();
  }, [user, tab, loadOrders, loadFavorites]);

  const flash = (msg: string) => { setNotice(msg); setError(null); setTimeout(() => setNotice(null), 3500); };
  const fail = (msg: string | null) => setError(msg ?? 'Something went wrong — please try again');

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await apiRequest('/api/v1/account/profile', { method: 'PATCH', body: JSON.stringify({ fullName, phone }) });
    if (res.ok) { await refreshProfile(); flash('Profile saved.'); } else fail(res.error);
  };

  const saveAddresses = async (next: Address[]): Promise<boolean> => {
    const res = await apiRequest('/api/v1/account/profile', { method: 'PATCH', body: JSON.stringify({ addresses: next }) });
    if (res.ok) { await refreshProfile(); flash('Addresses updated.'); return true; }
    fail(res.error);
    return false;
  };

  const addAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addr.line1 || !addr.city) { fail('Please add an address line and city.'); return; }
    const saved = await saveAddresses([...addresses, addr]);
    if (saved) setAddr({ label: '', line1: '', city: '', postalCode: '' });
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
          <p className="uppercase mb-3" style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px', letterSpacing: '0.25em', color: '#C17A3A' }}>✦ &nbsp; My Account</p>
          <h1 className="mb-4" style={{ ...headingFont, fontSize: '36px' }}>Sign in to view your account</h1>
          <p className="mb-8" style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: 'rgba(245,240,232,0.55)', lineHeight: 1.7 }}>
            Your orders, saved dishes and addresses live here once you are signed in.
          </p>
          <button onClick={() => navigate('/login')} style={emberButton} className="transition-all duration-300 hover:brightness-110">
            Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-[110px] pb-24 px-6" style={{ background: '#0D1A0E' }}>
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-2">
          <div>
            <p className="uppercase mb-2" style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px', letterSpacing: '0.25em', color: '#C17A3A' }}>✦ &nbsp; My Account</p>
            <h1 style={{ ...headingFont, fontSize: '40px', lineHeight: 1 }}>
              {profile?.fullName ? `Welcome, ${profile.fullName.split(' ')[0]}` : 'Welcome'}
            </h1>
          </div>
          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 transition-colors hover:text-white"
            style={{ fontFamily: 'Jost, sans-serif', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(245,240,232,0.5)' }}
          >
            <LogOut size={14} /> Sign Out
          </button>
        </div>
        <p className="mb-10" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: 'rgba(245,240,232,0.4)' }}>{profile?.email}</p>

        <div className="flex gap-2 overflow-x-auto no-scrollbar mb-8">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-shrink-0 px-5 py-2 transition-all duration-200"
              style={{
                fontFamily: 'Jost, sans-serif', fontSize: '0.7rem', letterSpacing: '0.15em', textTransform: 'uppercase',
                background: tab === t ? '#C17A3A' : 'transparent', color: tab === t ? '#fff' : 'rgba(245,240,232,0.55)',
                border: `1px solid ${tab === t ? '#C17A3A' : 'rgba(255,255,255,0.15)'}`,
              }}
            >
              {t}
            </button>
          ))}
        </div>

        {notice && (
          <div className="flex items-center gap-2 mb-6 px-4 py-3" style={{ background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)' }}>
            <Check size={14} color="#4ade80" />
            <span style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: '#4ade80' }}>{notice}</span>
          </div>
        )}
        {error && (
          <p className="text-[#ef4444] mb-6" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px' }}>{error}</p>
        )}

        {tab === 'Orders' && (
          <div className="flex flex-col gap-4">
            {dataLoading && <p style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: 'rgba(245,240,232,0.4)' }}>Loading your orders…</p>}
            {!dataLoading && orders.length === 0 && (
              <p style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: 'rgba(245,240,232,0.4)' }}>
                No orders yet — your order history will appear here.
              </p>
            )}
            {orders.map((order) => (
              <div key={order.id} className="p-5" style={cardStyle}>
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <span style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: '#F5F0E8' }}>
                    Order #{order.id.slice(0, 8)} · {new Date(order.createdAt).toLocaleDateString()}
                  </span>
                  <span
                    className="px-3 py-1"
                    style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: statusColor[order.status] ?? '#F5F0E8', border: `1px solid ${statusColor[order.status] ?? '#888'}` }}
                  >
                    {order.status.replace(/_/g, ' ')}
                  </span>
                </div>
                <p className="mb-3" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: 'rgba(245,240,232,0.55)' }}>
                  {order.items.map((i) => `${i.quantity} × ${i.name}`).join(' · ')}
                </p>
                <div className="flex items-center justify-between">
                  <span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '20px', color: '#C17A3A' }}>{format(order.total, order.currency)}</span>
                  <button
                    onClick={() => navigate(`/track-order/${order.id}`)}
                    style={{ fontFamily: 'Jost, sans-serif', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#C17A3A' }}
                  >
                    Track Order →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'Favorites' && (
          <div>
            {favorites.length === 0 && (
              <p style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: 'rgba(245,240,232,0.4)' }}>
                No saved dishes yet. Tap the heart on any dish while signed in — or add from the menu below.
              </p>
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {favorites.map((item) => (
                <div key={item.id} style={cardStyle}>
                  <div className="h-36 overflow-hidden">
                    <img src={item.image} alt={item.name} className="w-full h-full object-cover" loading="lazy" />
                  </div>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <h3 style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '18px', color: '#F5F0E8' }}>{item.name}</h3>
                      <button onClick={() => toggleFavorite(item)} aria-label="Remove from favorites" className="transition-colors hover:opacity-70">
                        <Heart size={16} color="#ef4444" fill="#ef4444" />
                      </button>
                    </div>
                    <p className="mb-3" style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: '#C17A3A' }}>{format(item.price)}</p>
                    <button
                      onClick={() => addItem({ id: item.id, name: item.name, price: item.price, image: item.image })}
                      className="w-full transition-all duration-300 hover:brightness-110"
                      style={{ ...emberButton, padding: '10px 0' }}
                    >
                      <span className="inline-flex items-center gap-1"><Plus size={13} /> Add to Cart</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'Addresses' && (
          <div className="grid md:grid-cols-2 gap-8">
            <div className="flex flex-col gap-3">
              {addresses.length === 0 && (
                <p style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: 'rgba(245,240,232,0.4)' }}>No saved addresses yet.</p>
              )}
              {addresses.map((a, i) => (
                <div key={i} className="p-4 flex items-start justify-between gap-3" style={cardStyle}>
                  <div>
                    {a.label && <p style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#C17A3A' }}>{a.label}</p>}
                    <p style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: '#F5F0E8' }}>{a.line1}</p>
                    <p style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: 'rgba(245,240,232,0.5)' }}>{a.city}{a.postalCode ? ` · ${a.postalCode}` : ''}</p>
                  </div>
                  <button onClick={() => saveAddresses(addresses.filter((_, x) => x !== i))} aria-label="Delete address" className="hover:opacity-70">
                    <Trash2 size={15} color="#ef4444" />
                  </button>
                </div>
              ))}
            </div>
            <form onSubmit={addAddress} className="flex flex-col gap-4">
              <div><label style={labelStyle}>Label (optional)</label><input value={addr.label} onChange={(e) => setAddr({ ...addr, label: e.target.value })} style={inputStyle} placeholder="Home" /></div>
              <div><label style={labelStyle}>Address Line</label><input value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} style={inputStyle} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div><label style={labelStyle}>City</label><input value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} style={inputStyle} /></div>
                <div><label style={labelStyle}>Postal Code</label><input value={addr.postalCode} onChange={(e) => setAddr({ ...addr, postalCode: e.target.value })} style={inputStyle} /></div>
              </div>
              <button type="submit" style={emberButton} className="transition-all duration-300 hover:brightness-110 self-start">Save Address</button>
            </form>
          </div>
        )}

        {tab === 'Profile' && (
          <form onSubmit={saveProfile} className="max-w-md flex flex-col gap-5">
            <div><label style={labelStyle}>Email</label><input value={profile?.email ?? ''} disabled style={{ ...inputStyle, opacity: 0.5 }} /></div>
            <div><label style={labelStyle}>Full Name</label><input value={fullName} onChange={(e) => setFullName(e.target.value)} style={inputStyle} /></div>
            <div><label style={labelStyle}>Phone</label><input value={phone} onChange={(e) => setPhone(e.target.value)} style={inputStyle} /></div>
            <button type="submit" style={emberButton} className="transition-all duration-300 hover:brightness-110 self-start">Save Profile</button>
          </form>
        )}

        {tab === 'Leave a Review' && (
          <form onSubmit={submitReview} className="max-w-lg flex flex-col gap-5">
            <div>
              <label style={labelStyle}>Your Rating</label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" onClick={() => setRating(n)} aria-label={`${n} stars`}>
                    <Star size={22} color="#C17A3A" fill={n <= rating ? '#C17A3A' : 'transparent'} />
                  </button>
                ))}
              </div>
            </div>
            <div><label style={labelStyle}>Your Experience</label>
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} style={inputStyle} placeholder="Tell us about your visit…" /></div>
            <div><label style={labelStyle}>Country (optional)</label><input value={country} onChange={(e) => setCountry(e.target.value)} style={inputStyle} /></div>
            <button type="submit" style={emberButton} className="transition-all duration-300 hover:brightness-110 self-start">Submit Review</button>
            <p style={{ fontFamily: 'Jost, sans-serif', fontSize: '11px', color: 'rgba(245,240,232,0.35)' }}>
              Reviews appear on the site after a quick moderation check.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
