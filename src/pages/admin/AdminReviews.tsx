import { useEffect, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import { useAuth } from '../../context/AuthContext';
import { Avatar, Card, CardHead, EmptyNote, ErrorNote, LoadingNote, PageTitle, StatusPill, chipBtn, chipDangerBtn, chipGhostBtn, fmtDate } from '../../components/admin/ui';

interface Review { id: string; name: string; country: string | null; rating: number; comment: string; isApproved: boolean; createdAt: string }

function Stars({ rating }: { rating: number }) {
  return (
    <span className="text-[#C17A3A] tracking-[2px] text-[13px]" aria-label={`${rating} out of 5 stars`}>
      {'★'.repeat(rating)}<span className="text-[#DDD5BF]">{'☆'.repeat(Math.max(0, 5 - rating))}</span>
    </span>
  );
}

export default function AdminReviews() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState<Review[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const load = () => { adminGet<{ reviews: Review[] }>('/api/v1/admin/reviews').then((d) => setRows(d.reviews)).catch((e: Error) => setError(e.message)).finally(() => setLoaded(true)); };
  useEffect(load, []);
  const setApproved = async (id: string, isApproved: boolean) => {
    try { await adminSend('PATCH', `/api/v1/admin/reviews/${id}`, { isApproved }); load(); }
    catch (e) { setError((e as Error).message); }
  };
  const remove = async (id: string) => {
    try { await adminSend('DELETE', `/api/v1/admin/reviews/${id}`); load(); }
    catch (e) { setError((e as Error).message); }
  };
  const avg = rows.length ? rows.reduce((s, r) => s + r.rating, 0) / rows.length : 0;
  const dist = [5, 4, 3, 2, 1].map((star) => ({ star, count: rows.filter((r) => r.rating === star).length }));
  return (
    <div>
      <PageTitle sub="Only approved reviews appear on the website">Reviews</PageTitle>
      {error && <ErrorNote message={error} />}
      {!loaded && !error && <LoadingNote />}
      {loaded && rows.length === 0 && !error && <EmptyNote message="No reviews yet." />}
      {rows.length > 0 && (
        <div className="grid lg:grid-cols-[300px_1fr] gap-5 items-start">
          <div className="space-y-5">
            <Card className="px-5 py-6 text-center">
              <div className="font-display text-[52px] leading-none font-semibold text-[#16241A]">{avg.toFixed(1)}</div>
              <div className="my-2.5"><Stars rating={Math.round(avg)} /></div>
              <p className="font-bodytext text-[12px] text-[#98A096]">{rows.length} reviews · {rows.filter((r) => !r.isApproved).length} awaiting approval</p>
            </Card>
            <Card className="px-5 py-4">
              {dist.map(({ star, count }) => (
                <div key={star} className="flex items-center gap-2.5 py-[5px]">
                  <b className="font-bodytext text-[12.5px] w-3">{star}</b>
                  <div className="flex-1 h-[7px] rounded-full bg-[#EFE9DB] overflow-hidden">
                    <div className="h-full rounded-full bg-[#C17A3A]" style={{ width: `${rows.length ? (count / rows.length) * 100 : 0}%` }} />
                  </div>
                  <span className="font-bodytext text-[12px] text-[#98A096] w-6 text-right">{count}</span>
                </div>
              ))}
            </Card>
          </div>
          <Card>
            <CardHead title="All reviews" />
            <div>
              {rows.map((r) => (
                <div key={r.id} className="px-[18px] py-4 border-t border-[#EFE9DB] first:border-t-0">
                  <div className="flex flex-wrap items-center justify-between gap-3 mb-1.5">
                    <span className="flex items-center gap-2.5">
                      <Avatar name={r.name} />
                      <span><b className="font-bodytext text-[13.5px] font-semibold text-[#16241A] block">{r.name}</b><span className="block font-bodytext text-[12px] text-[#98A096]">{r.country ?? ''}{r.country ? ' · ' : ''}{fmtDate(r.createdAt)}</span></span>
                    </span>
                    <span className="flex items-center gap-2.5"><Stars rating={r.rating} /><StatusPill status={r.isApproved ? 'approved' : 'pending'} /></span>
                  </div>
                  <p className="font-bodytext text-[13.5px] text-[#5C665C] leading-relaxed mb-3">{r.comment}</p>
                  <div className="flex gap-2">
                    {!r.isApproved && <button onClick={() => void setApproved(r.id, true)} className={chipBtn}>Approve</button>}
                    {r.isApproved && <button onClick={() => void setApproved(r.id, false)} className={chipGhostBtn}>Unapprove</button>}
                    {isAdmin && <button onClick={() => void remove(r.id)} className={chipDangerBtn}>Delete</button>}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
