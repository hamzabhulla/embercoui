import { useEffect, useState } from 'react';
import { adminGet } from '../../services/adminApi';
import { Avatar, Card, CardHead, EmptyNote, ErrorNote, LoadingNote, PageTitle, StatCard, StatusPill, fmtDate, money, tableCls, tdCls, thCls } from '../../components/admin/ui';

interface DashData {
  currency: string;
  // Section-assembled on the backend (Phase A): a block is present
  // only when the caller may view its section — revenue rides on
  // finance, order figures on orders, the customer count on customers,
  // pending reservations on reservations. Absent blocks render nothing.
  stats: { revenue?: number; totalOrders?: number; pendingOrders?: number; ordersByStatus?: Record<string, number>; customers?: number; pendingReservations?: number };
  recentOrders?: { id: string; customerName: string; total: number; status: string; paymentStatus: string; createdAt: string; currency: string }[];
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
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5 mb-6">
            {data.stats.revenue !== undefined && <StatCard label={`Revenue (paid) · ${data.currency}`} value={money(data.stats.revenue, data.currency)} foot="Paid orders in this currency only" />}
            {data.stats.totalOrders !== undefined && <StatCard label="Total orders" value={data.stats.totalOrders} />}
            {data.stats.pendingOrders !== undefined && <StatCard label="Pending orders" value={data.stats.pendingOrders} foot="Waiting to be confirmed" />}
            {data.stats.customers !== undefined && <StatCard label="Customers" value={data.stats.customers} />}
            {data.stats.pendingReservations !== undefined && <StatCard label="Pending reservations" value={data.stats.pendingReservations} foot="Bookings to confirm" />}
            {/* 'pending' is skipped here: it already has the dedicated
                "Pending orders" card above, and showing the same number
                twice made the grid look padded (audit fix 15). */}
            {Object.entries(data.stats.ordersByStatus ?? {})
              .filter(([status]) => status !== 'pending')
              .map(([status, count]) => (
                <StatCard key={status} label={status.replace(/_/g, ' ')} value={count} />
              ))}
          </div>
          {Object.keys(data.stats).length === 0 && (
            <EmptyNote message="Nothing to show yet — the owner has not granted your account any dashboard sections." />
          )}
          {data.recentOrders && (
          <Card>
            <CardHead title="Recent orders" />
            {data.recentOrders.length === 0 ? (
              <EmptyNote message="No orders yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className={tableCls}>
                  <thead>
                    <tr><th className={thCls}>Order</th><th className={thCls}>Customer</th><th className={thCls}>Date</th><th className={thCls}>Status</th><th className={`${thCls} text-right`}>Total</th></tr>
                  </thead>
                  <tbody>
                    {data.recentOrders.map((o) => (
                      <tr key={o.id} className="hover:bg-[#FDFBF7]">
                        <td className={`${tdCls} font-semibold text-[#8A551F]`}>#{o.id.slice(0, 8)}</td>
                        <td className={tdCls}>
                          <span className="flex items-center gap-2.5"><Avatar name={o.customerName} /><b className="font-semibold">{o.customerName}</b></span>
                        </td>
                        <td className={`${tdCls} text-[#5C665C] whitespace-nowrap`}>{fmtDate(o.createdAt)}</td>
                        <td className={tdCls}><span className="flex gap-1.5 flex-wrap"><StatusPill status={o.status} /><StatusPill status={o.paymentStatus} /></span></td>
                        <td className={`${tdCls} text-right font-semibold [font-variant-numeric:tabular-nums]`}>{money(o.total, o.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          )}
        </>
      )}
    </div>
  );
}
