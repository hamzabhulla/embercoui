import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check } from 'lucide-react';
import { apiRequest } from '../services/api.ts';
import { supabase } from '../lib/supabase.ts';

interface OrderItem { menuItemId: number | null; name: string; unitPrice: number; quantity: number }
interface Order {
  id: string; status: string; paymentStatus: string;
  subtotal: number; deliveryFee: number; discount: number; total: number;
  items: OrderItem[]; createdAt: string;
  address: { line1?: string; city?: string } | null;
  customerName: string;
}

const STEPS = [
  { key: 'pending', label: 'Order placed' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'out_for_delivery', label: 'On its way' },
  { key: 'delivered', label: 'Delivered' },
];

const paymentText: Record<string, string> = {
  paid: 'Paid',
  pending: 'Payment processing…',
  unpaid: 'Pay on delivery',
  failed: 'Payment failed — please call us so we can help',
  refunded: 'Refunded',
};

export default function TrackOrder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<Order | null>(null);
  const [state, setState] = useState<'loading' | 'found' | 'missing'>('loading');
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!id) return;
    const res = await apiRequest<{ order: Order }>(`/api/v1/orders/${id}`);
    if (res.ok && res.data) {
      setOrder(res.data.order);
      setState('found');
    } else if (!silent) {
      setState('missing');
    }
  }, [id]);

  useEffect(() => {
    window.scrollTo(0, 0);
    void load();
    // Polling fallback — also the only channel for guest orders, whose
    // realtime events are restricted by row-level security.
    const interval = setInterval(() => void load(true), 15000);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (!supabase || !id) return;
    const client = supabase;
    const channel = client
      .channel(`order-tracking-${id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${id}` },
        () => { void load(true); }
      )
      .subscribe();
    channelRef.current = channel;
    return () => { void client.removeChannel(channel); };
  }, [id, load]);

  if (state === 'loading') {
    return (
      <div className="min-h-screen pt-[130px] px-6" style={{ background: '#0D1A0E' }}>
        <div className="max-w-3xl mx-auto animate-pulse">
          <div className="h-9 w-72 mb-8" style={{ background: 'rgba(245,240,232,0.08)' }} />
          <div className="h-52" style={{ background: 'rgba(245,240,232,0.05)' }} />
        </div>
      </div>
    );
  }

  if (state === 'missing' || !order) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 py-24" style={{ background: '#0D1A0E' }}>
        <div className="text-center max-w-md">
          <p className="uppercase mb-3" style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px', letterSpacing: '0.25em', color: '#C17A3A' }}>✦ &nbsp; Order Tracking</p>
          <h1 className="mb-4" style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 300, fontSize: '36px', color: '#F5F0E8' }}>
            We could not find that order
          </h1>
          <p className="mb-8" style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: 'rgba(245,240,232,0.55)', lineHeight: 1.7 }}>
            The link may be incomplete, or the order belongs to another account. If you just placed it, check your email for the tracking link.
          </p>
          <button
            onClick={() => navigate('/')}
            className="transition-all duration-300 hover:brightness-110"
            style={{ background: '#C17A3A', color: 'white', textTransform: 'uppercase', letterSpacing: '0.18em', fontFamily: 'Jost, sans-serif', fontSize: '11px', padding: '16px 36px' }}
          >
            Back to Home
          </button>
        </div>
      </div>
    );
  }

  const stepIndex = STEPS.findIndex((s) => s.key === order.status);
  const cancelled = order.status === 'cancelled';

  return (
    <div className="min-h-screen pt-[110px] pb-24 px-6" style={{ background: '#0D1A0E' }}>
      <div className="max-w-3xl mx-auto">
        <p className="uppercase mb-2" style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px', letterSpacing: '0.25em', color: '#C17A3A' }}>✦ &nbsp; Order Tracking</p>
        <h1 className="mb-2" style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 300, fontSize: '40px', lineHeight: 1, color: '#F5F0E8' }}>
          Order #{order.id.slice(0, 8)}
        </h1>
        <p className="mb-10" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: 'rgba(245,240,232,0.4)' }}>
          Placed {new Date(order.createdAt).toLocaleString()} · Payment: {paymentText[order.paymentStatus] ?? order.paymentStatus}
        </p>

        {cancelled ? (
          <div className="p-5 mb-8" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.35)' }}>
            <p style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: '#ef4444' }}>
              This order was cancelled. If you did not request this, please call us and we will make it right.
            </p>
          </div>
        ) : (
          <div className="mb-10">
            {STEPS.map((step, i) => {
              const done = i < stepIndex;
              const current = i === stepIndex;
              return (
                <div key={step.key} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{
                        background: done || current ? '#C17A3A' : 'transparent',
                        border: `1px solid ${done || current ? '#C17A3A' : 'rgba(255,255,255,0.2)'}`,
                      }}
                    >
                      {done ? <Check size={13} color="#fff" /> : (
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: current ? '#fff' : 'rgba(255,255,255,0.25)', display: 'block' }} />
                      )}
                    </div>
                    {i < STEPS.length - 1 && (
                      <div style={{ width: 1, height: 30, background: done ? '#C17A3A' : 'rgba(255,255,255,0.12)' }} />
                    )}
                  </div>
                  <p
                    className="pt-1"
                    style={{
                      fontFamily: 'Jost, sans-serif', fontSize: '13px', letterSpacing: '0.05em',
                      color: current ? '#F5F0E8' : done ? 'rgba(245,240,232,0.65)' : 'rgba(245,240,232,0.3)',
                      fontWeight: current ? 500 : 300,
                    }}
                  >
                    {step.label}
                    {current && order.status === 'preparing' && ' — the kitchen is working on it'}
                    {current && order.status === 'pending' && ' — we will confirm shortly'}
                  </p>
                </div>
              );
            })}
          </div>
        )}

        <div className="p-6" style={{ background: '#1C2B1E', border: '1px solid rgba(255,255,255,0.08)' }}>
          <h2 className="mb-5" style={{ fontFamily: 'Cormorant Garamond, serif', fontWeight: 300, fontSize: '22px', color: '#F5F0E8' }}>Your Order</h2>
          <div className="flex flex-col gap-3 mb-5">
            {order.items.map((i, idx) => (
              <div key={idx} className="flex justify-between gap-3">
                <span style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: 'rgba(245,240,232,0.7)' }}>{i.quantity} × {i.name}</span>
                <span style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: '#F5F0E8' }}>${(i.unitPrice * i.quantity).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div style={{ height: '1px', background: 'rgba(255,255,255,0.08)', marginBottom: '14px' }} />
          <div className="flex flex-col gap-2">
            <div className="flex justify-between"><span style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: 'rgba(245,240,232,0.5)' }}>Subtotal</span><span style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: '#F5F0E8' }}>${order.subtotal.toFixed(2)}</span></div>
            {order.discount > 0 && <div className="flex justify-between"><span style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: 'rgba(245,240,232,0.5)' }}>Discount</span><span style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: '#4ade80' }}>−${order.discount.toFixed(2)}</span></div>}
            <div className="flex justify-between"><span style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: 'rgba(245,240,232,0.5)' }}>Delivery</span><span style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: '#4ade80' }}>Free</span></div>
            <div className="flex justify-between mt-1"><span style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: '#F5F0E8' }}>Total</span><span style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '22px', color: '#C17A3A' }}>${order.total.toFixed(2)}</span></div>
          </div>
          {order.address?.line1 && (
            <p className="mt-5" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: 'rgba(245,240,232,0.45)' }}>
              Delivering to {order.address.line1}{order.address.city ? `, ${order.address.city}` : ''}
            </p>
          )}
        </div>

        <p className="text-center mt-8" style={{ fontFamily: 'Jost, sans-serif', fontSize: '11px', color: 'rgba(245,240,232,0.3)' }}>
          This page updates automatically as your order moves through the kitchen.
        </p>
      </div>
    </div>
  );
}
