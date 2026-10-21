import { useEffect, useState } from 'react';
import { adminGet } from '../../services/adminApi';
import { Card, CardHead, EmptyNote, ErrorNote, LoadingNote, PageTitle, StatCard, money, tableCls, tdCls, thCls } from '../../components/admin/ui';

interface Finance {
  currency: string;
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
  const chartDays = data ? [...data.byDay].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-7) : [];
  const chartMax = Math.max(1, ...chartDays.map((d) => d.revenue));
  const daysDesc = data ? [...data.byDay].sort((a, b) => (a.date < b.date ? 1 : -1)) : [];
  return (
    <div>
      <PageTitle sub="Revenue counts paid orders only">Finance</PageTitle>
      {error && <ErrorNote message={error} />}
      {!data && !error && <LoadingNote />}
      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mb-6">
            <StatCard label="Total revenue" value={money(data.totalRevenue, data.currency)} foot={`Paid orders in ${data.currency} only`} />
            <StatCard label="Paid orders" value={data.totalPaidOrders} foot={`In ${data.currency}`} />
            <StatCard label="Average order value" value={money(data.averageOrderValue, data.currency)} />
          </div>
          <div className="grid lg:grid-cols-2 gap-5 items-start mb-5">
            <Card>
              <CardHead title="Revenue · last 7 days" right={<span className="font-bodytext text-[12.5px] text-[#8A551F] font-semibold">{money(chartDays.reduce((s, d) => s + d.revenue, 0), data.currency)}</span>} />
              {chartDays.length === 0 ? <EmptyNote message="No paid orders yet." /> : (
                <div className="px-[18px] pb-4">
                  <div className="flex items-end gap-2 h-[92px]">
                    {chartDays.map((d) => (
                      <div key={d.date} title={`${d.date}: ${money(d.revenue, data.currency)} · ${d.orders} orders`}
                        className={`flex-1 rounded-t-md min-h-[4px] ${d === chartDays[chartDays.length - 1] ? 'bg-[linear-gradient(180deg,#C98A44,#A66932)]' : 'bg-[#EFE3CB]'}`}
                        style={{ height: `${Math.max(4, (d.revenue / chartMax) * 100)}%` }} />
                    ))}
                  </div>
                  <div className="flex gap-2 mt-2">
                    {chartDays.map((d) => (
                      <span key={d.date} className="flex-1 text-center font-bodytext text-[10.5px] text-[#98A096]">
                        {new Date(`${d.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </Card>
            <Card className="overflow-hidden">
              <CardHead title="Revenue by month" />
              {data.byMonth.length === 0 ? <EmptyNote message="No paid orders yet." /> : (
                <table className={tableCls}>
                  <thead><tr><th className={thCls}>Month</th><th className={thCls}>Orders</th><th className={`${thCls} text-right`}>Revenue</th></tr></thead>
                  <tbody>
                    {data.byMonth.map((m) => (
                      <tr key={m.month} className="hover:bg-[#FDFBF7]">
                        <td className={tdCls}>{m.month}</td>
                        <td className={tdCls}>{m.orders}</td>
                        <td className={`${tdCls} text-right font-semibold`}>{money(m.revenue, data.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>
          <Card className="overflow-hidden">
            <CardHead title="Revenue by day (last 30 days)" />
            {daysDesc.length === 0 ? <EmptyNote message="No paid orders yet." /> : (
              <table className={tableCls}>
                <thead><tr><th className={thCls}>Date</th><th className={thCls}>Orders</th><th className={`${thCls} text-right`}>Revenue</th></tr></thead>
                <tbody>
                  {daysDesc.map((d) => (
                    <tr key={d.date} className="hover:bg-[#FDFBF7]">
                      <td className={tdCls}>{d.date}</td>
                      <td className={tdCls}>{d.orders}</td>
                      <td className={`${tdCls} text-right font-semibold`}>{money(d.revenue, data.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
