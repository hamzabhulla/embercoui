import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { signInWithEmail, signInWithGoogle } from '../../services/auth';
import { reportAdminSessionEvent } from '../../services/sessionEvents';
import AdminOrders from '../../pages/admin/AdminOrders';
import { usePermissions } from './PermissionsContext';
import { clearPersistedScreenLock, useLock } from './LockContext';
import { clearUnlockIntent, persistUnlockIntent } from '../../lib/screenLock';
import { GoogleIcon } from '../auth/GoogleButton';
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
 *     account — re-proving ownership of the account by the method
 *     the account actually has: password re-entry for password
 *     accounts, a Google OAuth round-trip for Google accounts —
 *     plus a current TOTP code when the account holds a verified
 *     factor.
 */

/**
 * The account's sign-in providers, read off the Supabase user the
 * session carries: `app_metadata.providers` is the authoritative
 * list (with `app_metadata.provider` as its original single entry
 * and the user's identities as a fallback). A user object that
 * exposes none of these is treated as an email/password account —
 * the pre-OAuth default, so nothing about the password path changes
 * for accounts that carry no provider metadata.
 */
function accountProviders(user: User | null): string[] {
  const meta = (user?.app_metadata ?? {}) as { provider?: unknown; providers?: unknown };
  if (Array.isArray(meta.providers)) {
    const list = meta.providers.filter((p): p is string => typeof p === 'string' && p !== '');
    if (list.length > 0) return list;
  }
  if (typeof meta.provider === 'string' && meta.provider !== '') return [meta.provider];
  const fromIdentities = (user?.identities ?? [])
    .map((identity) => identity?.provider)
    .filter((p): p is string => typeof p === 'string' && p !== '');
  if (fromIdentities.length > 0) return [...new Set(fromIdentities)];
  return ['email'];
}

type ProofKind = 'password' | 'google';

