import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { signInWithEmail } from '../../services/auth';
import { reportAdminSessionEvent } from '../../services/sessionEvents';
import AdminOrders from '../../pages/admin/AdminOrders';
import { usePermissions } from './PermissionsContext';
import { clearPersistedScreenLock, useLock } from './LockContext';
import { friendlyMfaError } from '../../lib/mfa';
import { ghostBtn, inputCls, labelCls, primaryBtn } from './ui';

/**
 * The locked admin screen (Phase D). Renders INSTEAD of the whole
 * shell — no sidebar, no other section, whatever URL was asked for —
 * with exactly two things on it:
 *
 *   - the live Orders board: the same AdminOrders component the
 *     unlocked shell routes to, so it fetches and refreshes exactly
 *     as unlocked; the lock state masks its customer PII (via the
 *     Pii component) and removes its write controls;
 *   - the Unlock panel: a step-up verification for the signed-in
 *     account — password re-entry, plus a current TOTP code when
 *     the account holds a verified factor.
 */

function UnlockPanel() {
  const { user, profile, signOut } = useAuth();
  const { unlock } = useLock();
  const { refresh } = usePermissions();
  const email = user?.email ?? profile?.email ?? '';
  const [step, setStep] = useState<'password' | 'totp'>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const finish = () => {
    // The step-up just re-created (and, with TOTP, re-raised) the
    // session — re-read /admin/me so the shell's permission and MFA
    // picture matches the token it now holds, then open the screen.
    refresh();
    unlock();
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !email || !password) return;
    setBusy(true);
    setError('');
    // Same sign-in service (and the same friendly error surface) as
    // the admin login page — a wrong password is a plain sign-in
    // failure here: the lock stays, the error shows, nothing else
    // happens. Supabase's own rate limiting applies to this call.
    const res = await signInWithEmail(email, password);
    if (res.error) {
      setError(res.error);
      setPassword('');
      setBusy(false);
      return;
    }
    setPassword('');
    // Password accepted. If the account holds a VERIFIED TOTP
    // factor, a current code is also required before unlocking —
    // the factor, not the backend's mfa_required flag, is what makes
    // the second step apply to this screen.
    if (!supabase) {
      finish();
      return;
    }
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      setError(friendlyMfaError(listError.message));
      setBusy(false);
      return;
    }
    const verified = (data?.all ?? []).find((f) => f.factor_type === 'totp' && f.status === 'verified');
    setBusy(false);
    if (!verified) {
      finish();
      return;
    }
    setFactorId(verified.id);
    setStep('totp');
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || busy || code.length !== 6) return;
    setBusy(true);
    setError('');
    // The same challenge + verify the sign-in MFA flow performs;
    // success returns the (just re-created) session to aal2.
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error || !challenge.data) {
      setError(friendlyMfaError(challenge.error?.message));
      setBusy(false);
      return;
    }
    const verified = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code: code.trim() });
    if (verified.error) {
      setError(friendlyMfaError(verified.error.message));
      setCode('');
      setBusy(false);
      return;
    }
    // The one session event that fits what just happened: a real
    // MFA verification of this session — the same event the sign-in
    // flow reports for the same operation. (A password-only unlock
    // reports nothing: it is not a login, and no other event in the
    // Phase C vocabulary describes it.)
    void reportAdminSessionEvent('mfa_verified');
    finish();
  };

  // Leaving from a locked screen is still an admin sign-out: report
  // it before the token goes, and drop the persisted lock flag so
  // the next sign-in in this tab starts from an open screen.
  const handleSignOut = async () => {
    await reportAdminSessionEvent('logout');
    clearPersistedScreenLock();
    await signOut();
  };

  return (
    <div className="w-full max-w-sm mx-auto xl:mx-0 bg-white border border-[#EAE3D3] rounded-2xl px-6 py-8 sm:px-8 shadow-[0_18px_40px_-24px_rgba(22,36,26,0.35)] text-center">
      <span className="mx-auto mb-4 w-[46px] h-[46px] rounded-full border border-[#C17A3A]/50 text-[#C17A3A] flex items-center justify-center shadow-[0_0_0_4px_rgba(193,122,58,0.10)]">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
      </span>
      <h1 className="font-display text-[26px] font-semibold text-[#16241A] mb-2">Screen locked</h1>
      <p className="font-bodytext text-[#5C665C] text-sm">
        This screen locked to protect customer details. Orders keep updating below — enter your password to pick up where you left off.
      </p>
      {email && (
        <p className="font-bodytext text-[13px] text-[#16241A] mt-3">
          Signed in as <span className="font-semibold">{email}</span>
        </p>
      )}

      {step === 'password' && (
        <form onSubmit={(e) => void submitPassword(e)} className="mt-5 text-left">
          <label className={labelCls} htmlFor="unlock-password">Your password</label>
          <input
            id="unlock-password"
            type="password"
            required
            autoComplete="current-password"
            className={inputCls}
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && <p role="alert" className="font-bodytext text-[13px] text-[#B0492F] mt-3 text-center">{error}</p>}
          <button type="submit" className={`${primaryBtn} w-full mt-4`} disabled={busy || !password}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </form>
      )}

      {step === 'totp' && (
        <form onSubmit={(e) => void submitCode(e)} className="mt-5 text-left">
          <p className="font-bodytext text-[#5C665C] text-sm text-center mb-4">
            Password accepted. Enter the 6-digit code from your authenticator app to finish unlocking.
          </p>
          <label className={labelCls} htmlFor="unlock-code">6-digit code</label>
          <input
            id="unlock-code"
            className={`${inputCls} text-center tracking-[0.35em] font-semibold`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="••••••"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          {error && <p role="alert" className="font-bodytext text-[13px] text-[#B0492F] mt-3 text-center">{error}</p>}
          <button type="submit" className={`${primaryBtn} w-full mt-4`} disabled={busy || code.length !== 6}>
            {busy ? 'Verifying…' : 'Verify and unlock'}
          </button>
        </form>
      )}

      <div className="mt-6 pt-4 border-t border-[#EFE9DB]">
        <button type="button" onClick={() => void handleSignOut()} className={`${ghostBtn} w-full`}>
          Sign out
        </button>
      </div>
    </div>
  );
}

