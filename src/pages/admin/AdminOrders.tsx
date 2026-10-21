import { useCallback, useEffect, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import { Card, EmptyNote, ErrorNote, FChip, LoadingNote, PageTitle, StatusPill, chipBtn, chipDangerBtn, fmtDate, money } from '../../components/admin/ui';

interface Order {
  id: string; customerName: string; customerEmail: string; customerPhone: string | null;
  status: string; paymentStatus: string; subtotal: number; discount: number; deliveryFee: number; total: number;
  currency: string;
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
const chipLabel = (s: string) => (s === 'all' ? 'All' : s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()));

export default function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(() => {
    const q = filter === 'all' ? '' : `?status=${filter}`;
    adminGet<{ orders: Order[] }>(`/api/v1/admin/orders${q}`)
      .then((d) => setOrders(d.orders))
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
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
      <div className="flex flex-wrap gap-2 mb-5">
        {STATUSES.map((s) => (
          <FChip key={s} active={filter === s} onClick={() => setFilter(s)}>{chipLabel(s)}</FChip>
        ))}
      </div>
      {error && <ErrorNote message={error} />}
      {!loaded && !error && <LoadingNote />}
      {loaded && orders.length === 0 && !error && <EmptyNote message="No orders in this view." />}
      <div className="space-y-3.5">
        {orders.map((o) => (
          <Card key={o.id} className="px-5 py-[18px]">
            <div className="flex flex-wrap justify-between gap-3 mb-2.5">
              <div>
                <p className="font-bodytext text-[14.5px] font-semibold text-[#16241A]">{o.customerName} <span className="font-normal text-[#98A096] text-[12.5px]">· {o.customerEmail}{o.customerPhone ? ` · ${o.customerPhone}` : ''}</span></p>
                <p className="font-bodytext text-[12px] text-[#98A096] mt-0.5">{fmtDate(o.createdAt)} · <span className="text-[#8A551F] font-semibold">#{o.id.slice(0, 8)}</span></p>
              </div>
              <div className="flex gap-1.5 items-start"><StatusPill status={o.status} /><StatusPill status={o.paymentStatus} /></div>
            </div>
            <ul className="font-bodytext text-[13.5px] text-[#5C665C] mb-3 space-y-0.5">
              {o.items.map((i, idx) => <li key={idx}>{i.quantity} × {i.name} — {money(i.unitPrice * i.quantity, o.currency)}</li>)}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EFE9DB] pt-3">
              <p className="font-bodytext text-[13.5px] text-[#5C665C]">Total <span className="text-[#8A551F] font-semibold text-[15px]">{money(o.total, o.currency)}</span>{o.discount > 0 && <span className="text-[#2E7D4F]"> (−{money(o.discount, o.currency)})</span>}</p>
              <div className="flex gap-2 flex-wrap">
                {(NEXT[o.status] ?? []).map((s) => (
                  <button key={s} disabled={busyId === o.id} onClick={() => void setStatus(o.id, s)}
                    className={s === 'cancelled' ? chipDangerBtn : chipBtn}>
                    {s.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
