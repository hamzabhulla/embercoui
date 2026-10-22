import { useEffect, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import { useAuth } from '../../context/AuthContext';
import {
  Card, CardHead, EmptyNote, ErrorNote, LoadingNote, NoticeNote, PageTitle, StatCard, StatusPill,
  chipBtn, chipDangerBtn, chipGhostBtn, ghostBtn, inputCls, labelCls, primaryBtn,
} from '../../components/admin/ui';

interface Reservation {
  id: string; name: string; email: string | null; phone: string; date: string; time: string;
  guests: number; status: string; source: 'website' | 'admin'; notes: string | null; createdAt: string;
}

interface Settings { reservationSlotCapacity: number }

/** YYYY-MM-DD from LOCAL date parts — toISOString() would shift the day by timezone. */
const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** Postgres time values can arrive as HH:MM:SS — the board groups by HH:MM. */
const slotTime = (t: string) => t.slice(0, 5);
const ACTIVE = ['pending', 'confirmed'];
const PAGE_SIZE = 100;

const EMPTY_FORM = { name: '', phone: '', email: '', date: '', time: '19:00', guests: 2, status: 'confirmed', notes: '' };

export default function AdminReservations() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState<Reservation[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [capacity, setCapacity] = useState(40);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [boardDate, setBoardDate] = useState(() => localDate());
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, date: localDate() }));
  const [saving, setSaving] = useState(false);

  const load = () => {
    Promise.all([
      adminGet<{ reservations: Reservation[]; total: number }>(`/api/v1/admin/reservations?limit=${PAGE_SIZE}&offset=0`),
      // Capacity comes from the PUBLIC settings DTO (it already exposes
      // reservationSlotCapacity): /admin/settings is admin-only, and staff
      // still need the real capacity for an accurate day board.
      adminGet<{ settings: Settings }>('/api/v1/settings/public').catch(() => null),
    ])
      .then(([d, s]) => {
        setRows(d.reservations);
        setTotal(d.total);
        if (s?.settings.reservationSlotCapacity) setCapacity(s.settings.reservationSlotCapacity);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
  };
  useEffect(load, []);

  // The day board and stats above work on the loaded rows; Load more
  // appends the next page so older bookings can be reached too.
  const loadMore = () => {
    setLoadingMore(true);
    adminGet<{ reservations: Reservation[]; total: number }>(`/api/v1/admin/reservations?limit=${PAGE_SIZE}&offset=${rows.length}`)
      .then((d) => {
        setRows((prev) => [...prev, ...d.reservations]);
        setTotal(d.total);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingMore(false));
  };

  const setStatus = async (id: string, status: string) => {
    setBusyId(id); setError('');
    try { await adminSend('PATCH', `/api/v1/admin/reservations/${id}/status`, { status }); load(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusyId(''); }
  };

  const today = localDate();
  const todays = rows.filter((r) => r.date === today && ACTIVE.includes(r.status));

  // ── Day board: active bookings for the chosen date, grouped by slot ──
  const boardSlots = (() => {
    const byTime = new Map<string, { parties: number; guests: number }>();
    for (const r of rows) {
      if (r.date !== boardDate || !ACTIVE.includes(r.status)) continue;
      const key = slotTime(r.time);
      const slot = byTime.get(key) ?? { parties: 0, guests: 0 };
      slot.parties += 1; slot.guests += r.guests;
      byTime.set(key, slot);
    }
    return [...byTime.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  })();

  // ── Live hint for the form's own slot ──
  const formSlotGuests = rows
    .filter((r) => r.date === form.date && slotTime(r.time) === slotTime(form.time) && ACTIVE.includes(r.status))
    .reduce((s, r) => s + r.guests, 0);
  const formRemaining = capacity - formSlotGuests;
  const formOverbooks = form.guests > formRemaining;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setError(''); setNotice('');
    try {
      const email = form.email.trim();
      const notes = form.notes.trim();
      await adminSend('POST', '/api/v1/admin/reservations', {
        name: form.name.trim(), phone: form.phone.trim(),
        ...(email ? { email } : {}),
        date: form.date, time: form.time, guests: Number(form.guests),
        status: form.status,
        ...(notes ? { notes } : {}),
      });
      setNotice(`Reservation added for ${form.name.trim()}`);
      setForm({ ...EMPTY_FORM, date: localDate() });
      setFormOpen(false);
      load();
    } catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <PageTitle
        sub="Confirm or cancel table bookings — walk-ins bhi yahin se add hote hain"
        actions={(
          <button type="button" className={primaryBtn} onClick={() => { setFormOpen((o) => !o); setNotice(''); }}>
            {formOpen ? 'Close form' : '+ New Reservation'}
          </button>
        )}
      >
        Reservations
      </PageTitle>
      {error && <ErrorNote message={error} />}
      {notice && <NoticeNote message={notice} />}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mb-6">
        <StatCard label="Today" value={todays.length} foot={`${todays.reduce((s, r) => s + r.guests, 0)} guests`} />
        <StatCard label="Pending" value={rows.filter((r) => r.status === 'pending').length} foot="Confirmation still needed" />
        <StatCard label="Confirmed" value={rows.filter((r) => r.status === 'confirmed').length} />
      </div>

      <Card className="mb-6">
        <CardHead
          title="Day board"
          right={(
            <span className="w-[190px]">
              <input type="date" aria-label="Day board date" className={inputCls} value={boardDate} onChange={(e) => setBoardDate(e.target.value)} />
            </span>
          )}
        />
        <div className="px-[18px] pb-4">
          {boardSlots.length === 0 && (
            <p className="font-bodytext text-[13px] text-[#98A096] py-2">No bookings for this date yet.</p>
          )}
          <div className="space-y-3">
            {boardSlots.map(([time, slot]) => {
              const remaining = capacity - slot.guests;
              const over = remaining < 0;
              const pct = Math.min(100, Math.round((slot.guests / capacity) * 100));
              return (
                <div key={time} className="flex items-center gap-4 flex-wrap">
                  <span className="font-bodytext text-[14px] font-semibold text-[#16241A] w-[52px] [font-variant-numeric:tabular-nums]">{time}</span>
                  <div className="flex-1 min-w-[180px]">
                    <div className="h-[8px] rounded-full bg-[#EFE9DB] overflow-hidden">
                      <div className={`h-full rounded-full ${over ? 'bg-[#B0492F]' : 'bg-[#C17A3A]'}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="font-bodytext text-[12.5px] text-[#5C665C]">{slot.parties} {slot.parties === 1 ? 'party' : 'parties'} · {slot.guests} guests booked</span>
                  <span className={`font-bodytext text-[12.5px] font-semibold w-[110px] text-right ${over ? 'text-[#B0492F]' : 'text-[#2E7D4F]'}`}>
                    {over ? `Overbooked by ${-remaining}` : `${remaining} left`}
                  </span>
                </div>
              );
            })}
          </div>
          {/* The Settings hint is admin-only truth: staff cannot open
              Settings (fix 4), so telling them to change it there sent
              them to a page they can never reach (audit fix 15). */}
          <p className="font-bodytext text-[11.5px] text-[#98A096] mt-3">Capacity {capacity} guests per time slot{isAdmin ? ' — Settings se badal sakti hai' : ''}. Cancelled / completed bookings capacity nahi roktay.</p>
        </div>
      </Card>

      {formOpen && (
        <Card className="mb-6">
          <CardHead title="New reservation — walk-in / phone" />
          <form onSubmit={submit} className="px-[18px] pb-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className={labelCls} htmlFor="nr-name">Full name *</label>
              <input id="nr-name" className={inputCls} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className={labelCls} htmlFor="nr-phone">Phone *</label>
              <input id="nr-phone" className={inputCls} required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <label className={labelCls} htmlFor="nr-email">Email (optional)</label>
              <input id="nr-email" type="email" className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className={labelCls} htmlFor="nr-date">Date *</label>
              <input id="nr-date" type="date" className={inputCls} required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
            </div>
            <div>
              <label className={labelCls} htmlFor="nr-time">Time *</label>
              <input id="nr-time" type="time" className={inputCls} required value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
            </div>
            <div>
              <label className={labelCls} htmlFor="nr-guests">Guests *</label>
              <input id="nr-guests" type="number" min="1" max="20" className={inputCls} required value={form.guests} onChange={(e) => setForm({ ...form, guests: Number(e.target.value) })} />
            </div>
            <div>
              <label className={labelCls} htmlFor="nr-status">Status</label>
              <select id="nr-status" className={inputCls} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="confirmed">Confirmed</option>
                <option value="pending">Pending</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls} htmlFor="nr-notes">Notes (optional)</label>
              <input id="nr-notes" className={inputCls} placeholder="Window seat, birthday, allergy…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center gap-3">
              <p className={`font-bodytext text-[12.5px] ${formOverbooks ? 'text-[#B07C1E] font-semibold' : 'text-[#5C665C]'}`}>
                {formRemaining < 0
                  ? `⚠ This slot is already overbooked by ${-formRemaining} guests — adding more will overbook it further`
                  : formOverbooks
                    ? `⚠ This will overbook the slot — only ${formRemaining} guests left in this slot`
                    : `${formRemaining} guests left in this slot`}
              </p>
              <span className="ml-auto flex gap-2.5">
                <button type="button" className={ghostBtn} onClick={() => setFormOpen(false)}>Cancel</button>
                <button type="submit" disabled={saving} className={primaryBtn}>{saving ? 'Adding…' : 'Add reservation'}</button>
              </span>
            </div>
          </form>
        </Card>
      )}

      {!loaded && !error && <LoadingNote />}
      {loaded && rows.length === 0 && !error && <EmptyNote message="No reservations yet." />}
      <div className="space-y-3">
        {rows.map((r) => (
          <Card key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div>
              <p className="font-bodytext text-[14.5px] font-semibold text-[#16241A]">
                {r.name} <span className="font-normal text-[#98A096] text-[12.5px]">— {r.guests} guests</span>{' '}
                <span className={`inline-flex items-center px-2 py-[2px] rounded-full font-bodytext text-[10.5px] font-semibold align-middle ${r.source === 'admin' ? 'bg-[#FAF1DC] text-[#B07C1E]' : 'bg-[#EFE9DB] text-[#5C665C]'}`}>
                  {r.source === 'admin' ? 'Walk-in' : 'Website'}
                </span>
              </p>
              <p className="font-bodytext text-[12.5px] text-[#98A096] mt-0.5">{r.date} at {r.time} · {r.email ?? '—'} · {r.phone}</p>
              {r.notes && <p className="font-bodytext text-[12.5px] text-[#5C665C] mt-0.5">Note: {r.notes}</p>}
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
                <>
                  <button disabled={busyId === r.id} onClick={() => void setStatus(r.id, 'completed')} className={chipGhostBtn}>Mark completed</button>
                  <button disabled={busyId === r.id} onClick={() => void setStatus(r.id, 'cancelled')} className={chipDangerBtn}>Cancel</button>
                </>
              )}
            </div>
          </Card>
        ))}
      </div>
      {loaded && total > 0 && (
        <p className="font-bodytext text-[12.5px] text-[#98A096] mt-4">Showing {rows.length} of {total} reservations</p>
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