function UnlockPanel() {
  const { user, profile, signOut } = useAuth();
  const { unlock, googleProof } = useLock();
  const { refresh } = usePermissions();
  const location = useLocation();
  const email = user?.email ?? profile?.email ?? '';
  // Which proofs this account can offer decides the panel's shape:
  // the password form only ever renders for an account that HAS a
  // password (a Google-only account could never satisfy it — showing
  // it as the sole path was the lockout this fixes); the Google
  // button renders whenever the account holds a Google identity.
  const providers = accountProviders(user);
  const hasPassword = providers.includes('email');
  const hasGoogle = providers.includes('google');
  const [step, setStep] = useState<'password' | 'totp'>('password');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [factorId, setFactorId] = useState('');
  const [proofKind, setProofKind] = useState<ProofKind>('password');
  const [error, setError] = useState('');
  const [googleError, setGoogleError] = useState('');
  const [busy, setBusy] = useState(false);

  const finish = () => {
    // The step-up just re-created (and, with TOTP, re-raised) the
    // session — re-read /admin/me so the shell's permission and MFA
    // picture matches the token it now holds, then open the screen.
    refresh();
    unlock();
  };

  /**
   * The one post-proof pipeline, shared by every identity proof —
   * password re-entry and the Google round-trip alike. If the
   * account holds a VERIFIED TOTP factor, a current code is also
   * required before unlocking — the factor, not the backend's
   * mfa_required flag, is what makes the second step apply to this
   * screen. `kind` only names how identity was proven, so the code
   * step's wording never credits the wrong method.
   */
  const continueAfterProof = async (kind: ProofKind) => {
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
    setProofKind(kind);
    setFactorId(verified.id);
    setStep('totp');
  };

  // Returning from the Google round-trip: LockProvider has already
  // consumed and validated the planted intent (this account, fresh,
  // and a sign-in that postdates it) and exposed it as googleProof.
  // That IS the identity proof — run the same post-proof pipeline
  // the password path runs, exactly once per panel mount. Nothing
  // here unmasks or unlocks by itself: the pipeline decides (code
  // step or finish) precisely as it does after a password.
  const proofHandled = useRef(false);
  const pipelineRef = useRef(continueAfterProof);
  pipelineRef.current = continueAfterProof;
  useEffect(() => {
    if (!googleProof || proofHandled.current) return;
    proofHandled.current = true;
    setBusy(true);
    setError('');
    void pipelineRef.current('google');
  }, [googleProof]);

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
    // Password accepted — the shared post-proof pipeline takes it
    // from here (code step only when a verified factor exists).
    await continueAfterProof('password');
  };

  const startGoogleUnlock = async () => {
    if (busy || !user) return;
    setBusy(true);
    setGoogleError('');
    // Plant the intent BEFORE leaving: the return landing needs it
    // to tell this round-trip apart from an ordinary locked visit,
    // it binds the proof to THIS account, and it carries the admin
    // path the user is on — the OAuth redirect asks to come back
    // here too, but the landing cannot be trusted to honour it (in
    // practice it is the site root), so the intent's copy of the
    // path is the one the return courier (UnlockReturnCourier)
    // acts on, from wherever the browser actually comes down.
    persistUnlockIntent(user.id, Date.now(), location.pathname);
    // The same OAuth sign-in the login pages use, returning to the
    // admin path the user was on when the screen locked.
    const res = await signInWithGoogle(location.pathname);
    if (res.error) {
      // The round-trip never started (e.g. the provider is not
      // enabled yet): no landing is coming, so no intent may linger
      // for one — and the message stays in the panel's own voice,
      // never the provider's raw wording.
      clearUnlockIntent();
      setGoogleError(hasPassword
        ? "Google verification isn't available right now — please use your password instead."
        : "Google verification isn't available right now — please sign out below and sign back in to continue.");
      setBusy(false);
    }
    // On success the browser is already navigating to Google; the
    // busy state simply stands until the page goes away.
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
        {hasPassword
          ? 'This screen locked to protect customer details. Orders keep updating below — enter your password to pick up where you left off.'
          : "This screen locked to protect customer details. Orders keep updating below — verify it's you with Google to pick up where you left off."}
      </p>
      {email && (
        <p className="font-bodytext text-[13px] text-[#16241A] mt-3">
          Signed in as <span className="font-semibold">{email}</span>
        </p>
      )}

      {step === 'password' && (
        <>
          {hasPassword && (
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
          {hasGoogle && (
            <div className="mt-5">
              {hasPassword && (
                <div className="flex items-center gap-3 mb-4" aria-hidden="true">
                  <span className="h-px flex-1 bg-[#EFE9DB]" />
                  <span className="font-bodytext text-[11px] tracking-[0.14em] uppercase text-[#98A096]">or</span>
                  <span className="h-px flex-1 bg-[#EFE9DB]" />
                </div>
              )}
              <button
                type="button"
                onClick={() => void startGoogleUnlock()}
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2.5 h-[42px] rounded-[10px] bg-white border border-[#EAE3D3] text-[#16241A] font-bodytext text-[13px] font-medium hover:bg-[#FBF8F1] transition disabled:opacity-50 cursor-pointer"
              >
                <GoogleIcon />
                {busy ? 'Redirecting to Google…' : 'Verify with Google'}
              </button>
              {googleError && <p role="alert" className="font-bodytext text-[13px] text-[#B0492F] mt-3 text-center">{googleError}</p>}
            </div>
          )}
        </>
      )}

      {step === 'totp' && (
        <form onSubmit={(e) => void submitCode(e)} className="mt-5 text-left">
          <p className="font-bodytext text-[#5C665C] text-sm text-center mb-4">
            {proofKind === 'google'
              ? 'Identity verified. Enter the 6-digit code from your authenticator app to finish unlocking.'
              : 'Password accepted. Enter the 6-digit code from your authenticator app to finish unlocking.'}
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