export default function LockedView() {
  const { user, profile } = useAuth();
  const { can } = usePermissions();
  const email = user?.email ?? profile?.email ?? '';
  return (
    <div className="min-h-screen bg-[#F7F4EE] text-[#16241A] font-bodytext flex flex-col">
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-[#EAE3D3]">
        <div className="w-full max-w-[1440px] mx-auto px-5 md:px-[30px] py-3 flex items-center justify-between gap-3 min-w-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-[34px] h-[34px] rounded-full border border-[#C17A3A]/50 text-[#C17A3A] flex items-center justify-center font-display text-[17px] shadow-[0_0_0_4px_rgba(193,122,58,0.10)] shrink-0"><img src="/ember-co-monogram.svg" alt="" className="w-[18px] h-[18px]" /></span>
            <p className="font-display text-[19px] font-semibold leading-none text-[#16241A] whitespace-nowrap">Ember &amp; Co.</p>
          </div>
          <p className="font-bodytext text-[12px] text-[#5C665C] flex items-center gap-2 min-w-0">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
            <span className="font-semibold text-[#16241A] whitespace-nowrap">Screen locked</span>
            {email && <span className="truncate hidden sm:inline">· {email}</span>}
          </p>
        </div>
      </header>
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-5 py-6 md:px-[30px] md:py-[26px]">
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_370px] items-start">
          <div className="order-2 xl:order-1 min-w-0">
            {can('orders', 'view') ? (
              <AdminOrders />
            ) : (
              <div className="bg-white border border-[#EAE3D3] rounded-[14px] px-6 py-10 text-center">
                <p className="font-bodytext text-[#5C665C] text-sm">
                  The live orders board is not part of your account's access. Unlock the screen to continue.
                </p>
              </div>
            )}
          </div>
          <div className="order-1 xl:order-2 xl:sticky xl:top-[74px]">
            <UnlockPanel />
          </div>
        </div>
      </main>
    </div>
  );
}
