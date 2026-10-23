import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { signInWithEmail } from '../../services/auth';
import { adminGet } from '../../services/adminApi';
import { reportAdminLoginFailed, reportAdminSessionEvent } from '../../services/sessionEvents';
import type { AdminMe } from '../../components/admin/PermissionsContext';
import MfaFlow from '../../components/admin/MfaFlow';
import { ghostBtn, inputCls, labelCls, primaryBtn } from '../../components/admin/ui';

/**
 * The dedicated admin sign-in (Phase B) — replaces the old redirect
 * shim that bounced admins into the customer auth screens. Sign-in
 * ONLY (accounts are created on the main website / by the owner;
 * there is deliberately no sign-up here), in the admin design system.
 *
 * The page is a small state machine over the session + GET /admin/me:
 *   signed out            → the sign-in form;
 *   signed-in customer    → an honest "no admin access" state with a
 *                           sign-out — never a silent bounce;
 *   privileged, MFA due   → the enrollment/challenge flow (MfaFlow);
 *   privileged, satisfied → straight into /admin.
 * The MFA decision is the backend's (/me), never a local guess.
 */

const PRIVILEGED_ROLES = ['admin', 'manager', 'staff'];

function Page({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#F7F4EE] flex items-center justify-center px-4 py-10">
      {children}
    </div>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-sm bg-white border border-[#EAE3D3] rounded-2xl px-6 py-8 sm:px-8 shadow-[0_18px_40px_-24px_rgba(22,36,26,0.35)] text-center">
      {children}
    </div>
  );
}

function Brand() {
  return (
    <>
      <span className="mx-auto mb-4 w-[46px] h-[46px] rounded-full border border-[#C17A3A]/50 text-[#C17A3A] flex items-center justify-center font-display text-[22px] shadow-[0_0_0_4px_rgba(193,122,58,0.10)]"><img src="/ember-co-monogram.svg" alt="" className="w-[24px] h-[24px]" /></span>
      <h1 className="font-display text-[26px] font-semibold text-[#16241A]">Ember &amp; Co.</h1>
      <p className="font-bodytext text-[10px] tracking-[0.26em] uppercase text-[#98A096] mt-1 mb-6">Admin Console</p>
    </>
  );
}

function Checking() {
  return (
    <Page>
      <p className="font-bodytext text-[#98A096] tracking-[0.2em] uppercase text-xs">Checking access…</p>
    </Page>
  );
}

export default function AdminLogin() {
  const { user, profile, loading, profileLoading, profileError, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [signInError, setSignInError] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [me, setMe] = useState<AdminMe | null>(null);
  const [meError, setMeError] = useState('');
  const [meTick, setMeTick] = useState(0);
  // Login Activity (Phase C): set only when THIS page performed the
  // password sign-in — a returning admin who lands here with a live
  // session did not just sign in, and must not be logged as one.
  const signedInHere = useRef(false);

  const privileged = !!profile && PRIVILEGED_ROLES.includes(profile.role);

  // The verified login event fires once the account is known to be
  // privileged (the backend writes the row from the verified token;
  // for an MFA-required account this is the password moment — the
  // verification itself is reported separately by the MFA flow).
  useEffect(() => {
    if (privileged && signedInHere.current) {
      signedInHere.current = false;
      void reportAdminSessionEvent('login');
    }
  }, [privileged]);

  // Sign-out from this page's privileged states: report the logout
  // before the token is discarded (the no-access state below is a
  // customer account — it has no admin session to record).
  const signOutWithReport = async () => {
    await reportAdminSessionEvent('logout');
    await signOut();
  };

  // Once a privileged session exists, the backend's /me decides
  // between the MFA flow and the panel. Keyed to the user id so a
  // stale answer from a previous session can never route this one.
  useEffect(() => {
    if (!user || !privileged) return;
    let active = true;
    adminGet<AdminMe>('/api/v1/admin/me')
      .then((d) => { if (active) { setMe(d); setMeError(''); } })
      .catch((e: Error) => { if (active) setMeError(e.message); });
    return () => { active = false; };
  }, [user, privileged, meTick]);

  if (loading || (user && !profile && profileLoading)) return <Checking />;

  if (!user) {
    const submit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (signingIn) return;
      setSigningIn(true);
      setSignInError('');
      const res = await signInWithEmail(email.trim(), password);
      if (res.error) {
        // The failure happened inside Supabase Auth and never reached
        // the backend — report it (fire-and-forget) so it can appear
        // in Login Activity as what it is: an UNVERIFIED client
        // report. The outcome of the report changes nothing here.
        void reportAdminLoginFailed(email.trim());
        setSignInError(res.error);
        setSigningIn(false);
      } else {
        signedInHere.current = true;
      }
      // On success the AuthContext picks the session up and this page
      // advances on its own — nothing to navigate to manually.
    };
    return (
      <Page>
        <Card>
          <Brand />
          <form onSubmit={(e) => void submit(e)} className="text-left">
            <label className={labelCls} htmlFor="admin-email">Email</label>
            <input
              id="admin-email" type="email" required autoComplete="username" className={`${inputCls} mb-4`}
              placeholder="you@restaurant.com" value={email} onChange={(e) => setEmail(e.target.value)}
            />
            <label className={labelCls} htmlFor="admin-password">Password</label>
            <input
              id="admin-password" type="password" required autoComplete="current-password" className={inputCls}
              placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)}
            />
            {signInError && <p role="alert" className="font-bodytext text-[13px] text-[#B0492F] mt-3">{signInError}</p>}
            <button type="submit" className={`${primaryBtn} w-full mt-5`} disabled={signingIn}>
              {signingIn ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <div className="mt-5 flex items-center justify-between gap-3">
            <button type="button" onClick={() => navigate('/forgot-password')} className="font-bodytext text-[12.5px] font-medium text-[#8A551F] underline underline-offset-2">
              Forgot your password?
            </button>
            <button type="button" onClick={() => navigate('/')} className="font-bodytext text-[12.5px] font-medium text-[#5C665C] underline underline-offset-2">
              Back to website
            </button>
          </div>
          <p className="font-bodytext text-[12px] text-[#98A096] mt-5 pt-4 border-t border-[#EFE9DB]">
            This page is sign-in only. Accounts are created on the main website, and admin access is granted by the owner.
          </p>
        </Card>
      </Page>
    );
  }

  if (!profile && profileError) {
    // The session is real but the profile fetch failed: retry, never
    // a permissions denial — the account's role is simply unknown.
    return (
      <Page>
        <Card>
          <Brand />
          <h2 className="font-display text-[22px] font-semibold text-[#16241A] mb-2">We couldn't load your account</h2>
          <p className="font-bodytext text-[#5C665C] text-sm mb-6">{profileError}</p>
          <div className="flex gap-2 justify-center">
            <button type="button" onClick={() => void refreshProfile()} className={primaryBtn}>Retry</button>
            <button type="button" onClick={() => void signOutWithReport()} className={ghostBtn}>Sign out</button>
          </div>
        </Card>
      </Page>
    );
  }

  if (!profile) return <Checking />;

  if (!privileged) {
    return (
      <Page>
        <Card>
          <Brand />
          <h2 className="font-display text-[22px] font-semibold text-[#16241A] mb-2">No admin access</h2>
          <p className="font-bodytext text-[#5C665C] text-sm mb-6">
            This account{profile.email ? <> (<span className="font-medium text-[#16241A]">{profile.email}</span>)</> : ''} doesn't
            have admin access. If you work at the restaurant, ask the owner to grant your account a staff or manager role.
          </p>
          <div className="flex gap-2 justify-center">
            <button type="button" onClick={() => void signOut()} className={primaryBtn}>Sign out</button>
            <button type="button" onClick={() => navigate('/')} className={ghostBtn}>Back to website</button>
          </div>
        </Card>
      </Page>
    );
  }

  // Privileged: /me arbitrates. A stale /me from a previous user id
  // never routes this session.
  const myMe = me && me.id === user.id ? me : null;
  if (!myMe && meError) {
    return (
      <Page>
        <Card>
          <Brand />
          <h2 className="font-display text-[22px] font-semibold text-[#16241A] mb-2">We couldn't verify your access</h2>
          <p className="font-bodytext text-[#5C665C] text-sm mb-6">{meError}</p>
          <div className="flex gap-2 justify-center">
            <button type="button" onClick={() => { setMeError(''); setMeTick((t) => t + 1); }} className={primaryBtn}>Retry</button>
            <button type="button" onClick={() => void signOutWithReport()} className={ghostBtn}>Sign out</button>
          </div>
        </Card>
      </Page>
    );
  }
  if (!myMe) return <Checking />;
  if (myMe.mfa.required && !myMe.mfa.satisfied) {
    return (
      <Page>
        <MfaFlow onVerified={() => setMeTick((t) => t + 1)} />
      </Page>
    );
  }
  return <Navigate to="/admin" replace />;
}
