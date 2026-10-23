/**
 * The persisted half of the admin screen lock (Phase D) — the small
 * sessionStorage record that gives the lock screen-lock semantics:
 * it survives a refresh of the tab, dies with the tab, and is gone
 * on sign-out and on unlock.
 *
 * The record names the account that set it (`{ userId }`). A lock is
 * only ever honoured for that account: a persisted flag found by a
 * DIFFERENT account — the morning colleague signing in on the tab
 * the night board was left locked on — is not their lock and is
 * discarded on sight (see LockProvider). Records written before the
 * owner was recorded (the bare '1' flag), or anything malformed,
 * carry no provable owner and are treated the same way: present,
 * but owned by no one, so honoured for no one.
 *
 * This module is deliberately dependency-free: the auth service
 * clears the record on every sign-out, and it must be able to do so
 * without importing the component tree.
 */

export const SCREEN_LOCK_KEY = 'ember-admin-screen-lock';

export interface PersistedScreenLock {
  /** The account that set the lock, or null when the record carries
   *  no provable owner (a legacy or malformed value). */
  userId: string | null;
}

/** Record the lock as belonging to `userId`. */
export function persistScreenLock(userId: string): void {
  try {
    sessionStorage.setItem(SCREEN_LOCK_KEY, JSON.stringify({ userId }));
  } catch {
    // Storage unavailable (private mode, disabled) — the lock then
    // lives only in the provider's memory for this mount.
  }
}

/**
 * Read the persisted lock record, or null when no lock is persisted.
 * A stored value that is not a `{ userId: string }` record still
 * counts as a persisted lock — one with no provable owner.
 */
export function readPersistedScreenLock(): PersistedScreenLock | null {
  try {
    const raw = sessionStorage.getItem(SCREEN_LOCK_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object') {
      const { userId } = parsed as { userId?: unknown };
      if (typeof userId === 'string' && userId !== '') return { userId };
    }
    return { userId: null };
  } catch {
    return null;
  }
}

/** Drop the persisted lock record, if any. */
export function clearPersistedScreenLock(): void {
  try {
    sessionStorage.removeItem(SCREEN_LOCK_KEY);
  } catch {
    // Storage unavailable — nothing was persisted in the first
    // place, so nothing to clear.
  }
}
