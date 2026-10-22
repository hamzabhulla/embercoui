import { useCallback, useEffect, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import { useAuth } from '../../context/AuthContext';
import { AdminsOnly, Avatar, Card, EmptyNote, ErrorNote, LoadingNote, NoticeNote, PageTitle, fmtDate, ghostBtn, tableCls, tdCls, thCls } from '../../components/admin/ui';

interface Person { id: string; email: string | null; fullName: string | null; role: string; createdAt: string }
const ROLES = ['customer', 'staff', 'admin'];
const PAGE_SIZE = 100;

export default function AdminStaff() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState<Person[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const fetchPage = useCallback((offset: number, append: boolean) => {
    adminGet<{ staff: Person[]; total: number }>(`/api/v1/admin/staff?limit=${PAGE_SIZE}&offset=${offset}`)
      .then((d) => {
        setTotal(d.total);
        setRows((prev) => (append ? [...prev, ...d.staff] : d.staff));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => { setLoaded(true); setLoadingMore(false); });
  }, []);
  const load = useCallback(() => fetchPage(0, false), [fetchPage]);
  useEffect(() => { if (isAdmin) load(); }, [isAdmin, load]);
  const loadMore = () => { setLoadingMore(true); fetchPage(rows.length, true); };
  const changeRole = async (id: string, role: string) => {
    setError(''); setNotice('');
    try {
      await adminSend('PATCH', `/api/v1/admin/staff/${id}/role`, { role });
      setNotice('Role updated.'); load();
    } catch (e) { setError((e as Error).message); }
  };
  if (!isAdmin) return <AdminsOnly />;
  return (
    <div>
      <PageTitle sub="Everyone with an account. Admins can promote customers to staff or admin.">Staff</PageTitle>
      {error && <ErrorNote message={error} />}
      {notice && <NoticeNote message={notice} />}
      <Card className="overflow-hidden">
        {!loaded && !error && <LoadingNote />}
        {loaded && rows.length === 0 && !error && <EmptyNote message="No accounts yet." />}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead><tr><th className={thCls}>Member</th><th className={thCls}>Email</th><th className={thCls}>Role</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-[#FDFBF7]">
                    <td className={tdCls}>
                      <span className="flex items-center gap-2.5"><Avatar name={p.fullName ?? p.email ?? '?'} /><span><b className="font-semibold block">{p.fullName ?? '—'}</b><span className="block text-[12px] text-[#98A096]">Joined {fmtDate(p.createdAt)}</span></span></span>
                    </td>
                    <td className={`${tdCls} text-[#5C665C]`}>{p.email ?? ''}</td>
                    <td className={tdCls}>
                      {isAdmin ? (
                        <span className="flex flex-col gap-1">
                          <select aria-label={`Role for ${p.email ?? p.id}`} value={p.role}
                            disabled={p.id === profile?.id}
                            onChange={(e) => void changeRole(p.id, e.target.value)}
                            className="bg-white border border-[#EAE3D3] rounded-[9px] px-3 py-2 font-bodytext text-[12.5px] capitalize focus:outline-none focus:border-[#C17A3A] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                            {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                          {p.id === profile?.id && <span className="font-bodytext text-[11px] text-[#98A096]">That's you — another admin must change your role.</span>}
                        </span>
                      ) : (
                        <span className="inline-flex px-2.5 py-[3px] rounded-full bg-[#EFE9DB] text-[#5C665C] font-bodytext text-[11px] font-semibold capitalize">{p.role}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {loaded && total > 0 && (
        <p className="font-bodytext text-[12.5px] text-[#98A096] mt-4">Showing {rows.length} of {total} accounts</p>
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
