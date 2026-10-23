/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  clearPersistedScreenLock,
  persistScreenLock,
  readPersistedScreenLock,
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
    // The lock is recorded against the account that set it; with no
    // account there is nothing truthful to record, and the in-memory
    // lock alone holds for this mount.
    if (currentUserId) persistScreenLock(currentUserId);
  }, [currentUserId]);

  const unlock = useCallback(() => {
    setLocked(false);
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
    if (!id) return; // Signed out: the central sign-out already
    // cleared the persisted record; the shell unmounts with it.
    if (coldMount) {
      const persisted = readPersistedScreenLock();
      if (persisted && persisted.userId === id) {
        setLocked(true);
      } else if (persisted) {
        // A lock persisted by a different account (or an older,
        // ownerless record): not this account's lock — drop it and
        // start open.
        clearPersistedScreenLock();
      }
    } else {
      // A DIFFERENT account signing in on this tab never inherits
      // the previous account's lock (the sign-out handlers clear the
      // record too; this is the belt-and-braces path for a session
      // that was replaced without going through them).
      setLocked(false);
      clearPersistedScreenLock();
    }
  }, [user?.id, loading]);

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

  return <LockContext.Provider value={{ locked, lock, unlock }}>{children}</LockContext.Provider>;
}

export function useLock(): LockContextType {
  const ctx = useContext(LockContext);
  if (!ctx) throw new Error('useLock must be used inside LockProvider');
  return ctx;
}
