import { Fragment, useCallback, useEffect, useState } from 'react';
import { adminGet, adminSend } from '../../services/adminApi';
import { useAuth } from '../../context/AuthContext';
import { usePermissions } from '../../components/admin/PermissionsContext';
import {
  LEVELS, SECTIONS, effectiveLevel,
  type PartialPermissionMap, type PermissionLevel, type PermissionMap,
} from '../../lib/permissions';
import { mfaRoleDefaultRequired } from '../../lib/mfa';
import { Avatar, Card, EmptyNote, ErrorNote, LoadingNote, NoticeNote, PageTitle, fmtDate, chipDangerBtn, chipDangerSolidBtn, chipGhostBtn, ghostBtn, primaryBtn, tableCls, tdCls, thCls } from '../../components/admin/ui';

interface Person { id: string; email: string | null; fullName: string | null; role: string; permissions: PartialPermissionMap | null; mfaRequired?: boolean | null; createdAt: string }
type MfaChoice = 'default' | 'required' | 'not-required';
type RoleDefaults = { manager: PermissionMap; staff: PermissionMap };

const ROLES = ['customer', 'staff', 'manager', 'admin'];
const ROLE_LABELS: Record<string, string> = { customer: 'Customer', staff: 'Staff', manager: 'Manager', admin: 'Admin' };
const PAGE_SIZE = 100;

const NO_ACCESS_MAP: PermissionMap = Object.fromEntries(SECTIONS.map((s) => [s.key, 'none'])) as PermissionMap;

const levelBtnCls = (active: boolean) =>
  `px-2.5 h-7 rounded-md font-bodytext text-[11.5px] font-semibold border transition-colors ${active
    ? 'bg-[#16241A] text-[#F5F0E8] border-[#16241A]'
    : 'bg-white text-[#5C665C] border-[#EAE3D3] hover:bg-[#FBF8F1]'}`;

/** One section row of a permission editor: label + No access/View/Manage. */
function SectionLevelRow({ label, value, overridden, onPick, onReset }: {
  label: string;
  value: PermissionLevel;
  overridden?: boolean;
  onPick: (level: PermissionLevel) => void;
  onReset?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-[7px]">
      <span className="font-bodytext text-[13px] text-[#16241A] flex items-center gap-1.5">
        {label}
        {overridden && <span className="w-1.5 h-1.5 rounded-full bg-[#C17A3A]" title="Person-specific override" />}
      </span>
      <span className="flex items-center gap-1">
        {LEVELS.map((level) => (
          <button key={level} type="button" className={levelBtnCls(value === level)} onClick={() => onPick(level)}>
            {level === 'none' ? 'No access' : level === 'view' ? 'View' : 'Manage'}
          </button>
        ))}
        {onReset && (
          <button type="button" onClick={onReset} title="Remove the override — follow the role default"
            className="ml-1 font-bodytext text-[11.5px] font-medium text-[#8A551F] underline underline-offset-2">
            Reset
          </button>
        )}
      </span>
    </div>
  );
}

