import { useCallback, useEffect, useRef, useState } from 'react';
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

const DAY_PAGE_SIZE = 100;
// The day board is only honest on a date's COMPLETE set (audit-2 BK-2):
// page through the date-filtered list until the server total is covered.
// A day beyond this cap surfaces an error instead of a silently
// truncated board showing free seats that are not free.
const MAX_DAY_TOTAL = 2000;

async function fetchDayReservations(date: string): Promise<Reservation[]> {
  const all: Reservation[] = [];
  let total = Number.POSITIVE_INFINITY;
  while (all.length < total) {
    const d = await adminGet<{ reservations: Reservation[]; total: number }>(
      `/api/v1/admin/reservations?date=${encodeURIComponent(date)}&limit=${DAY_PAGE_SIZE}&offset=${all.length}`);
    total = d.total;
    if (total > MAX_DAY_TOTAL) {
      throw new Error(`Is date par ${total} reservations hain — day board itni bookings ek sath nahi dikha sakta, is liye seats nahi dikhaye ja rahe (galat seats dikhane se behtar hai).`);
    }
    all.push(...d.reservations);
    if (d.reservations.length === 0) break;
  }
  if (all.length < total) {
    throw new Error('Is date ki bookings mukammal load nahi ho sakin — page refresh karke dobara try karein.');
  }
  return all;
}

const EMPTY_FORM = { name: '', phone: '', email: '', date: '', time: '19:00', guests: 2, status: 'confirmed', notes: '' };

