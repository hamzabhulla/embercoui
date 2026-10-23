import { useEffect, useState } from 'react';
import { adminDownloadCsv, adminGet } from '../../services/adminApi';
import {
  Card, EmptyNote, ErrorNote, FChip, LoadingNote, PageTitle, SearchInput,
  fmtDate, ghostBtn, inputCls, labelCls, primaryBtn, tableCls, tdCls, thCls,
} from '../../components/admin/ui';

/**
 * Security & Activity (Phase C) — the owner's window into the
 * append-only audit log. Two tabs over ONE read API
 * (GET /admin/security/events, gated server-side on security:view):
 *
 *   Login Activity — verified sign-ins, two-factor verifications
 *     and sign-outs, PLUS the failed sign-in reports. A failed
 *     password dies inside Supabase Auth and never reaches the
 *     backend, so failures are client-reported and are badged
 *     "Unverified report" here — never presented as verified fact.
 *   Change History — every recorded mutation with its per-field
 *     from → to diff, rendered readably.
 *
 * Pre-migration the API answers an empty, `degraded` page; the note
 * below says plainly that logging activates with the database
 * update instead of implying nothing ever happened.
 */

interface SecurityEvent {
  id: string;
  timestamp: string;
  category: 'auth' | 'change';
  action: string;
  actor: { id: string | null; label: string | null; role: string | null } | null;
  entity: { type: string; id: string | null; label: string | null } | null;
  summary: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  metadata: { ip: string | null; userAgent: string | null; verified: boolean; source: string };
}

interface EventsResponse {
  events: SecurityEvent[];
  total: number;
  degraded: boolean;
}

type Tab = 'auth' | 'change';

const PAGE_SIZE = 50;

const ACTION_LABELS: Record<string, string> = {
  'auth.login': 'Sign-in',
  'auth.mfa_verified': 'Two-factor verified',
  'auth.logout': 'Sign-out',
  'auth.login_failed': 'Failed sign-in attempt',
  'order.status_changed': 'Order status changed',
  'order.payment_on_cancelled': 'Payment received for cancelled order',
  'reservation.created': 'Reservation created',
  'reservation.updated': 'Reservation updated',
  'reservation.status_changed': 'Reservation status changed',
  'reservation.payment_on_cancelled': 'Booking fee received for cancelled reservation',
  'reservation_request.created': 'Change request sent',
  'reservation_request.approved': 'Change request approved',
  'reservation_request.declined': 'Change request declined',
  'reservation_request.handled': 'Change request handled',
  'menu_item.created': 'Menu item created',
  'menu_item.updated': 'Menu item updated',
  'menu_item.deleted': 'Menu item deleted',
  'review.approved': 'Review approved',
  'review.unapproved': 'Review unapproved',
  'review.deleted': 'Review deleted',
  'coupon.created': 'Coupon created',
  'coupon.updated': 'Coupon updated',
  'coupon.deleted': 'Coupon deleted',
  'settings.updated': 'Settings updated',
  'staff.role_changed': 'Role changed',
  'staff.permissions_changed': 'Permissions changed',
  'staff.mfa_required_changed': 'Two-factor setting changed',
  'staff.mfa_reset': 'Two-factor reset',
  'permissions.role_defaults_changed': 'Role defaults changed',
};

const ACTION_FILTERS: Record<Tab, { value: string; label: string }[]> = {
  auth: [
    { value: '', label: 'All activity' },
    { value: 'auth.login', label: 'Sign-ins' },
    { value: 'auth.mfa_verified', label: 'Two-factor verifications' },
    { value: 'auth.logout', label: 'Sign-outs' },
    { value: 'auth.login_failed', label: 'Failed attempts' },
  ],
  change: [
    { value: '', label: 'All changes' },
    { value: 'order.', label: 'Orders' },
    { value: 'reservation.', label: 'Reservations' },
    { value: 'reservation_request.', label: 'Reservation requests' },
    { value: 'menu_item.', label: 'Menu' },
    { value: 'review.', label: 'Reviews' },
    { value: 'coupon.', label: 'Coupons' },
    { value: 'settings.', label: 'Settings' },
    { value: 'staff.', label: 'Staff & access' },
    { value: 'permissions.', label: 'Role defaults' },
  ],
};

