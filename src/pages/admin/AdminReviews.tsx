import { useEffect, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import { useAuth } from '../../context/AuthContext';
import { ErrorNote, LoadingNote, PageTitle, StatusPill, fmtDate } from '../../components/admin/ui';

interface Review { id: string; name: string; country: string | null; rating: number; comment: string; isApproved: boolean; createdAt: string }

export default function AdminReviews() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState<Review[]>([]);
  const [error, setError] = useState('');
  const load = () => { adminGet<{ reviews: Review[] }>('/api/v1/admin/reviews').then((d) => setRows(d.reviews)).catch((e: Error) => setError(e.message)); };
  useEffect(load, []);
  const setApproved = async (id: string, isApproved: boolean) => {
    try { await adminSend('PATCH', `/api/v1/admin/reviews/${id}`, { isApproved }); load(); }
    catch (e) { setError((e as Error).message); }
  };
  const remove = async (id: string) => {
    try { await adminSend('DELETE', `/api/v1/admin/reviews/${id}`); load(); }
    catch (e) { setError((e as Error).message); }
  };
  return (
    <div>
      <PageTitle sub="Only approved reviews appear on the website">Reviews</PageTitle>
      {error && <ErrorNote message={error} />}
      {rows.length === 0 && !error && <LoadingNote />}
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="bg-[#1C2B1E] border border-white/10 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
              <p className="font-bodytext text-sm">{r.name} <span className="text-[#C17A3A]">{'★'.repeat(r.rating)}</span> <span className="text-[#F5F0E8]/45">{r.country ?? ''} · {fmtDate(r.createdAt)}</span></p>
              <StatusPill status={r.isApproved ? 'approved' : 'pending'} />
            </div>
            <p className="font-bodytext text-sm text-[#F5F0E8]/70 mb-3">{r.comment}</p>
            <div className="flex gap-2">
              {!r.isApproved && <button onClick={() => void setApproved(r.id, true)} className="px-3 py-1.5 bg-[#C17A3A] hover:bg-[#A66932] text-white font-bodytext text-[10px] tracking-[0.15em] uppercase">Approve</button>}
              {r.isApproved && <button onClick={() => void setApproved(r.id, false)} className="px-3 py-1.5 border border-white/20 font-bodytext text-[10px] tracking-[0.15em] uppercase">Unapprove</button>}
              {isAdmin && <button onClick={() => void remove(r.id)} className="px-3 py-1.5 border border-[#ef4444]/50 text-[#ef4444] font-bodytext text-[10px] tracking-[0.15em] uppercase">Delete</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
