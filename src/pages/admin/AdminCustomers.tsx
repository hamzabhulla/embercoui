import { useEffect, useState } from 'react';
import { adminGet } from '../../services/adminApi';
import { useAuth } from '../../context/AuthContext';
import { useCurrency } from '../../context/CurrencyContext';
import { AdminsOnly, Avatar, Card, EmptyNote, ErrorNote, LoadingNote, PageTitle, ghostBtn, money, tableCls, tdCls, thCls } from '../../components/admin/ui';

interface Customer { id: string; email: string | null; fullName: string | null; phone: string | null; role: string; createdAt: string; orderCount: number; totalSpent: number }

const PAGE_SIZE = 100;

export default function AdminCustomers() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const { currency } = useCurrency();
  useEffect(() => {
    if (!isAdmin) return;
    adminGet<{ customers: Customer[]; total: number }>(`/api/v1/admin/customers?limit=${PAGE_SIZE}&offset=0`)
      .then((d) => { setRows(d.customers); setTotal(d.total); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
  }, [isAdmin]);
  const loadMore = () => {
    setLoadingMore(true);
    adminGet<{ customers: Customer[]; total: number }>(`/api/v1/admin/customers?limit=${PAGE_SIZE}&offset=${rows.length}`)
      .then((d) => { setRows((prev) => [...prev, ...d.customers]); setTotal(d.total); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingMore(false));
  };
  if (!isAdmin) return <AdminsOnly />;
  return (
    <div>
      <PageTitle sub={`Registered customers · lifetime spend shown in ${currency}`}>Customers</PageTitle>
      {error && <ErrorNote message={error} />}
      <Card className="overflow-hidden">
        {!loaded && !error && <LoadingNote />}
        {loaded && rows.length === 0 && !error && <EmptyNote message="No customers yet." />}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead>
                <tr><th className={thCls}>Customer</th><th className={thCls}>Contact</th><th className={thCls}>Joined</th><th className={thCls}>Orders</th><th className={`${thCls} text-right`}>Total Spent</th></tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id} className="hover:bg-[#FDFBF7]">
                    <td className={tdCls}>
                      <span className="flex items-center gap-2.5"><Avatar name={c.fullName ?? c.email ?? '?'} /><span><b className="font-semibold block">{c.fullName ?? '—'}</b><span className="block text-[12px] text-[#98A096] capitalize">{c.role}</span></span></span>
                    </td>
                    <td className={`${tdCls} text-[#5C665C]`}>{c.email ?? ''}<span className="block text-[12.5px] text-[#98A096]">{c.phone ?? 'No phone'}</span></td>
                    <td className={`${tdCls} text-[#5C665C] whitespace-nowrap`}>{new Date(c.createdAt).toLocaleDateString()}</td>
                    <td className={`${tdCls} font-semibold`}>{c.orderCount}</td>
                    <td className={`${tdCls} text-right font-semibold [font-variant-numeric:tabular-nums]`}>{money(c.totalSpent, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {loaded && total > 0 && (
        <p className="font-bodytext text-[12.5px] text-[#98A096] mt-4">Showing {rows.length} of {total} customers</p>
      )}
      {loaded && rows.length < total && (
        <div className="mt-3">
          <button type="button" className={ghostBtn} disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