const ROLE_LABELS: Record<string, string> = { admin: 'Owner', manager: 'Manager', staff: 'Staff' };

function fmtValue(key: string, v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return key === 'price' ? v.toFixed(2) : String(v);
  if (typeof v === 'string') return v.length > 80 ? `${v.slice(0, 80)}…` : v;
  const json = JSON.stringify(v);
  return json.length > 80 ? `${json.slice(0, 80)}…` : json;
}

interface AppliedFilters { q: string; from: string; to: string; action: string }
const NO_FILTERS: AppliedFilters = { q: '', from: '', to: '', action: '' };

function filterParams(f: AppliedFilters, category: Tab): URLSearchParams {
  const params = new URLSearchParams({ category });
  if (f.q) params.set('q', f.q);
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  if (f.action) params.set('action', f.action);
  return params;
}

export default function AdminSecurity() {
  const [tab, setTab] = useState<Tab>('auth');
  const [qInput, setQInput] = useState('');
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [actionInput, setActionInput] = useState('');
  const [applied, setApplied] = useState<AppliedFilters>(NO_FILTERS);
  const [rows, setRows] = useState<SecurityEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [degraded, setDegraded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoaded(false);
    setError('');
    const params = filterParams(applied, tab);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', '0');
    adminGet<EventsResponse>(`/api/v1/admin/security/events?${params.toString()}`)
      .then((d) => { if (active) { setRows(d.events); setTotal(d.total); setDegraded(d.degraded); } })
      .catch((e: Error) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [tab, applied]);

  const switchTab = (next: Tab) => {
    if (next === tab) return;
    setTab(next);
    // The action options differ per tab — a stale prefix from the
    // other tab would filter the new one to nothing.
    setActionInput('');
    setApplied((prev) => ({ ...prev, action: '' }));
  };

  const applyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setApplied({ q: qInput.trim(), from: fromInput, to: toInput, action: actionInput });
  };

  const clearFilters = () => {
    setQInput(''); setFromInput(''); setToInput(''); setActionInput('');
    setApplied(NO_FILTERS);
  };

  const hasFilters = applied.q !== '' || applied.from !== '' || applied.to !== '' || applied.action !== '';

  const loadMore = () => {
    setLoadingMore(true);
    const params = filterParams(applied, tab);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(rows.length));
    adminGet<EventsResponse>(`/api/v1/admin/security/events?${params.toString()}`)
      .then((d) => { setRows((prev) => [...prev, ...d.events]); setTotal(d.total); setDegraded(d.degraded); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingMore(false));
  };

  const exportCsv = async () => {
    try {
      await adminDownloadCsv(`/api/v1/admin/security/events.csv?${filterParams(applied, tab).toString()}`, 'security-activity.csv');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const emptyMessage = degraded
    ? ''
    : hasFilters
      ? 'No activity matches these filters.'
      : tab === 'auth'
        ? 'No logins recorded yet.'
        : 'No changes recorded yet.';

  return (
    <div>
      <PageTitle
        sub="Recorded by the server — nothing here can be edited or deleted"
        actions={<button type="button" className={primaryBtn} onClick={() => void exportCsv()}>Export CSV</button>}
      >
        Security &amp; Activity
      </PageTitle>

      {error && <ErrorNote message={error} />}

      {degraded && (
        <div className="border border-[#B07C1E]/40 bg-[#FAF1DC] text-[#7A5510] rounded-[10px] px-4 py-3 font-bodytext text-sm mb-6">
          Activity logging activates once the latest database update is applied — until then, this page stays empty.
        </div>
      )}

      <div className="flex gap-2 mb-5">
        <FChip active={tab === 'auth'} onClick={() => switchTab('auth')}>Login Activity</FChip>
        <FChip active={tab === 'change'} onClick={() => switchTab('change')}>Change History</FChip>
      </div>

      <form onSubmit={applyFilters} className="flex flex-wrap items-end gap-3 mb-5">
        <div>
          <label className={labelCls} htmlFor="security-search">Search</label>
          <SearchInput value={qInput} onChange={setQInput} placeholder="Person, item or action" />
        </div>
        <div className="w-[150px]">
          <label className={labelCls} htmlFor="security-from">From</label>
          <input id="security-from" type="date" className={inputCls} value={fromInput} onChange={(e) => setFromInput(e.target.value)} />
        </div>
        <div className="w-[150px]">
          <label className={labelCls} htmlFor="security-to">To</label>
          <input id="security-to" type="date" className={inputCls} value={toInput} onChange={(e) => setToInput(e.target.value)} />
        </div>
        <div className="w-[190px]">
          <label className={labelCls} htmlFor="security-action">Type</label>
          <select id="security-action" className={inputCls} value={actionInput} onChange={(e) => setActionInput(e.target.value)}>
            {ACTION_FILTERS[tab].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <button type="submit" className={primaryBtn}>Apply filters</button>
        {hasFilters && <button type="button" className={ghostBtn} onClick={clearFilters}>Clear</button>}
      </form>

      <Card className="overflow-hidden">
        {!loaded && !error && <LoadingNote />}
        {loaded && rows.length === 0 && !error && emptyMessage && <EmptyNote message={emptyMessage} />}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead>
                <tr>
                  <th className={thCls}>When</th>
                  <th className={thCls}>Actor</th>
                  <th className={thCls}>Event</th>
                  <th className={thCls}>Details</th>
                  <th className={thCls}>IP address</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((ev) => (
                  <tr key={ev.id} className="hover:bg-[#FDFBF7]">
                    <td className={`${tdCls} whitespace-nowrap text-[#5C665C]`}>{fmtDate(ev.timestamp)}</td>
                    <td className={tdCls}>
                      <span className="block font-medium">{ev.actor?.label ?? '—'}</span>
                      {ev.actor?.role && (
                        <span className="block text-[11.5px] text-[#98A096]">{ROLE_LABELS[ev.actor.role] ?? ev.actor.role}</span>
                      )}
                    </td>
                    <td className={tdCls}>
                      <span className="block whitespace-nowrap">{ACTION_LABELS[ev.action] ?? ev.action}</span>
                      {!ev.metadata.verified && (
                        <span className="inline-flex items-center mt-1 px-2 py-[2px] rounded-full bg-[#FAF1DC] text-[#B07C1E] font-bodytext text-[10.5px] font-semibold whitespace-nowrap">
                          Unverified report
                        </span>
                      )}
                    </td>
                    <td className={tdCls}>
                      {ev.summary && <span className="block">{ev.summary}</span>}
                      {ev.changes && (
                        <ul className="mt-1 space-y-0.5">
                          {Object.entries(ev.changes).map(([key, diff]) => (
                            <li key={key} className="font-bodytext text-[12.5px] text-[#5C665C]">
                              <span className="text-[#98A096]">{key}:</span>{' '}
                              {fmtValue(key, diff.from)} <span aria-hidden="true">→</span> {fmtValue(key, diff.to)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className={tdCls}>
                      <span className="block whitespace-nowrap text-[#5C665C]">{ev.metadata.ip ?? '—'}</span>
                      {ev.metadata.userAgent && (
                        <span className="block text-[11px] text-[#98A096] max-w-[180px] truncate" title={ev.metadata.userAgent}>
                          {ev.metadata.userAgent}
                        </span>
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
        <p className="font-bodytext text-[12.5px] text-[#98A096] mt-4">Showing {rows.length} of {total} events</p>
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
