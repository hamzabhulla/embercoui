import { useEffect, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import { ErrorNote, LoadingNote, PageTitle, StatusPill } from '../../components/admin/ui';

interface Reservation { id: string; name: string; email: string; phone: string; date: string; time: string; guests: number; status: string; createdAt: string }

export default function AdminReservations() {
  const [rows, setRows] = useState<Reservation[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const load = () => { adminGet<{ reservations: Reservation[] }>('/api/v1/admin/reservations').then((d) => setRows(d.reservations)).catch((e: Error) => setError(e.message)); };
  useEffect(load, []);
  const setStatus = async (id: string, status: string) => {
    setBusyId(id); setError('');
    try { await adminSend('PATCH', `/api/v1/admin/reservations/${id}/status`, { status }); load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusyId(''); }
  };
  return (
    <div>
      <PageTitle sub="Confirm or cancel table bookings">Reservations</PageTitle>
      {error && <ErrorNote message={error} />}
      {rows.length === 0 && !error && <LoadingNote />}
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 bg-[#1C2B1E] border border-white/10 px-5 py-4">
            <div>
              <p className="font-bodytext text-sm">{r.name} — {r.guests} guests</p>
              <p className="font-bodytext text-xs text-[#F5F0E8]/45">{r.date} at {r.time} · {r.email} · {r.phone}</p>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill status={r.status} />
              {r.status === 'pending' && (
                <>
                  <button disabled={busyId === r.id} onClick={() => void setStatus(r.id, 'confirmed')} className="px-3 py-1.5 bg-[#C17A3A] hover:bg-[#A66932] text-white font-bodytext text-[10px] tracking-[0.15em] uppercase disabled:opacity-50">Confirm</button>
                  <button disabled={busyId === r.id} onClick={() => void setStatus(r.id, 'cancelled')} className="px-3 py-1.5 border border-[#ef4444]/50 text-[#ef4444] font-bodytext text-[10px] tracking-[0.15em] uppercase disabled:opacity-50">Cancel</button>
                </>
              )}
              {r.status === 'confirmed' && (
                <button disabled={busyId === r.id} onClick={() => void setStatus(r.id, 'completed')} className="px-3 py-1.5 border border-white/20 font-bodytext text-[10px] tracking-[0.15em] uppercase disabled:opacity-50">Mark completed</button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
