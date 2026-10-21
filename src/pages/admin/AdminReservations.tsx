import { useEffect, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import { Card, EmptyNote, ErrorNote, LoadingNote, PageTitle, StatCard, StatusPill, chipBtn, chipDangerBtn, chipGhostBtn } from '../../components/admin/ui';

interface Reservation { id: string; name: string; email: string; phone: string; date: string; time: string; guests: number; status: string; createdAt: string }

export default function AdminReservations() {
  const [rows, setRows] = useState<Reservation[]>([]);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');
  const [loaded, setLoaded] = useState(false);
  const load = () => { adminGet<{ reservations: Reservation[] }>('/api/v1/admin/reservations').then((d) => setRows(d.reservations)).catch((e: Error) => setError(e.message)).finally(() => setLoaded(true)); };
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mb-6">
        <StatCard label="Total bookings" value={rows.length} />
        <StatCard label="Pending" value={rows.filter((r) => r.status === 'pending').length} foot="Confirmation still needed" />
        <StatCard label="Confirmed" value={rows.filter((r) => r.status === 'confirmed').length} />
      </div>
      {!loaded && !error && <LoadingNote />}
      {loaded && rows.length === 0 && !error && <EmptyNote message="No reservations yet." />}
      <div className="space-y-3">
        {rows.map((r) => (
          <Card key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <p className="font-bodytext text-[14.5px] font-semibold text-[#16241A]">{r.name} <span className="font-normal text-[#98A096] text-[12.5px]">— {r.guests} guests</span></p>
              <p className="font-bodytext text-[12.5px] text-[#98A096] mt-0.5">{r.date} at {r.time} · {r.email} · {r.phone}</p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <StatusPill status={r.status} />
              {r.status === 'pending' && (
                <>
                  <button disabled={busyId === r.id} onClick={() => void setStatus(r.id, 'confirmed')} className={chipBtn}>Confirm</button>
                  <button disabled={busyId === r.id} onClick={() => void setStatus(r.id, 'cancelled')} className={chipDangerBtn}>Cancel</button>
                </>
              )}
              {r.status === 'confirmed' && (
                <button disabled={busyId === r.id} onClick={() => void setStatus(r.id, 'completed')} className={chipGhostBtn}>Mark completed</button>
              )}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
