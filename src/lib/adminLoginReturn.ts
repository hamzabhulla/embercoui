/**
 * The admin sign-in return record — the small sessionStorage note
 * the /admin/login page plants before starting a Google sign-in, so
 * the return landing can be brought back to the admin sign-in page
 * (whose state machine then routes the fresh session onward: MFA
 * flow when due, the console when satisfied, the no-access state
 * for a non-admin account) no matter where the OAuth provider
 * actually lands the browser. The provider's redirect is only a
 * request — its configuration decides the real landing, in
 * practice often the site root — while sessionStorage is scoped to
 * the origin, not the path, and so survives the round-trip intact.
 *
 * This record is a NAVIGATION hint, never a proof: the session the
 * landing carries is the authentication, and every gate behind the
 * sign-in page (role, /me, MFA) applies to it exactly as it does to
 * a password sign-in. It is short-lived (5 minutes, the same window
 * the screen-lock unlock intent uses — see lib/screenLock) and
 * single-use: the sign-in page consumes it when it recognises the
 * returning session as the sign-in it started (which is also what
 * lets the page report that login), and the return courier drops
 * it when the session is already inside the console, where it has
 * nothing left to do.
 *
 * Deliberately separate from the screen-lock intent: that record is
 * an identity proof with an account binding and a sign-in freshness
 * binding; this one serves a different flow (a sign-in, not an
 * unlock) and is validated accordingly — an allow-list of exactly
 * the two sane destinations, never a general path.
 */

export const ADMIN_LOGIN_RETURN_KEY = 'ember-admin-login-return';

/** How long a planted return stays usable, in milliseconds. */
export const ADMIN_LOGIN_RETURN_TTL_MS = 5 * 60 * 1000;

export interface AdminLoginReturn {
  /** Where the return landing belongs: the admin sign-in page,
   *  whose state machine takes it from there. */
  returnPath: string;
  /** When the record was planted (epoch milliseconds, client clock). */
  at: number;
}

const ALLOWED_TARGETS = ['/admin/login', '/admin'];

/** Only the console root and the sign-in page itself are sane
 *  destinations for an admin sign-in return; anything else stored
 *  under this key resolves to the sign-in page. */
function sanitizeTarget(path: unknown): string {
  return typeof path === 'string' && ALLOWED_TARGETS.includes(path) ? path : '/admin/login';
}

/** Plant the return record just before the OAuth redirect. */
export function plantAdminLoginReturn(returnPath: string = '/admin/login', now: number = Date.now()): void {
  try {
    sessionStorage.setItem(
      ADMIN_LOGIN_RETURN_KEY,
      JSON.stringify({ returnPath: sanitizeTarget(returnPath), at: now }),
    );
  } catch {
    // Storage unavailable — the landing then relies on the OAuth
    // redirect alone, exactly as before this record existed.
  }
}

/**
 * Read the planted record, or null when there is none, it is
 * malformed, or it has outlived the window (an age of exactly the
 * TTL still counts; a timestamp in the future does not).
 */
export function readAdminLoginReturn(now: number = Date.now()): AdminLoginReturn | null {
  try {
    const raw = sessionStorage.getItem(ADMIN_LOGIN_RETURN_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed !== null && typeof parsed === 'object') {
      const { returnPath, at } = parsed as { returnPath?: unknown; at?: unknown };
      if (typeof at === 'number' && Number.isFinite(at)) {
        const age = now - at;
        if (age < 0 || age > ADMIN_LOGIN_RETURN_TTL_MS) return null;
        return { returnPath: sanitizeTarget(returnPath), at };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Drop the planted record, if any. */
export function clearAdminLoginReturn(): void {
  try {
    sessionStorage.removeItem(ADMIN_LOGIN_RETURN_KEY);
  } catch {
    // Storage unavailable — nothing was planted in the first place.
  }
}

/**
 * Consume the record: removed in every case, and returned only when
 * it was still usable. The sign-in page uses the returned `at` to
 * recognise the returning session as the sign-in it started (the
 * session's own sign-in stamp must postdate the plant — a stale
 * pre-existing session merely visiting the page is not a login).
 */
export function consumeAdminLoginReturn(now: number = Date.now()): AdminLoginReturn | null {
  const record = readAdminLoginReturn(now);
  clearAdminLoginReturn();
  return record;
}

/**
 * Peek at the record WITHOUT consuming it: a usable record is
 * returned with the record left in place for the sign-in page to
 * consume; a stale or malformed one is discarded on sight. Used by
 * the return courier, which needs the destination on landings
 * where the sign-in page is not mounted.
 */
export function peekAdminLoginReturn(now: number = Date.now()): AdminLoginReturn | null {
  const record = readAdminLoginReturn(now);
  if (!record) {
    try {
      if (sessionStorage.getItem(ADMIN_LOGIN_RETURN_KEY) !== null) clearAdminLoginReturn();
    } catch {
      // Storage unavailable — nothing was planted in the first place.
    }
    return null;
  }
  return record;
}
