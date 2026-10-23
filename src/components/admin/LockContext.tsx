/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  clearPersistedScreenLock,
  clearUnlockIntent,
  consumeUnlockIntent,
  persistScreenLock,
  readPersistedScreenLock,
  type UnlockIntent,
} from '../../lib/screenLock';

/**
 * The admin screen lock (Phase D) — a screen-privacy lock for a
 * signed-in session, and nothing more. The orders board runs on a
 * shared screen for hours; after 15 minutes without activity the
 * shell locks: the live board stays up with customer PII masked and
 * every write control gone, and getting back in takes the account's
 * password (plus a TOTP code when the account holds a verified
 * factor — see LockedView).
 *
 * The state is deliberately FRONTEND-only: sessionStorage gives it
 * screen-lock semantics (survives a refresh of this tab, dies with
 * the tab, cleared on sign-out and on unlock). It is not a session
 * or permission mechanism — the backend keeps enforcing roles,
 * section permissions and the MFA aal gate on every request exactly
 * as before, locked or not.
 *
 * The persisted record names the account that set the lock, and a
 * cold mount honours it ONLY for that account (see lib/screenLock):
 * a board left locked overnight whose session expired must never
 * greet the morning's different sign-in with the previous account's
 * lock. The restore waits until the auth state has resolved — the
 * same sequencing the guard and the shell already apply to /me and
 * the profile — so a rightful owner's lock is never discarded for
 * arriving a tick before their identity, and no account ever sees
 * a locked screen flash for a lock that isn't theirs.
 *
 * Accounts that signed in with Google hold no password, so for them
 * the unlock step-up is a Google OAuth round-trip (see LockedView):
 * the panel plants an unlock intent (lib/screenLock), leaves for
 * Google, and the browser lands wherever the provider sends it —
 * in practice the site root, where this provider is not even
 * mounted. The return courier (UnlockReturnCourier, at the app
 * root) reads the intent's stored return path on that landing and
 * navigates back here; the intent itself it leaves untouched,
 * because consuming it is this provider's proof. This provider
 * consumes the intent at
 * the same reconciliation that restores the lock, and exposes the
 * outcome as `googleProof` ONLY when all three hold: the persisted
 * lock is this account's, the intent names this account and is
 * fresh, and the session in hand was signed in AFTER the intent
 * was planted (`last_sign_in_at`, allowing a minute of clock skew).
 * The third condition is what separates a completed round-trip from
 * a cancelled one: backing out at Google returns with the OLD
 * session, whose sign-in predates the intent, and proves nothing.
 * A consumed intent is gone in every case — never replayable.
 */

export { clearPersistedScreenLock };
export const IDLE_LIMIT_MS = 15 * 60 * 1000;

interface LockContextType {
  locked: boolean;
  /** Lock immediately (the manual "Lock screen" control). */
  lock: () => void;
  /** Clear the lock — called by the unlock panel ONLY after the
   *  password (and TOTP, when applicable) step-up has succeeded. */
  unlock: () => void;
  /** True only on the landing from a completed Google unlock
   *  round-trip whose intent this provider consumed and validated
   *  (see the header note). The unlock panel treats it as the
   *  identity proof and runs its post-proof pipeline; it is never
   *  set by anything the panel itself does. */
  googleProof: boolean;
}

/**
 * The sign-in half of the Google-proof check: the session in hand
 * must have been signed in after the intent was planted. Supabase
 * stamps `last_sign_in_at` on every completed sign-in (password or
 * OAuth) and never on a token refresh, so a cancelled round-trip —
 * which returns with the previous session untouched — fails this,
 * while a completed one passes. A minute of skew is allowed between
 * the browser clock that stamped the intent and the server clock
 * that stamped the sign-in; anything older is the old session.
 */
const REAUTH_SKEW_MS = 60 * 1000;
function intentProvesReauth(
  user: { last_sign_in_at?: string } | null,
  intent: UnlockIntent | null,
): boolean {
  if (!user || !intent) return false;
  const signedInAt = user.last_sign_in_at ? Date.parse(user.last_sign_in_at) : NaN;
  if (!Number.isFinite(signedInAt)) return false;
  return signedInAt >= intent.at - REAUTH_SKEW_MS;
}

const LockContext = createContext<LockContextType | null>(null);

