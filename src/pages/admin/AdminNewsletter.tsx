import { useEffect, useState } from 'react';
import { adminDownloadCsv, adminGet } from '../../services/adminApi';
import { useAuth } from '../../context/AuthContext';
import { AdminsOnly, Card, EmptyNote, ErrorNote, LoadingNote, PageTitle, StatCard, fmtDate, ghostBtn, primaryBtn, tableCls, tdCls, thCls } from '../../components/admin/ui';

interface Sub { email: string; createdAt: string }

const PAGE_SIZE = 100;

export default function AdminNewsletter() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState<Sub[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!isAdmin) return;
    adminGet<{ subscribers: Sub[]; total: number }>(`/api/v1/admin/newsletter?limit=${PAGE_SIZE}&offset=0`)
      .then((d) => { setRows(d.subscribers); setTotal(d.total); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
  }, [isAdmin]);
  const loadMore = () => {
    setLoadingMore(true);
    adminGet<{ subscribers: Sub[]; total: number }>(`/api/v1/admin/newsletter?limit=${PAGE_SIZE}&offset=${rows.length}`)
      .then((d) => { setRows((prev) => [...prev, ...d.subscribers]); setTotal(d.total); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingMore(false));
  };
  const download = async () => {
    try { await adminDownloadCsv('/api/v1/admin/newsletter.csv'); }
    catch (e) { setError((e as Error).message); }
  };
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const newThisWeek = rows.filter((s) => new Date(s.createdAt).getTime() >= weekAgo).length;
  if (!isAdmin) return <AdminsOnly />;
  return (
    <div>
      <PageTitle sub={`${total} subscribers`} actions={<button className={primaryBtn} onClick={() => void download()}>Export CSV</button>}>Newsletter</PageTitle>
      {error && <ErrorNote message={error} />}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mb-6 max-w-xl">
        <StatCard label="Subscribers" value={total} />
        <StatCard label="New this week" value={newThisWeek} />
      </div>
      <Card className="overflow-hidden">
        {!loaded && !error && <LoadingNote />}
        {loaded && rows.length === 0 && !error && <EmptyNote message="No subscribers yet." />}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead><tr><th className={thCls}>Subscriber</th><th className={`${thCls} text-right`}>Joined</th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.email} className="hover:bg-[#FDFBF7]">
                    <td className={tdCls}>{s.email}</td>
                    <td className={`${tdCls} text-right text-[#5C665C] whitespace-nowrap`}>{fmtDate(s.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {loaded && total > 0 && (
        <p className="font-bodytext text-[12.5px] text-[#98A096] mt-4">Showing {rows.length} of {total} subscribers</p>
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
