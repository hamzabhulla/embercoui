import { useEffect, useState } from 'react';
import { adminGet } from '../../services/adminApi';
import { ErrorNote, LoadingNote, PageTitle, StatCard, money } from '../../components/admin/ui';

interface Finance {
  totalRevenue: number; totalPaidOrders: number; averageOrderValue: number;
  byDay: { date: string; revenue: number; orders: number }[];
  byMonth: { month: string; revenue: number; orders: number }[];
}

export default function AdminFinance() {
  const [data, setData] = useState<Finance | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    adminGet<Finance>('/api/v1/admin/finance').then(setData).catch((e: Error) => setError(e.message));
  }, []);
  return (
    <div>
      <PageTitle sub="Revenue counts paid orders only">Finance</PageTitle>
      {error && <ErrorNote message={error} />}
      {!data && !error && <LoadingNote />}
      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
            <StatCard label="Total revenue" value={money(data.totalRevenue)} />
            <StatCard label="Paid orders" value={data.totalPaidOrders} />
            <StatCard label="Average order value" value={money(data.averageOrderValue)} />
          </div>
          <h2 className="font-display text-2xl mb-4">Revenue by month</h2>
          <div className="space-y-2 mb-10">
            {data.byMonth.length === 0 && <p className="font-bodytext text-sm text-[#F5F0E8]/50">No paid orders yet.</p>}
            {data.byMonth.map((m) => (
              <div key={m.month} className="flex justify-between bg-[#1C2B1E] border border-white/10 px-5 py-3">
                <span className="font-bodytext text-sm">{m.month}</span>
                <span className="font-bodytext text-sm">{m.orders} orders · <span className="text-[#C17A3A]">{money(m.revenue)}</span></span>
              </div>
            ))}
          </div>
          <h2 className="font-display text-2xl mb-4">Revenue by day (last 30 days)</h2>
          <div className="space-y-2">
            {data.byDay.map((d) => (
              <div key={d.date} className="flex justify-between bg-[#1C2B1E] border border-white/10 px-5 py-3">
                <span className="font-bodytext text-sm">{d.date}</span>
                <span className="font-bodytext text-sm">{d.orders} orders · <span className="text-[#C17A3A]">{money(d.revenue)}</span></span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
