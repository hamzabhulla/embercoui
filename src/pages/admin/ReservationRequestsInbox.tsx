import { useCallback, useEffect, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import {
  Card, CardHead, EmptyNote, ErrorNote, FChip, LoadingNote, NoticeNote,
  chipBtn, chipDangerBtn, chipGhostBtn, inputCls, labelCls,
} from '../../components/admin/ui';

// Phase G — the Reservations page's change-request inbox. Customers
// ask for a different date / time / party size (and/or leave a note)
// from their account; whoever holds Reservations at manage level
// closes each request exactly once:
//   Apply        — the reservation edit opens pre-filled with the
//                  proposed values; SAVING it marks the request
//                  approved (the save carries the request id).
//   Decline      — requires a reply: the guest reads it in their
//                  account, so a silent no is not an option here.
//   Mark handled — for requests resolved without an edit (a phone
//                  call, say); the reply is optional.
// Reading the inbox needs reservations:view; the actions render only
// for manage holders. Handled requests stay visible under their
// status filter — the inbox is the record, not just the queue.

interface ReservationLite {
  id: string; name: string; email: string | null; phone: string;
  date: string; time: string; guests: number; status: string;
}

export interface ReservationRequestRow {
  id: string; reservationId: string; requesterEmail: string | null;
  proposedDate: string | null; proposedTime: string | null; proposedGuests: number | null;
  message: string; status: string; adminReply: string | null; createdAt: string;
  reservation: ReservationLite | null;
}

const FILTERS = [
  { key: 'pending', label: 'Pending' },
  { key: 'all', label: 'All' },
  { key: 'approved', label: 'Approved' },
  { key: 'declined', label: 'Declined' },
  { key: 'handled', label: 'Handled' },
] as const;

const REQUEST_TONES: Record<string, string> = {
  pending: 'bg-[#FAF1DC] text-[#B07C1E]',
  approved: 'bg-[#E4F0E7] text-[#2E7D4F]',
  declined: 'bg-[#F9E7E1] text-[#B0492F]',
  handled: 'bg-[#EFE9DB] text-[#5C665C]',
};

const fmtDay = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
const slotTime = (t: string) => t.slice(0, 5);

type ActionState = {
  id: string;
  mode: 'apply' | 'decline' | 'handled';
  date: string; time: string; guests: number; reply: string;
};

export default function ReservationRequestsInbox({
  canManage,
  onApplied,
}: {
  canManage: boolean;
  onApplied?: () => void;
}) {
  const [rows, setRows] = useState<ReservationRequestRow[]>([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [degraded, setDegraded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<string>('pending');
  const [busyId, setBusyId] = useState('');
  const [act, setAct] = useState<ActionState | null>(null);

  const load = useCallback(() => {
    const qs = filter === 'all' ? '' : `&status=${filter}`;
    adminGet<{ requests: ReservationRequestRow[]; pendingTotal: number; degraded: boolean }>(
      `/api/v1/admin/reservation-requests?limit=100&offset=0${qs}`,
    )
      .then((d) => {
        setRows(d.requests);
        setPendingTotal(d.pendingTotal);
        setDegraded(d.degraded);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
  }, [filter]);
  useEffect(load, [load]);

  const openApply = (row: ReservationRequestRow) => {
    setError(''); setNotice('');
    setAct({
      id: row.id, mode: 'apply',
      date: row.proposedDate ?? row.reservation?.date ?? '',
      time: slotTime(row.proposedTime ?? row.reservation?.time ?? '19:00'),
      guests: row.proposedGuests ?? row.reservation?.guests ?? 2,
      reply: '',
    });
  };

  const saveApply = async (row: ReservationRequestRow) => {
    if (!act) return;
    setBusyId(row.id); setError(''); setNotice('');
    try {
      await adminSend('PATCH', `/api/v1/admin/reservations/${row.reservationId}`, {
        date: act.date, time: act.time, guests: Number(act.guests),
        requestId: row.id,
        ...(act.reply.trim() ? { reply: act.reply.trim() } : {}),
      });
      setNotice('Change applied — the booking is updated and the guest can see the approval in their account.');
      setAct(null);
      load();
      onApplied?.();
    } catch (e) { setError((e as Error).message); }
    finally { setBusyId(''); }
  };

  const confirmClose = async (row: ReservationRequestRow, mode: 'decline' | 'handled') => {
    if (!act) return;
    setBusyId(row.id); setError(''); setNotice('');
    try {
      await adminSend('POST', `/api/v1/admin/reservation-requests/${row.id}/${mode}`, {
        ...(act.reply.trim() ? { reply: act.reply.trim() } : {}),
      });
      setNotice(mode === 'decline'
        ? 'Request declined — the guest can read your note in their account.'
        : 'Request marked handled.');
      setAct(null);
      load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusyId(''); }
  };

  return (
    <Card className="mb-6">
      <CardHead
        title="Change requests"
        right={pendingTotal > 0 ? (
          <span className="inline-flex items-center px-2.5 py-[3px] rounded-full bg-[#FAF1DC] text-[#B07C1E] font-bodytext text-[11px] font-semibold whitespace-nowrap">
            {pendingTotal} pending
          </span>
        ) : undefined}
      />
      <div className="px-[18px] pb-4">
        {error && <ErrorNote message={error} />}
        {notice && <NoticeNote message={notice} />}
        <div className="flex flex-wrap gap-2 mb-2">
          {FILTERS.map((f) => (
            <FChip key={f.key} active={filter === f.key} onClick={() => { setFilter(f.key); setAct(null); }}>
              {f.label}
            </FChip>
          ))}
        </div>
        {degraded ? (
          <p className="font-bodytext text-[13px] text-[#B07C1E] py-2">
            Change requests activate once the latest database update is applied — until then this inbox stays empty and guests are asked to call instead.
          </p>
        ) : !loaded ? (
          <LoadingNote />
        ) : rows.length === 0 ? (
          <EmptyNote message={filter === 'pending' ? 'No pending change requests.' : 'No change requests here yet.'} />
        ) : (
          <div>
            {rows.map((row) => {
              const r = row.reservation;
              const isAct = act?.id === row.id;
              const changed = (proposed: string | number | null, current: string | number | undefined) =>
                proposed != null && current !== undefined && String(proposed) !== String(current);
              return (
                <div key={row.id} className="border-t border-[#EFE9DB] py-4 first:border-t-0 first:pt-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bodytext text-[14.5px] font-semibold text-[#16241A]">{r?.name ?? 'Guest'}</p>
                    <span className={`inline-flex items-center px-2 py-[2px] rounded-full font-bodytext text-[10.5px] font-semibold ${REQUEST_TONES[row.status] ?? REQUEST_TONES.handled}`}>
                      {row.status}
                    </span>
                    <span className="font-bodytext text-[12px] text-[#98A096]">
                      requested {new Date(row.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                      {row.requesterEmail ? ` · ${row.requesterEmail}` : ''}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                    <div className="bg-[#FBF8F1] border border-[#EFE9DB] rounded-[10px] px-3.5 py-3">
                      <p className="font-bodytext text-[10px] tracking-[0.14em] uppercase text-[#98A096] font-semibold mb-1">Booked</p>
                      <p className="font-bodytext text-[13.5px] text-[#16241A]">
                        {r ? `${fmtDay(r.date)} · ${slotTime(r.time)} · ${r.guests} guest${r.guests === 1 ? '' : 's'}` : 'Booking no longer available'}
                      </p>
                    </div>
                    <div className="bg-[#FBF8F1] border border-[#EFE9DB] rounded-[10px] px-3.5 py-3">
                      <p className="font-bodytext text-[10px] tracking-[0.14em] uppercase text-[#98A096] font-semibold mb-1">Requested change</p>
                      <p className="font-bodytext text-[13.5px] text-[#16241A]">
                        {row.proposedDate == null && row.proposedTime == null && row.proposedGuests == null
                          ? 'No change to date, time or guests — see the note below.'
                          : (
                            <>
                              <span className={changed(row.proposedDate, r?.date) ? 'font-semibold text-[#A66932]' : ''}>{(row.proposedDate ?? r?.date) ? fmtDay(row.proposedDate ?? r!.date) : '—'}</span>
                              {' · '}
                              <span className={changed(row.proposedTime ? slotTime(row.proposedTime) : null, r ? slotTime(r.time) : undefined) ? 'font-semibold text-[#A66932]' : ''}>{(row.proposedTime ?? r?.time) ? slotTime(row.proposedTime ?? r!.time) : '—'}</span>
                              {' · '}
                              <span className={changed(row.proposedGuests, r?.guests) ? 'font-semibold text-[#A66932]' : ''}>{row.proposedGuests ?? r?.guests ?? '—'} guest{(row.proposedGuests ?? r?.guests ?? 0) === 1 ? '' : 's'}</span>
                            </>
                          )}
                      </p>
                    </div>
                  </div>

                  {row.message && (
                    <p className="font-bodytext text-[13px] text-[#5C665C] mt-2.5 italic">“{row.message}”</p>
                  )}
                  {row.adminReply && (
                    <p className="font-bodytext text-[13px] text-[#5C665C] mt-1.5">Reply sent: {row.adminReply}</p>
                  )}

                  {canManage && row.status === 'pending' && !isAct && (
                    <div className="flex flex-wrap gap-2 mt-3">
                      <button type="button" disabled={busyId === row.id} onClick={() => openApply(row)} className={chipBtn}>Apply change</button>
                      <button type="button" disabled={busyId === row.id} onClick={() => { setError(''); setNotice(''); setAct({ id: row.id, mode: 'decline', date: '', time: '', guests: 0, reply: '' }); }} className={chipDangerBtn}>Decline</button>
                      <button type="button" disabled={busyId === row.id} onClick={() => { setError(''); setNotice(''); setAct({ id: row.id, mode: 'handled', date: '', time: '', guests: 0, reply: '' }); }} className={chipGhostBtn}>Mark handled</button>
                    </div>
                  )}

                  {canManage && isAct && act.mode === 'apply' && (
                    <div className="mt-3 border border-[#EFE9DB] rounded-[10px] px-3.5 py-3.5">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                          <label className={labelCls} htmlFor={`apply-date-${row.id}`}>Date</label>
                          <input id={`apply-date-${row.id}`} type="date" className={inputCls} value={act.date} onChange={(e) => setAct({ ...act, date: e.target.value })} />
                        </div>
                        <div>
                          <label className={labelCls} htmlFor={`apply-time-${row.id}`}>Time</label>
                          <input id={`apply-time-${row.id}`} type="time" className={inputCls} value={act.time} onChange={(e) => setAct({ ...act, time: e.target.value })} />
                        </div>
                        <div>
                          <label className={labelCls} htmlFor={`apply-guests-${row.id}`}>Guests</label>
                          <input id={`apply-guests-${row.id}`} type="number" min={1} max={20} className={inputCls} value={act.guests} onChange={(e) => setAct({ ...act, guests: Number(e.target.value) })} />
                        </div>
                      </div>
                      <div className="mt-3">
                        <label className={labelCls} htmlFor={`apply-reply-${row.id}`}>Note for the guest (optional)</label>
                        <input id={`apply-reply-${row.id}`} className={inputCls} value={act.reply} onChange={(e) => setAct({ ...act, reply: e.target.value })} placeholder="e.g. Done — the corner table is yours." />
                      </div>
                      <div className="flex flex-wrap gap-2 mt-3.5">
                        <button type="button" disabled={busyId === row.id} onClick={() => void saveApply(row)} className={chipBtn}>
                          {busyId === row.id ? 'Saving…' : 'Save & approve'}
                        </button>
                        <button type="button" onClick={() => setAct(null)} className={chipGhostBtn}>Cancel</button>
                      </div>
                      <p className="font-bodytext text-[12px] text-[#98A096] mt-2.5">
                        Saving updates the booking and marks this request approved — closing this form without saving leaves the request pending.
                      </p>
                    </div>
                  )}

                  {canManage && isAct && act.mode !== 'apply' && (
                    <div className="mt-3 border border-[#EFE9DB] rounded-[10px] px-3.5 py-3.5">
                      <label className={labelCls} htmlFor={`close-reply-${row.id}`}>
                        {act.mode === 'decline' ? 'Reply for the guest (required — they will read it in their account)' : 'Reply for the guest (optional)'}
                      </label>
                      <input
                        id={`close-reply-${row.id}`} className={inputCls} value={act.reply}
                        onChange={(e) => setAct({ ...act, reply: e.target.value })}
                        placeholder={act.mode === 'decline' ? 'e.g. That evening is fully booked — the next night is open.' : 'e.g. Sorted out by phone.'}
                      />
                      <div className="flex flex-wrap gap-2 mt-3.5">
                        <button
                          type="button"
                          disabled={busyId === row.id || (act.mode === 'decline' && !act.reply.trim())}
                          onClick={() => void confirmClose(row, act.mode as 'decline' | 'handled')}
                          className={act.mode === 'decline' ? chipDangerBtn : chipBtn}
                        >
                          {busyId === row.id ? 'Saving…' : act.mode === 'decline' ? 'Decline request' : 'Mark handled'}
                        </button>
                        <button type="button" onClick={() => setAct(null)} className={chipGhostBtn}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
