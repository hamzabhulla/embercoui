import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { friendlyMfaError } from '../../lib/mfa';
import { useAuth } from '../../context/AuthContext';
import { reportAdminSessionEvent } from '../../services/sessionEvents';
import { clearPersistedScreenLock } from './LockContext';
import { ghostBtn, inputCls, labelCls, primaryBtn } from './ui';

/**
 * The two-factor step of admin sign-in (Phase B): Supabase Auth TOTP,
 * driven entirely through supabase-js auth.mfa — no custom TOTP
 * anywhere. Shown when GET /admin/me reports the caller's requirement
 * as unsatisfied, both on /admin/login and inside the admin shell;
 * the caller decides enrollment vs challenge from the account's OWN
 * factors:
 *
 *   - a verified TOTP factor exists → challenge + verify;
 *   - none exists → enroll (QR + secret), then challenge + verify
 *     against the new factor to complete the enrollment;
 *   - only UNVERIFIED factors exist → an earlier enrollment was
 *     abandoned mid-way; those factors are removed first, because a
 *     fresh enroll would collide with them.
 *
 * A successful verify upgrades the session to aal2, after which the
 * parent re-reads /admin/me (onVerified) and lets the caller in.
 */

export default function MfaFlow({ onVerified }: { onVerified: () => void }) {
  const { signOut } = useAuth();
  const [phase, setPhase] = useState<'loading' | 'enroll' | 'challenge' | 'error'>('loading');
  const [factorId, setFactorId] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const startedFor = useRef(-1);

  const setup = useCallback(async () => {
    if (!supabase) {
      setError('Accounts are not available at the moment — please check back soon.');
      setPhase('error');
      return;
    }
    setPhase('loading');
    setError('');
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) {
      setError(friendlyMfaError(listError.message));
      setPhase('error');
      return;
    }
    const totp = (data?.all ?? []).filter((f) => f.factor_type === 'totp');
    const verified = totp.find((f) => f.status === 'verified');
    if (verified) {
      setFactorId(verified.id);
      setPhase('challenge');
      return;
    }
    // Abandoned enrollments leave unverified factors behind; clear
    // them so the fresh enrollment below cannot collide with one.
    for (const stale of totp) {
      await supabase.auth.mfa.unenroll({ factorId: stale.id });
    }
    const enrolled = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Ember & Co. admin' });
    if (enrolled.error || !enrolled.data) {
      setError(friendlyMfaError(enrolled.error?.message));
      setPhase('error');
      return;
    }
    setFactorId(enrolled.data.id);
    setQrCode(enrolled.data.totp.qr_code);
    setSecret(enrolled.data.totp.secret);
    setPhase('enroll');
  }, []);

  useEffect(() => {
    // One setup per attempt — the guard keeps a remount/double-effect
    // from enrolling twice (which would plant a second factor).
    if (startedFor.current === attempt) return;
    startedFor.current = attempt;
    void setup();
  }, [attempt, setup]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || busy || code.length !== 6) return;
    setBusy(true);
    setError('');
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
    // The session is now aal2; the parent re-reads /admin/me and
    // routes the caller into the panel. Login Activity (Phase C):
    // the verification moment is reported first, while this session
    // is the verified one — for an enrollment this same verify is
    // what completes the setup, so it is the one event either way.
    void reportAdminSessionEvent('mfa_verified');
    onVerified();
  };

  // Signing out mid-flow is still an admin sign-out: report it
  // before the token goes (Login Activity, Phase C), and drop any
  // persisted screen-lock flag (Phase D) so the next sign-in in this
  // tab does not inherit it.
  const handleSignOut = async () => {
    await reportAdminSessionEvent('logout');
    clearPersistedScreenLock();
    await signOut();
  };

  const codeForm = (
    <form onSubmit={(e) => void submit(e)} className="mt-5 text-left">
      <label className={labelCls} htmlFor="mfa-code">6-digit code</label>
      <input
        id="mfa-code"
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
        {busy ? 'Verifying…' : 'Verify and continue'}
      </button>
    </form>
  );

  return (
    <div className="w-full max-w-sm bg-white border border-[#EAE3D3] rounded-2xl px-6 py-8 sm:px-8 shadow-[0_18px_40px_-24px_rgba(22,36,26,0.35)] text-center">
      <span className="mx-auto mb-4 w-[46px] h-[46px] rounded-full border border-[#C17A3A]/50 text-[#C17A3A] flex items-center justify-center font-display text-[22px] shadow-[0_0_0_4px_rgba(193,122,58,0.10)]"><img src="/ember-co-monogram.svg" alt="" className="w-[24px] h-[24px]" /></span>

      {phase === 'loading' && (
        <p className="font-bodytext text-[#98A096] tracking-[0.2em] uppercase text-xs py-6">Loading…</p>
      )}

      {phase === 'error' && (
        <>
          <h1 className="font-display text-[26px] font-semibold text-[#16241A] mb-2">Two-factor unavailable</h1>
          <p role="alert" className="font-bodytext text-[#B0492F] text-sm mb-6">{error}</p>
          <button type="button" className={primaryBtn} onClick={() => setAttempt((a) => a + 1)}>Try again</button>
        </>
      )}

      {phase === 'enroll' && (
        <>
          <h1 className="font-display text-[26px] font-semibold text-[#16241A] mb-2">Set up two-factor authentication</h1>
          <p className="font-bodytext text-[#5C665C] text-sm">
            Your account requires two-factor authentication. Scan this code with your authenticator app, then enter the 6-digit code it shows.
          </p>
          {qrCode && <img src={qrCode} alt="Two-factor setup QR code" className="w-[180px] h-[180px] mx-auto mt-5" />}
          {secret && (
            <p className="font-bodytext text-[12.5px] text-[#5C665C] mt-4">
              Can't scan it? Enter this key manually:
              <span className="block font-mono text-[13px] text-[#16241A] break-all mt-1 select-all">{secret}</span>
            </p>
          )}
          {codeForm}
        </>
      )}

      {phase === 'challenge' && (
        <>
          <h1 className="font-display text-[26px] font-semibold text-[#16241A] mb-2">Two-factor verification</h1>
          <p className="font-bodytext text-[#5C665C] text-sm">
            Enter the 6-digit code from your authenticator app to continue to the admin panel.
          </p>
          {codeForm}
        </>
      )}

      {phase !== 'loading' && (
        <div className="mt-6 pt-4 border-t border-[#EFE9DB]">
          <button type="button" onClick={() => void handleSignOut()} className={`${ghostBtn} w-full`}>
            Sign out
          </button>
          <p className="font-bodytext text-[12px] text-[#98A096] mt-3">
            Locked out? Ask the owner to reset your two-factor authentication from Staff &amp; Permissions.
          </p>
        </div>
      )}
    </div>
  );
}
