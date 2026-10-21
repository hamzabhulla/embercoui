import { useEffect, useState } from 'react';
import { adminGet } from '../../services/adminApi';
import { ErrorNote, LoadingNote, PageTitle, StatCard, StatusPill, fmtDate, money } from '../../components/admin/ui';

interface DashData {
  stats: { revenue: number; totalOrders: number; pendingOrders: number; ordersByStatus: Record<string, number>; customers: number; pendingReservations: number };
  recentOrders: { id: string; customerName: string; total: number; status: string; paymentStatus: string; createdAt: string }[];
}

export default function AdminDashboard() {
  const [data, setData] = useState<DashData | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    adminGet<DashData>('/api/v1/admin/dashboard')
      .then((d) => { if (active) setData(d); })
      .catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, []);
  return (
    <div>
      <PageTitle sub="Live numbers from your restaurant's orders">Dashboard</PageTitle>
      {error && <ErrorNote message={error} />}
      {!data && !error && <LoadingNote />}
      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            <StatCard label="Revenue (paid)" value={money(data.stats.revenue)} />
            <StatCard label="Total orders" value={data.stats.totalOrders} />
            <StatCard label="Pending orders" value={data.stats.pendingOrders} />
            <StatCard label="Customers" value={data.stats.customers} />
            <StatCard label="Pending reservations" value={data.stats.pendingReservations} />
            {Object.entries(data.stats.ordersByStatus).map(([status, count]) => (
              <StatCard key={status} label={status.replace(/_/g, ' ')} value={count} />
            ))}
          </div>
          <h2 className="font-display text-2xl mb-4">Recent orders</h2>
          {data.recentOrders.length === 0 ? (
            <p className="font-bodytext text-sm text-[#F5F0E8]/50">No orders yet.</p>
          ) : (
            <div className="space-y-3">
              {data.recentOrders.map((o) => (
                <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 bg-[#1C2B1E] border border-white/10 px-5 py-4">
                  <div>
                    <p className="font-bodytext text-sm">{o.customerName}</p>
                    <p className="font-bodytext text-xs text-[#F5F0E8]/45">{fmtDate(o.createdAt)} · {money(o.total)}</p>
                  </div>
                  <div className="flex gap-2"><StatusPill status={o.status} /><StatusPill status={o.paymentStatus} /></div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
