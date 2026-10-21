import { useEffect, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import { useAuth } from '../../context/AuthContext';
import { ErrorNote, LoadingNote, PageTitle, fmtDate } from '../../components/admin/ui';

interface Person { id: string; email: string | null; fullName: string | null; role: string; createdAt: string }
const ROLES = ['customer', 'staff', 'admin'];

export default function AdminStaff() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState<Person[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = () => { adminGet<{ staff: Person[] }>('/api/v1/admin/staff').then((d) => setRows(d.staff)).catch((e: Error) => setError(e.message)); };
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
      {notice && <p className="font-bodytext text-sm text-[#4ade80] mb-4">{notice}</p>}
      {!isAdmin && <p className="font-bodytext text-sm text-[#F5F0E8]/50 mb-6">Only admins can change roles.</p>}
      {rows.length === 0 && !error && <LoadingNote />}
      <div className="space-y-3">
        {rows.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 bg-[#1C2B1E] border border-white/10 px-5 py-4">
            <div>
              <p className="font-bodytext text-sm">{p.fullName ?? '—'} <span className="text-[#F5F0E8]/45">{p.email ?? ''}</span></p>
              <p className="font-bodytext text-xs text-[#F5F0E8]/45">Joined {fmtDate(p.createdAt)}</p>
            </div>
            {isAdmin ? (
              <select aria-label={`Role for ${p.email ?? p.id}`} value={p.role}
                onChange={(e) => void changeRole(p.id, e.target.value)}
                className="bg-white/5 border border-white/15 px-3 py-2 font-bodytext text-xs uppercase tracking-[0.15em] focus:outline-none focus:border-[#C17A3A]">
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            ) : (
              <span className="font-bodytext text-xs uppercase tracking-[0.15em] text-[#C17A3A]">{p.role}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
