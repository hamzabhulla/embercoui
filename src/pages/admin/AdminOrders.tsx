import { useCallback, useEffect, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import { ErrorNote, LoadingNote, PageTitle, StatusPill, fmtDate, money } from '../../components/admin/ui';

interface Order {
  id: string; customerName: string; customerEmail: string; customerPhone: string | null;
  status: string; paymentStatus: string; subtotal: number; discount: number; deliveryFee: number; total: number;
  items: { name: string; quantity: number; unitPrice: number }[]; createdAt: string;
}
const STATUSES = ['all', 'pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'cancelled'];
const NEXT: Record<string, string[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'delivered'],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: [],
};

export default function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  const load = useCallback(() => {
    const q = filter === 'all' ? '' : `?status=${filter}`;
    adminGet<{ orders: Order[] }>(`/api/v1/admin/orders${q}`)
      .then((d) => setOrders(d.orders))
      .catch((e: Error) => setError(e.message));
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: string, status: string) => {
    setBusyId(id); setError('');
    try {
      await adminSend('PATCH', `/api/v1/admin/orders/${id}/status`, { status });
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusyId(''); }
  };

  return (
    <div>
      <PageTitle sub="Status changes save instantly and update the customer's tracking page">Orders</PageTitle>
      <div className="flex flex-wrap gap-2 mb-6">
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 font-bodytext text-[10px] tracking-[0.15em] uppercase border transition-colors ${filter === s ? 'bg-[#C17A3A] border-[#C17A3A] text-white' : 'border-white/20 text-[#F5F0E8]/60 hover:bg-white/5'}`}>
            {s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>
      {error && <ErrorNote message={error} />}
      {orders.length === 0 && !error && <LoadingNote />}
      <div className="space-y-4">
        {orders.map((o) => (
          <div key={o.id} className="bg-[#1C2B1E] border border-white/10 p-5">
            <div className="flex flex-wrap justify-between gap-3 mb-3">
              <div>
                <p className="font-bodytext text-sm font-medium">{o.customerName} <span className="text-[#F5F0E8]/45">· {o.customerEmail}{o.customerPhone ? ` · ${o.customerPhone}` : ''}</span></p>
                <p className="font-bodytext text-xs text-[#F5F0E8]/45">{fmtDate(o.createdAt)} · #{o.id.slice(0, 8)}</p>
              </div>
              <div className="flex gap-2 items-start"><StatusPill status={o.status} /><StatusPill status={o.paymentStatus} /></div>
            </div>
            <ul className="font-bodytext text-sm text-[#F5F0E8]/70 mb-3">
              {o.items.map((i, idx) => <li key={idx}>{i.quantity} × {i.name} — {money(i.unitPrice * i.quantity)}</li>)}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-bodytext text-sm">Total <span className="text-[#C17A3A] font-medium">{money(o.total)}</span>{o.discount > 0 && <span className="text-[#4ade80]"> (−{money(o.discount)})</span>}</p>
              <div className="flex gap-2">
                {(NEXT[o.status] ?? []).map((s) => (
                  <button key={s} disabled={busyId === o.id} onClick={() => void setStatus(o.id, s)}
                    className={`px-3 py-1.5 font-bodytext text-[10px] tracking-[0.15em] uppercase transition-colors disabled:opacity-50 ${s === 'cancelled' ? 'border border-[#ef4444]/50 text-[#ef4444] hover:bg-[#ef4444]/10' : 'bg-[#C17A3A] hover:bg-[#A66932] text-white'}`}>
                    {s.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
