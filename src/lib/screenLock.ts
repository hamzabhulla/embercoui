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
 * The module also owns the Google unlock intent (below): the
 * short-lived record the unlock panel plants before starting an
 * OAuth round-trip, so the return landing can tell a completed
 * re-authentication from a visit that merely happens to be locked.
 * The intent also carries the admin path the panel was on: the
 * OAuth return landing cannot be trusted to be that path (the
 * provider's redirect lands wherever its own configuration says,
 * in practice the site root), and sessionStorage — scoped to the
 * origin, not the path — is the one channel that survives the
 * round-trip regardless of where the browser comes down.
 *
 * This module is deliberately dependency-free: the auth service
 * clears the records on every sign-out, and it must be able to do so
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

/* ------------------------------------------------------------------ */
/* The Google unlock intent.                                           */
/*                                                                     */
/* A Google-based account has no password, so the unlock panel's       */
/* step-up for it is a full OAuth round-trip: the panel plants this    */
/* intent, starts the same Google sign-in the login pages use, and     */
/* the browser leaves. On the return landing, LockProvider consumes    */
/* the intent and — only when it names the signed-in account, is       */
/* fresh, and the session in hand was actually signed in after the     */
/* intent was planted (see LockContext) — treats the round-trip as    */
/* the identity proof and hands the panel its usual post-proof         */
/* pipeline (TOTP step when a verified factor exists, else unlock).    */
/*                                                                     */
/* The intent is single-use and short-lived (5 minutes): consuming     */
/* it removes it in EVERY case — fresh, stale, malformed or another    */
/* account's — so a leftover intent can never be replayed against a     */
/* later lock, and a cancelled round-trip (no new sign-in behind it)   */
/* proves nothing.                                                     */
/* ------------------------------------------------------------------ */

export const UNLOCK_INTENT_KEY = 'ember-admin-unlock-intent';

/** How long a planted intent stays usable, in milliseconds. */
export const UNLOCK_INTENT_TTL_MS = 5 * 60 * 1000;

export interface UnlockIntent {
  /** The account that started the OAuth round-trip. */
  userId: string;
  /** When the intent was planted (epoch milliseconds, client clock). */
  at: number;
  /** The admin path the panel was on when the round-trip started —
   *  where the return landing must bring the admin back to. Always
   *  a validated admin path (see sanitizeUnlockReturnPath); a
   *  record carrying anything else — or, from before this field
   *  existed, nothing — resolves to the console root. */
  returnPath: string;
}

/**
 * Validate an unlock return target. The intent lives in
 * sessionStorage, which anything running on the origin can write,
 * so the stored path is never trusted as read: only a plain
 * same-origin path under the admin console is honoured — it must
 * be exactly '/admin' or start with '/admin/', contain no backslash
 * (some URL parsers read '/\evil' as a host) and not be the admin
 * sign-in page itself (the lock never lives there; bouncing a
 * freshly proven admin back to a sign-in form would be a dead end).
 * Everything else — absolute URLs, protocol-relative URLs, customer
 * paths, junk — falls back to '/admin'.
 */
export function sanitizeUnlockReturnPath(path: unknown): string {
  if (typeof path !== 'string') return '/admin';
  if (path !== '/admin' && !path.startsWith('/admin/')) return '/admin';
  if (path.includes('\\')) return '/admin';
  if (path === '/admin/login' || path.startsWith('/admin/login/')) return '/admin';
  return path;
}

/** Plant the intent for `userId` just before the OAuth redirect. */
export function persistUnlockIntent(userId: string, now: number = Date.now(), returnPath?: string): void {
  try {
    sessionStorage.setItem(
      UNLOCK_INTENT_KEY,
      JSON.stringify({ userId, at: now, returnPath: sanitizeUnlockReturnPath(returnPath) }),
    );
  } catch {
    // Storage unavailable — the return landing then finds no intent
    // and the lock simply stays up; the panel remains fully usable.
  }
}

/**
 * Read the planted intent, or null when there is none (or the stored
 * value is malformed — a malformed record proves nothing). The
 * return path is validated on the way out, never trusted as stored.
 */
export function readUnlockIntent(): UnlockIntent | null {
  try {
    const raw = sessionStorage.getItem(UNLOCK_INTENT_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object') {
      const { userId, at, returnPath } = parsed as { userId?: unknown; at?: unknown; returnPath?: unknown };
      if (typeof userId === 'string' && userId !== '' && typeof at === 'number' && Number.isFinite(at)) {
        return { userId, at, returnPath: sanitizeUnlockReturnPath(returnPath) };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Drop the planted intent, if any. */
export function clearUnlockIntent(): void {
  try {
    sessionStorage.removeItem(UNLOCK_INTENT_KEY);
  } catch {
    // Storage unavailable — nothing was planted in the first place.
  }
}

/**
 * Consume the planted intent for `userId`: the record is removed in
 * every case, and the intent itself is returned ONLY when it names
 * this account and was planted within the TTL (an age of exactly the
 * TTL still counts; a timestamp in the future does not). Any other
 * outcome — no intent, another account's, stale, malformed — returns
 * null and leaves nothing behind.
 */
export function consumeUnlockIntent(userId: string, now: number = Date.now()): UnlockIntent | null {
  const intent = readUnlockIntent();
  clearUnlockIntent();
  if (!intent) return null;
  if (intent.userId !== userId) return null;
  const age = now - intent.at;
  if (age < 0 || age > UNLOCK_INTENT_TTL_MS) return null;
  return intent;
}

/**
 * Peek at the planted intent for `userId` WITHOUT consuming it as
 * proof: a fresh intent that names this account is returned with the
 * record LEFT IN PLACE — LockProvider's consumption is the proof,
 * and destroying the record here would destroy the proof before the
 * lock screen ever sees it. Anything that could never count as
 * proof — a malformed record, another account's intent, a stale or
 * future timestamp — is discarded on sight (the same hygiene
 * consumeUnlockIntent applies), so junk never lingers for a later
 * lock. Used by the return courier (UnlockReturnCourier), which
 * needs the intent's return path on landings where the lock
 * provider is not even mounted (the site root, above all).
 */
export function peekUnlockIntent(userId: string, now: number = Date.now()): UnlockIntent | null {
  const intent = readUnlockIntent();
  if (!intent) {
    // A stored value that did not parse as an intent is junk by the
    // read rules; if one is physically present, drop it.
    try {
      if (sessionStorage.getItem(UNLOCK_INTENT_KEY) !== null) clearUnlockIntent();
    } catch {
      // Storage unavailable — nothing was planted in the first place.
    }
    return null;
  }
  if (intent.userId !== userId) {
    clearUnlockIntent();
    return null;
  }
  const age = now - intent.at;
  if (age < 0 || age > UNLOCK_INTENT_TTL_MS) {
    clearUnlockIntent();
    return null;
  }
  return intent;
}