export default function AdminStaff() {
  const { user } = useAuth();
  const { me, refresh: refreshPermissions } = usePermissions();
  const isOwner = me?.role === 'admin';
  const [people, setPeople] = useState<Person[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [roleDefaults, setRoleDefaults] = useState<RoleDefaults | null>(null);
  const [defaultsDraft, setDefaultsDraft] = useState<RoleDefaults | null>(null);
  const [savingDefaults, setSavingDefaults] = useState<'manager' | 'staff' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PartialPermissionMap>({});
  const [savingPerson, setSavingPerson] = useState(false);
  const [mfaId, setMfaId] = useState<string | null>(null);
  const [mfaDraft, setMfaDraft] = useState<MfaChoice>('default');
  const [confirmOwnOff, setConfirmOwnOff] = useState(false);
  const [savingMfa, setSavingMfa] = useState(false);
  const [resetArmedId, setResetArmedId] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);

  const fetchPage = useCallback((offset: number, append: boolean) => {
    adminGet<{ staff: Person[]; total: number }>(`/api/v1/admin/staff?limit=${PAGE_SIZE}&offset=${offset}`)
      .then((d) => {
        setTotal(d.total);
        setPeople((prev) => (append ? [...prev, ...d.staff] : d.staff));
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => { setLoaded(true); setLoadingMore(false); });
  }, []);
  const load = useCallback(() => fetchPage(0, false), [fetchPage]);
  useEffect(() => { load(); }, [load]);
  const loadMore = () => { setLoadingMore(true); fetchPage(people.length, true); };

  // Role defaults are the owner's configuration surface: only the owner
  // can read or write them (the API enforces the same).
  useEffect(() => {
    if (!isOwner) return;
    adminGet<{ roles: RoleDefaults }>('/api/v1/admin/permissions/roles')
      .then((d) => { setRoleDefaults(d.roles); setDefaultsDraft(d.roles); })
      .catch((e: Error) => setError(e.message));
  }, [isOwner]);

  const changeRole = async (p: Person, role: string) => {
    setError(''); setNotice('');
    try {
      await adminSend('PATCH', `/api/v1/admin/staff/${p.id}/role`, { role });
      setNotice(`Role updated for ${p.email ?? p.id}.`);
      load();
      refreshPermissions();
    } catch (e) { setError((e as Error).message); }
  };

  const saveDefaults = async (role: 'manager' | 'staff') => {
    if (!defaultsDraft) return;
    setSavingDefaults(role); setError(''); setNotice('');
    try {
      const res = await adminSend<{ permissions: PermissionMap }>('PUT', `/api/v1/admin/permissions/roles/${role}`, { permissions: defaultsDraft[role] });
      setRoleDefaults((prev) => (prev ? { ...prev, [role]: res.permissions } : prev));
      setDefaultsDraft((prev) => (prev ? { ...prev, [role]: res.permissions } : prev));
      setNotice(`${ROLE_LABELS[role]} defaults saved — they apply on everyone's next request.`);
    } catch (e) { setError((e as Error).message); }
    finally { setSavingDefaults(null); }
  };

  const openEditor = (p: Person) => {
    setEditingId(p.id);
    setMfaId(null);
    setDraft({ ...(p.permissions ?? {}) });
    setError(''); setNotice('');
  };

  const openMfa = (p: Person) => {
    setMfaId(p.id);
    setEditingId(null);
    setMfaDraft(p.mfaRequired === true ? 'required' : p.mfaRequired === false ? 'not-required' : 'default');
    setConfirmOwnOff(false);
    setResetArmedId(null);
    setError(''); setNotice('');
  };

  const saveMfa = async (p: Person) => {
    setSavingMfa(true); setError(''); setNotice('');
    try {
      const value = mfaDraft === 'default' ? null : mfaDraft === 'required';
      const res = await adminSend<{ profile: Person }>('PUT', `/api/v1/admin/staff/${p.id}/mfa-required`, { mfaRequired: value });
      setPeople((prev) => prev.map((x) => (x.id === p.id ? { ...x, mfaRequired: res.profile.mfaRequired } : x)));
      setMfaId(null);
      setNotice(`Two-factor setting saved for ${p.email ?? p.id} — it applies on their next sign-in.`);
    } catch (e) { setError((e as Error).message); }
    finally { setSavingMfa(false); }
  };

  const resetMfa = async (p: Person) => {
    setResetting(true); setError(''); setNotice('');
    try {
      const res = await adminSend<{ factorsRemoved: number }>('POST', `/api/v1/admin/staff/${p.id}/mfa/reset`);
      setResetArmedId(null);
      setNotice(res.factorsRemoved > 0
        ? `Two-factor reset for ${p.email ?? p.id} — ${res.factorsRemoved} factor${res.factorsRemoved === 1 ? '' : 's'} removed. They will set it up again at their next sign-in.`
        : `${p.email ?? p.id} had no two-factor factors to remove.`);
    } catch (e) { setError((e as Error).message); }
    finally { setResetting(false); }
  };

  const savePerson = async (p: Person) => {
    setSavingPerson(true); setError(''); setNotice('');
    try {
      const res = await adminSend<{ profile: Person }>('PUT', `/api/v1/admin/staff/${p.id}/permissions`, { permissions: draft });
      setPeople((prev) => prev.map((x) => (x.id === p.id ? { ...x, permissions: res.profile.permissions } : x)));
      setEditingId(null);
      setNotice(`Permissions saved for ${p.email ?? p.id} — they apply on their next request.`);
      refreshPermissions();
    } catch (e) { setError((e as Error).message); }
    finally { setSavingPerson(false); }
  };

  const editorFor = (p: Person) => {
    // Effective values resolve over the role's defaults; roles without
    // a defaults map (customer, admin) resolve over all-'none'. (The
    // owner's own row never gets an editor — owner access is fixed.)
    if ((p.role === 'manager' || p.role === 'staff') && !roleDefaults) {
      return (
        <tr>
          <td colSpan={4} className="px-[18px] py-4 bg-[#FDFBF7] border-t border-[#EFE9DB]">
            <LoadingNote />
          </td>
        </tr>
      );
    }
    const base: PermissionMap = p.role === 'manager' || p.role === 'staff'
      ? (roleDefaults?.[p.role] ?? NO_ACCESS_MAP)
      : NO_ACCESS_MAP;
    return (
      <tr>
        <td colSpan={4} className="px-[18px] py-4 bg-[#FDFBF7] border-t border-[#EFE9DB]">
          <p className="font-bodytext text-[12.5px] text-[#5C665C] mb-2 max-w-2xl">
            Set what {p.fullName ?? p.email ?? 'this person'} can see and do. Values shown are what they effectively
            have — a gold dot marks a person-specific override; without one, the {ROLE_LABELS[p.role] ?? p.role} default applies.
            {p.role === 'customer' && ' Overrides take effect if this account is given a staff or manager role.'}
          </p>
          <div className="grid md:grid-cols-2 gap-x-10 max-w-3xl">
            {SECTIONS.map(({ key, label }) => (
              <SectionLevelRow
                key={key}
                label={label}
                value={effectiveLevel(base, draft, key)}
                overridden={draft[key] !== undefined}
                onPick={(level) => setDraft((d) => ({ ...d, [key]: level }))}
                onReset={draft[key] !== undefined ? () => setDraft((d) => { const next = { ...d }; delete next[key]; return next; }) : undefined}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <button type="button" className={primaryBtn} disabled={savingPerson} onClick={() => void savePerson(p)}>
              {savingPerson ? 'Saving…' : 'Save permissions'}
            </button>
            <button type="button" className={ghostBtn} disabled={savingPerson} onClick={() => setDraft({})}>
              Reset to role default
            </button>
            <button type="button" className={ghostBtn} disabled={savingPerson} onClick={() => setEditingId(null)}>Close</button>
          </div>
        </td>
      </tr>
    );
  };

  const mfaEditorFor = (p: Person) => {
    const roleDefault = mfaRoleDefaultRequired(p.role);
    const current = p.mfaRequired === true
      ? 'Required — set for this person'
      : p.mfaRequired === false
        ? 'Not required — set for this person'
        : `Following the ${ROLE_LABELS[p.role] ?? p.role} default — ${roleDefault ? 'required' : 'not required'}`;
    const isSelf = p.id === user?.id;
    // Releasing the OWNER's own account is allowed (their restaurant,
    // their call) but never casually: the warning must be acknowledged
    // before Save arms. Only the explicit "Not required" choice
    // releases an owner — their role default is Required.
    const releasesSelf = isSelf && mfaDraft === 'not-required';
    return (
      <tr>
        <td colSpan={4} className="px-[18px] py-4 bg-[#FDFBF7] border-t border-[#EFE9DB]">
          <p className="font-bodytext text-[12.5px] text-[#5C665C] mb-2 max-w-2xl">
            Two-factor authentication for {p.fullName ?? p.email ?? 'this person'} — a 6-digit code from an
            authenticator app at every admin sign-in, on top of the password. Currently: <b className="text-[#16241A]">{current}</b>.
          </p>
          {p.mfaRequired === undefined && (
            <p className="font-bodytext text-[12.5px] text-[#B07C1E] mb-2 max-w-2xl">
              This setting takes effect once the latest database update is applied; until then, two-factor sign-in stays off for everyone.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-1">
            <button type="button" className={levelBtnCls(mfaDraft === 'default')} onClick={() => setMfaDraft('default')}>
              Default ({roleDefault ? 'On' : 'Off'})
            </button>
            <button type="button" className={levelBtnCls(mfaDraft === 'required')} onClick={() => setMfaDraft('required')}>
              Required
            </button>
            <button type="button" className={levelBtnCls(mfaDraft === 'not-required')} onClick={() => setMfaDraft('not-required')}>
              Not required
            </button>
          </div>
          {releasesSelf && (
            <div className="border border-[#B0492F]/40 bg-[#F9ECEC] rounded-[10px] px-4 py-3 mt-3 max-w-2xl">
              <p className="font-bodytext text-[13px] text-[#B0492F] font-semibold mb-1">You are turning off two-factor authentication for your own owner account.</p>
              <p className="font-bodytext text-[12.5px] text-[#B0492F] mb-2.5">
                The owner account controls everything — roles, permissions, settings, and this very switch. Without two-factor
                authentication, anyone who learns this password has the whole restaurant. Only continue if you are certain.
              </p>
              <label className="flex items-start gap-2 font-bodytext text-[12.5px] text-[#B0492F] cursor-pointer">
                <input type="checkbox" className="mt-[2px]" checked={confirmOwnOff} onChange={(e) => setConfirmOwnOff(e.target.checked)} />
                I understand the risk — turn off two-factor authentication for my owner account.
              </label>
            </div>
          )}
          <div className="flex flex-wrap gap-2 mt-4">
            <button type="button" className={primaryBtn} disabled={savingMfa || (releasesSelf && !confirmOwnOff)} onClick={() => void saveMfa(p)}>
              {savingMfa ? 'Saving…' : 'Save two-factor setting'}
            </button>
            <button type="button" className={ghostBtn} disabled={savingMfa} onClick={() => setMfaId(null)}>Close</button>
          </div>
          <div className="border-t border-[#EFE9DB] mt-5 pt-4 max-w-2xl">
            <p className="font-bodytext text-[12.5px] text-[#5C665C] mb-2">
              <b className="text-[#16241A]">Locked out?</b> If this person lost their authenticator, reset their two-factor
              authentication — every factor on the account is removed and they set it up again at their next sign-in.
            </p>
            {resetArmedId === p.id ? (
              <span className="inline-flex items-center gap-2 flex-wrap">
                <span className="font-bodytext text-[12px] font-medium text-[#B0492F]">Remove all two-factor factors for {p.email ?? p.id}?</span>
                <button type="button" className={chipDangerSolidBtn} disabled={resetting} onClick={() => void resetMfa(p)}>
                  {resetting ? 'Resetting…' : 'Confirm reset'}
                </button>
                <button type="button" className={chipGhostBtn} disabled={resetting} onClick={() => setResetArmedId(null)}>Cancel</button>
              </span>
            ) : (
              <button type="button" className={chipDangerBtn} onClick={() => setResetArmedId(p.id)}>Reset two-factor</button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  return (
    <div>
      <PageTitle sub="Roles are the starting point — adjust every section per role and per person">Staff &amp; Permissions</PageTitle>
      {error && <ErrorNote message={error} />}
      {notice && <NoticeNote message={notice} />}
      {!isOwner && loaded && (
        <p className="font-bodytext text-[13.5px] text-[#5C665C] mb-5">Only the owner can change roles and permissions — this list is read-only for you.</p>
      )}
      <Card className="overflow-hidden mb-8">
        {!loaded && !error && <LoadingNote />}
        {loaded && people.length === 0 && !error && <EmptyNote message="No accounts yet." />}
        {people.length > 0 && (
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead>
                <tr><th className={thCls}>Person</th><th className={thCls}>Joined</th><th className={thCls}>Role</th><th className={thCls}></th></tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <Fragment key={p.id}>
                    <tr className="hover:bg-[#FDFBF7]">
                      <td className={tdCls}>
                        <span className="flex items-center gap-2.5">
                          <Avatar name={p.fullName ?? p.email ?? '?'} />
                          <span>
                            <b className="font-semibold block">{p.fullName ?? '—'}</b>
                            <span className="block text-[12px] text-[#98A096]">{p.email ?? ''}</span>
                          </span>
                        </span>
                      </td>
                      <td className={`${tdCls} text-[#5C665C] whitespace-nowrap`}>{fmtDate(p.createdAt)}</td>
                      <td className={tdCls}>
                        {isOwner ? (
                          <select
                            aria-label={`Role for ${p.email ?? p.id}`}
                            className="h-9 px-2 rounded-lg border border-[#EAE3D3] bg-white font-bodytext text-[13px] text-[#16241A] disabled:opacity-50"
                            value={p.role}
                            disabled={p.id === user?.id}
                            onChange={(e) => void changeRole(p, e.target.value)}
                          >
                            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                          </select>
                        ) : (
                          <span className="inline-flex px-2.5 py-[3px] rounded-full bg-[#EFE9DB] text-[#5C665C] font-bodytext text-[11px] font-semibold">{ROLE_LABELS[p.role] ?? p.role}</span>
                        )}
                        {p.id === user?.id && <span className="block text-[11.5px] text-[#98A096] mt-1">That's you — your own role can't be changed here.</span>}
                      </td>
                      <td className={tdCls}>
                        {isOwner && (
                          <span className="flex justify-end gap-2 flex-wrap">
                            {p.id !== user?.id && (
                              <button type="button" className={ghostBtn} onClick={() => (editingId === p.id ? setEditingId(null) : openEditor(p))}>
                                {editingId === p.id ? 'Close' : 'Permissions'}
                              </button>
                            )}
                            <button type="button" className={ghostBtn} onClick={() => (mfaId === p.id ? setMfaId(null) : openMfa(p))}>
                              {mfaId === p.id ? 'Close' : 'Two-factor'}
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                    {isOwner && editingId === p.id && editorFor(p)}
                    {isOwner && mfaId === p.id && mfaEditorFor(p)}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {loaded && total > 0 && (
        <p className="font-bodytext text-[12.5px] text-[#98A096] -mt-4 mb-8">Showing {people.length} of {total} accounts</p>
      )}
      {loaded && people.length < total && (
        <div className="-mt-4 mb-8">
          <button type="button" className={ghostBtn} disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {isOwner && defaultsDraft && (
        <div className="grid lg:grid-cols-2 gap-5 items-start">
          {(['manager', 'staff'] as const).map((role) => (
            <Card key={role} className="px-[18px] py-4">
              <h2 className="font-display text-[19px] font-semibold text-[#16241A] mb-1">{ROLE_LABELS[role]} defaults</h2>
              <p className="font-bodytext text-[12.5px] text-[#5C665C] mb-2">
                The starting point for every {ROLE_LABELS[role].toLowerCase()} — a person's own overrides win over these.
              </p>
              <div className="divide-y divide-[#EFE9DB]">
                {SECTIONS.map(({ key, label }) => (
                  <SectionLevelRow
                    key={key}
                    label={label}
                    value={defaultsDraft[role][key]}
                    onPick={(level) => setDefaultsDraft((prev) => (prev ? { ...prev, [role]: { ...prev[role], [key]: level } } : prev))}
                  />
                ))}
              </div>
              <div className="mt-4">
                <button type="button" className={primaryBtn} disabled={savingDefaults === role} onClick={() => void saveDefaults(role)}>
                  {savingDefaults === role ? 'Saving…' : `Save ${ROLE_LABELS[role].toLowerCase()} defaults`}
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
      {isOwner && !roleDefaults && !error && <LoadingNote />}
    </div>
  );
}
