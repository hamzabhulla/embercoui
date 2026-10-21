import { useEffect, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import { useAuth } from '../../context/AuthContext';
import { Avatar, Card, EmptyNote, ErrorNote, LoadingNote, NoticeNote, PageTitle, fmtDate, tableCls, tdCls, thCls } from '../../components/admin/ui';

interface Person { id: string; email: string | null; fullName: string | null; role: string; createdAt: string }
const ROLES = ['customer', 'staff', 'admin'];

export default function AdminStaff() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState<Person[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loaded, setLoaded] = useState(false);
  const load = () => { adminGet<{ staff: Person[] }>('/api/v1/admin/staff').then((d) => setRows(d.staff)).catch((e: Error) => setError(e.message)).finally(() => setLoaded(true)); };
  useEffect(load, []);
  const changeRole = async (id: string, role: string) => {
    setError(''); setNotice('');
    try {
      await adminSend('PATCH', `/api/v1/admin/staff/${id}/role`, { role });
      setNotice('Role updated.'); load();
    } catch (e) { setError((e as Error).message); }
  };
  return (
    <div>
      <PageTitle sub="Everyone with an account. Admins can promote customers to staff or admin.">Staff</PageTitle>
      {error && <ErrorNote message={error} />}
      {notice && <NoticeNote message={notice} />}
      {!isAdmin && <p className="font-bodytext text-[13.5px] text-[#5C665C] mb-6">Only admins can change roles.</p>}
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
                        <select aria-label={`Role for ${p.email ?? p.id}`} value={p.role}
                          onChange={(e) => void changeRole(p.id, e.target.value)}
                          className="bg-white border border-[#EAE3D3] rounded-[9px] px-3 py-2 font-bodytext text-[12.5px] capitalize focus:outline-none focus:border-[#C17A3A] cursor-pointer">
                          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
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
    </div>
  );
}