export function LockProvider({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  // Cold mount with the account already known — the only way the
  // shell mounts this provider (the guard renders nothing until the
  // session and profile resolve): the persisted lock is decided in
  // the FIRST render, so neither the unlocked shell nor a lock that
  // isn't this account's ever flashes. A record owned by the current
  // account locks; a record owned by anyone else (or by no provable
  // owner) is dropped on sight and the mount starts open.
  const [locked, setLocked] = useState<boolean>(() => {
    if (loading || !user) return false;
    const persisted = readPersistedScreenLock();
    if (!persisted) return false;
    if (persisted.userId === user.id) return true;
    clearPersistedScreenLock();
    return false;
  });
  // The Google-proof decision for a cold mount with the account
  // already known, made in the FIRST render alongside the lock
  // restore above: the intent is consumed (and so discarded whatever
  // the outcome) and counts as proof only when the lock being
  // restored is this account's AND the session was signed in after
  // the intent was planted. When the account is not yet known, the
  // reconcile effect below makes the same decision instead.
  const [googleProof, setGoogleProof] = useState<boolean>(() => {
    if (loading || !user) return false;
    const persisted = readPersistedScreenLock();
    const honoured = !!persisted && persisted.userId === user.id;
    const intent = consumeUnlockIntent(user.id);
    return honoured && intentProvesReauth(user, intent);
  });
  const timer = useRef<number | null>(null);
  // The account the restore/account-change check last ran for. When
  // the initialiser above already decided the cold mount (account
  // known at first render), it starts at that account; otherwise
  // `undefined` until the reconcile effect runs once.
  const reconciledFor = useRef<string | null | undefined>(
    !loading && user ? user.id : undefined,
  );
  const currentUserId = user?.id ?? null;

  const lock = useCallback(() => {
    setLocked(true);
    // A proof belongs to the landing that earned it; engaging the
    // lock again (idle or manual) always starts the step-up fresh.
    setGoogleProof(false);
    // The lock is recorded against the account that set it; with no
    // account there is nothing truthful to record, and the in-memory
    // lock alone holds for this mount.
    if (currentUserId) persistScreenLock(currentUserId);
  }, [currentUserId]);

  const unlock = useCallback(() => {
    setLocked(false);
    setGoogleProof(false);
    clearPersistedScreenLock();
  }, []);

  // Restore + account-change guard. Runs once the auth state has
  // resolved: while it is still loading, the persisted record is
  // left exactly as it is — neither applied (it may belong to a
  // different account) nor discarded (it may be this one's).
  useEffect(() => {
    if (loading) return;
    const id = user?.id ?? null;
    if (reconciledFor.current === id) return;
    const coldMount = reconciledFor.current === undefined;
    reconciledFor.current = id;
    if (!id) {
      // Signed out: the central sign-out already cleared the
      // persisted record; the shell unmounts with it. A planted
      // unlock intent is discarded too — with no session it can
      // prove nothing, and it must not linger for a later sign-in.
      clearUnlockIntent();
      return;
    }
    if (coldMount) {
      const persisted = readPersistedScreenLock();
      const honoured = !!persisted && persisted.userId === id;
      if (honoured) {
        setLocked(true);
      } else if (persisted) {
        // A lock persisted by a different account (or an older,
        // ownerless record): not this account's lock — drop it and
        // start open.
        clearPersistedScreenLock();
      }
      // The Google-proof decision, mirroring the cold-mount
      // initialiser: consume the intent either way (discarded on
      // every outcome), and count it only behind an honoured lock
      // and a sign-in that postdates it.
      const intent = consumeUnlockIntent(id);
      if (honoured && intentProvesReauth(user, intent)) {
        setGoogleProof(true);
      }
    } else {
      // A DIFFERENT account signing in on this tab never inherits
      // the previous account's lock (the sign-out handlers clear the
      // record too; this is the belt-and-braces path for a session
      // that was replaced without going through them).
      setLocked(false);
      clearPersistedScreenLock();
      clearUnlockIntent();
    }
  }, [user, loading]);

  // Idle timer. While unlocked, pointer / keyboard / touch activity
  // — and in-app navigation (the pathname dep re-arms the effect) —
  // push the deadline out. While locked there is no timer and no
  // listener at all: activity on a locked screen changes nothing.
  useEffect(() => {
    if (locked) return;
    const arm = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(lock, IDLE_LIMIT_MS);
    };
    arm();
    window.addEventListener('pointerdown', arm, { passive: true });
    window.addEventListener('keydown', arm);
    window.addEventListener('touchstart', arm, { passive: true });
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
      window.removeEventListener('touchstart', arm);
    };
  }, [locked, lock, location.pathname]);

  return <LockContext.Provider value={{ locked, lock, unlock, googleProof }}>{children}</LockContext.Provider>;
}

export function useLock(): LockContextType {
  const ctx = useContext(LockContext);
  if (!ctx) throw new Error('useLock must be used inside LockProvider');
  return ctx;
}