export default function AdminReservations() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';
  const [rows, setRows] = useState<Reservation[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  // null = capacity UNKNOWN (settings not loaded yet, or the fetch
  // failed). The board must never render bars/remaining counts against
  // an invented number (audit-2 D-L5) — only a real fetched value.
  const [capacity, setCapacity] = useState<number | null>(null);
  const [pendingTotal, setPendingTotal] = useState<number | null>(null);
  const [confirmedTotal, setConfirmedTotal] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busyId, setBusyId] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [boardDate, setBoardDate] = useState(() => localDate());
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(() => ({ ...EMPTY_FORM, date: localDate() }));
  const [saving, setSaving] = useState(false);

  // ── Complete per-date reservation sets (board / Today chip / form
  // hint). setsRef is the cache of record; daySets mirrors it for
  // rendering. dayErrors holds the failure per date so one date's
  // failure never poisons another's board.
  const [daySets, setDaySets] = useState<Record<string, Reservation[]>>({});
  const [dayErrors, setDayErrors] = useState<Record<string, string>>({});
  const setsRef = useRef<Record<string, Reservation[]>>({});
  const inflightRef = useRef(new Map<string, number>());
  const genRef = useRef(0);

  const loadDay = useCallback((date: string, force = false) => {
    if (!date) return;
    if (!force && setsRef.current[date]) return;
    if (inflightRef.current.has(date)) return;
    const gen = genRef.current;
    inflightRef.current.set(date, gen);
    // A (re)try clears the date's previous error up front: the board
    // shows its loading state while fetching, never a stale failure.
    setDayErrors((prev) => {
      if (!(date in prev)) return prev;
      const next = { ...prev };
      delete next[date];
      return next;
    });
    fetchDayReservations(date)
      .then((items) => {
        if (gen !== genRef.current) return; // invalidated mid-flight — stale
        setsRef.current = { ...setsRef.current, [date]: items };
        setDaySets(setsRef.current);
      })
      .catch((e: Error) => {
        if (gen !== genRef.current) return;
        setDayErrors((prev) => ({ ...prev, [date]: e.message }));
      })
      .finally(() => {
        // Only the fetch generation that registered this entry may
        // clear it — a stale fetch must not unregister its replacement.
        if (inflightRef.current.get(date) === gen) inflightRef.current.delete(date);
      });
  }, []);

  const today = localDate();

  // Board date + today are always needed (board, Today chip, form hint
  // when its date matches either); the form's own date loads on demand.
  useEffect(() => { loadDay(boardDate); }, [boardDate, loadDay]);
  useEffect(() => { loadDay(localDate()); }, [loadDay]);
  useEffect(() => { if (formOpen) loadDay(form.date); }, [formOpen, form.date, loadDay]);

  // ── Paged list + stat chips sequencing. loadDay guards its fetches
  // with genRef; load() gets the same treatment with its OWN counter
  // (genRef belongs to the day sets — invalidateDays() bumps it
  // independently, and a load() must never discard an in-flight day
  // fetch). Each invocation stamps itself; only the latest may apply
  // its snapshot when it settles.
  const loadGenRef = useRef(0);

  const load = () => {
    const gen = ++loadGenRef.current;
    Promise.all([
      adminGet<{ reservations: Reservation[]; total: number }>(`/api/v1/admin/reservations?limit=${PAGE_SIZE}&offset=0`),
      // Capacity comes from the PUBLIC settings DTO (it already exposes
      // reservationSlotCapacity): /admin/settings is admin-only, and staff
      // still need the real capacity for an accurate day board.
      adminGet<{ settings: Settings }>('/api/v1/settings/public').catch(() => null),
      // Stat chips read exact filtered totals (audit-2 BK-2): a limit=1
      // request is enough — the number comes from the server's total,
      // never from how many rows happen to be loaded below.
      adminGet<{ total: number }>('/api/v1/admin/reservations?status=pending&limit=1&offset=0').catch(() => null),
      adminGet<{ total: number }>('/api/v1/admin/reservations?status=confirmed&limit=1&offset=0').catch(() => null),
    ])
      .then(([d, s, p, c]) => {
        // Superseded by a newer load while in flight (two quick
        // mutations, each reloading): this snapshot is stale — the
        // newer load owns rows/total/chips now.
        if (gen !== loadGenRef.current) return;
        setRows(d.reservations);
        setTotal(d.total);
        if (s?.settings.reservationSlotCapacity) setCapacity(s.settings.reservationSlotCapacity);
        // A failed counts request means the total is UNKNOWN on every
        // load — including reloads after a mutation. Setting null (the
        // chip renders —) beats leaving the previous total on screen,
        // which would present a stale number as fact.
        setPendingTotal(p ? p.total : null);
        setConfirmedTotal(c ? c.total : null);
      })
      .catch((e: Error) => {
        // A superseded load's failure is not the page's error either.
        if (gen !== loadGenRef.current) return;
        setError(e.message);
      })
      .finally(() => {
        // Only the latest load flips `loaded` — a superseded load must
        // not end the loading state its replacement is still working
        // under (the same generation check loadDay applies before
        // clearing its inflight entry).
        if (gen === loadGenRef.current) setLoaded(true);
      });
  };
  useEffect(load, []);

  // After any mutation the cached day sets are stale (a booking was
  // added or its status changed): drop them all and refetch the dates
  // currently on screen. In-flight fetches from before the mutation are
  // discarded via the generation bump.
  const invalidateDays = () => {
    genRef.current += 1;
    inflightRef.current.clear();
    setsRef.current = {};
    setDaySets({});
    setDayErrors({});
    loadDay(boardDate, true);
    loadDay(today, true);
    if (formOpen) loadDay(form.date, true);
  };

  const reloadAll = () => { load(); invalidateDays(); };

  // The reservations list below the board keeps its own paging
  // (Load more appends the next page) — unchanged by this fix.
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
    try { await adminSend('PATCH', `/api/v1/admin/reservations/${id}/status`, { status }); reloadAll(); }
    catch (e) {
      setError((e as Error).message);
      // A 409 means the reservation changed under us: reload the
      // list and the day board so the true state is on screen next
      // to the conflict message.
      if ((e as { status?: number }).status === 409) reloadAll();
    }
    finally { setBusyId(''); }
  };

  // Today chip: today's COMPLETE set (server date filter), active only.
  const todays = daySets[today]
    ? daySets[today].filter((r) => ACTIVE.includes(r.status))
    : null;

  // ── Day board: active bookings for the chosen date, grouped by slot.
  // Computed from the date's complete fetched set — never from the
  // paged list below, whose first-100 window may not contain this date
  // at all (audit-2 BK-2).
  const boardRows = daySets[boardDate];
  const boardError = dayErrors[boardDate];
  const boardSlots = (() => {
    const byTime = new Map<string, { parties: number; guests: number }>();
    for (const r of boardRows ?? []) {
      if (!ACTIVE.includes(r.status)) continue;
      const key = slotTime(r.time);
      const slot = byTime.get(key) ?? { parties: 0, guests: 0 };
      slot.parties += 1; slot.guests += r.guests;
      byTime.set(key, slot);
    }
    return [...byTime.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  })();

  // ── Live hint for the form's own slot — from the form date's
  // complete set, which may be neither the board date nor today.
  const formRows = form.date ? daySets[form.date] : undefined;
  const formDayError = form.date ? dayErrors[form.date] : undefined;
  const formSlotGuests = (formRows ?? [])
    .filter((r) => slotTime(r.time) === slotTime(form.time) && ACTIVE.includes(r.status))
    .reduce((s, r) => s + r.guests, 0);
  const formRemaining = capacity !== null ? capacity - formSlotGuests : 0;
  const formOverbooks = capacity !== null && formRows !== undefined && form.guests > formRemaining;
  // Hint content, in honesty order: no date yet → capacity unknown →
  // the date's bookings failed → still loading → the real numbers.
  let formHint: string;
  let formHintWarn = false;
  if (!form.date) {
    formHint = 'Pehle date select karein — phir is slot ki remaining seats dikhengi.';
  } else if (capacity === null) {
    formHint = 'Capacity unknown — settings load nahi ho saka, is liye is slot ki remaining seats check nahi ho sakti.';
  } else if (formDayError) {
    formHint = `Is date ki bookings load nahi ho sakin (${formDayError}) — remaining seats unknown hain.`;
    formHintWarn = true;
  } else if (formRows === undefined) {
    formHint = 'Is slot ki bookings load ho rahi hain…';
  } else if (formRemaining < 0) {
    formHint = `⚠ This slot is already overbooked by ${-formRemaining} guests — adding more will overbook it further`;
    formHintWarn = true;
  } else if (formOverbooks) {
    formHint = `⚠ This will overbook the slot — only ${formRemaining} guests left in this slot`;
    formHintWarn = true;
  } else {
    formHint = `${formRemaining} guests left in this slot`;
  }

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
      reloadAll();
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
        <StatCard
          label="Today"
          value={todays ? todays.length : '—'}
          foot={todays
            ? `${todays.reduce((s, r) => s + r.guests, 0)} guests`
            : dayErrors[today] ? 'Bookings load nahi ho sakin' : 'Loading…'}
        />
        <StatCard label="Pending" value={pendingTotal ?? '—'} foot="Confirmation still needed" />
        <StatCard label="Confirmed" value={confirmedTotal ?? '—'} />
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
          {boardError ? (
            <ErrorNote message={`Day board load nahi ho saka: ${boardError}`} />
          ) : !boardRows ? (
            <LoadingNote />
          ) : (
            <>
              {boardSlots.length === 0 && (
                <p className="font-bodytext text-[13px] text-[#98A096] py-2">No bookings for this date yet.</p>
              )}
              <div className="space-y-3">
                {boardSlots.map(([time, slot]) => {
                  if (capacity === null) {
                    // Capacity unknown (settings fetch failed): show the
                    // complete booked counts, but NO bar and NO remaining
                    // number — those would be computed against an
                    // invented capacity (audit-2 D-L5).
                    return (
                      <div key={time} className="flex items-center gap-4 flex-wrap">
                        <span className="font-bodytext text-[14px] font-semibold text-[#16241A] w-[52px] [font-variant-numeric:tabular-nums]">{time}</span>
                        <span className="font-bodytext text-[12.5px] text-[#5C665C]">{slot.parties} {slot.parties === 1 ? 'party' : 'parties'} · {slot.guests} guests booked</span>
                      </div>
                    );
                  }
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
            </>
          )}
          {/* The Settings hint is admin-only truth: staff cannot open
              Settings (fix 4), so telling them to change it there sent
              them to a page they can never reach (audit fix 15). */}
          {capacity !== null ? (
            <p className="font-bodytext text-[11.5px] text-[#98A096] mt-3">Capacity {capacity} guests per time slot{isAdmin ? ' — Settings se badal sakti hai' : ''}. Cancelled / completed bookings capacity nahi roktay.</p>
          ) : (
            <p className="font-bodytext text-[11.5px] text-[#98A096] mt-3">Capacity unknown — settings load nahi ho saka, is liye remaining seats nahi dikhaye ja rahe; booked counts mukammal hain. Cancelled / completed bookings capacity nahi roktay.</p>
          )}
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
              <p className={`font-bodytext text-[12.5px] ${formHintWarn ? 'text-[#B07C1E] font-semibold' : 'text-[#5C665C]'}`}>
                {formHint}
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
