import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { MemoryStore, type ClientRateLimitInfo, type Options, type Store } from 'express-rate-limit';

/**
 * Shared rate-limit store (Mega Audit #2, Medium OPS-M1).
 *
 * Every limiter used to run on express-rate-limit's default in-memory
 * store. On Vercel each function instance keeps its OWN counters and
 * they vanish on cold start, so the effective per-IP budget was
 * limit × live instances and enforcement evaporated on recycle.
 * This store backs every limiter with ONE shared counter table in
 * Supabase (migration 0018, `rate_limit_counters` + the atomic
 * `rate_limit_hit` RPC), reached through the backend's service-role
 * client. One store instance per limiter, each with a distinct key
 * prefix (global / orders / coupon / forms / chat / failed-login),
 * so the budgets stay isolated exactly as the separate in-memory
 * stores kept them. Keys themselves are unchanged — the library's
 * default IP key generator still derives them from req.ip (which
 * TRUST_PROXY feeds, see app.ts), this store only namespaces them.
 *
 * ── DEGRADATION CONTRACT (the reason this file is shaped this way) ──
 * The code is live-safe BEFORE the owner runs migration 0018, and
 * during any later store outage:
 *   • Primary decision: the shared store (one atomic RPC per hit).
 *   • On ANY shared-store error — table/function missing (0018 not
 *     run yet), PostgREST error, malformed reply, or the RPC not
 *     answering within the timeout below — THAT request is decided
 *     by a per-instance in-memory counter (a private MemoryStore:
 *     exactly today's pre-0018 behaviour).
 *   • The limiter therefore never fails closed, never 500s, and can
 *     never lock anyone out beyond today's per-instance limits;
 *     shared enforcement switches on by itself the moment 0018 is
 *     live, and resumes by itself when an outage clears.
 * A pure allow-on-error design was considered and rejected: it would
 * silently switch limiting OFF in production until 0018 runs.
 * Honest limit: the two counters are not merged — a hit counted by
 * the fallback during an outage is invisible to the shared store
 * (and vice versa), so during an outage the per-instance fallback
 * budget applies, exactly as it did before this store existed.
 * Degradation is logged, throttled (first failure, then at most one
 * line a minute, plus one line on recovery) — never per request.
 *
 * ── FAILURE COOLDOWN (audit correction) ──
 * Without a circuit breaker, a SLOW (not dead) backend taxed every
 * request with the full RPC race timeout, forever, for the whole
 * slowdown (+2 s on global-only routes, +4 s on stacked ones). So
 * after ANY backend failure a store instance stops attempting the
 * backend for a cooldown window (default 30 s) and serves straight
 * from the fallback — no RPC attempt, no timeout tax. When the
 * window expires, exactly ONE request probes the backend (concurrent
 * requests keep using the fallback while the probe is in flight —
 * no thundering herd of stalls): probe success → shared mode resumes
 * (recovery log line as before); probe failure → a fresh cooldown
 * begins. State is per store instance, like the log throttle below.
 */

/** How long a hit waits on the shared store before falling back. */
export const RATE_LIMIT_RPC_TIMEOUT_MS = 2000;
/** How long backend attempts pause after a failure (see header). */
export const RATE_LIMIT_FAILURE_COOLDOWN_MS = 30 * 1000;
/** Minimum gap between repeated degradation log lines. */
const DEGRADE_LOG_INTERVAL_MS = 60 * 1000;

/**
 * The shared backend the store talks to. `hit` MUST be atomic (one
 * round trip that creates / rolls / increments the window) — that
 * atomicity is what makes counters shared across instances correct
 * under concurrency, and it lives in the 0018 RPC, not here.
 */
export interface RateLimitBackend {
  hit(key: string, windowMs: number): Promise<ClientRateLimitInfo>;
  get(key: string): Promise<ClientRateLimitInfo | undefined>;
  reset(key: string): Promise<void>;
  decrement(key: string): Promise<void>;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`rate-limit store did not answer within ${ms} ms`));
    }, ms);
    timer.unref?.();
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err: unknown) => { clearTimeout(timer); reject(err instanceof Error ? err : new Error(String(err))); },
    );
  });
}

export interface SupabaseRateLimitStoreOptions {
  /** Key namespace for this limiter ('global:', 'chat:', …). */
  prefix: string;
  /** null = no shared backend configured → pure in-memory (today). */
  backend: RateLimitBackend | null;
  /** Test-only override for the RPC wait bound. */
  timeoutMs?: number;
  /** Test-only override for the post-failure cooldown window. */
  failureCooldownMs?: number;
}

export class SupabaseRateLimitStore implements Store {
  /** Shared across instances (the whole point) — NOT local keys. */
  localKeys = false;
  readonly prefix: string;
  private readonly backend: RateLimitBackend | null;
  private readonly timeoutMs: number;
  private readonly failureCooldownMs: number;
  private readonly fallback = new MemoryStore();
  private windowMs = 60 * 1000;
  private degraded = false;
  private lastDegradeLogAt = 0;
  /** Cooldown state (see header): while `inCooldown`, no backend
   *  attempt is made until `cooldownUntil`; the first attempt after
   *  that is the single probe (`probeInFlight` gates the rest). */
  private inCooldown = false;
  private cooldownUntil = 0;
  private probeInFlight = false;

  constructor(options: SupabaseRateLimitStoreOptions) {
    this.prefix = options.prefix;
    this.backend = options.backend;
    this.timeoutMs = options.timeoutMs ?? RATE_LIMIT_RPC_TIMEOUT_MS;
    this.failureCooldownMs = options.failureCooldownMs ?? RATE_LIMIT_FAILURE_COOLDOWN_MS;
  }

  /**
   * Gate for every backend attempt. Returns 'normal' when shared
   * mode is live, 'probe' when this caller is the single post-
   * cooldown probe, or null when the request must go straight to
   * the fallback (cooldown running, or a probe already in flight).
   */
  private beginBackendAttempt(): 'normal' | 'probe' | null {
    if (!this.backend) return null;
    if (this.probeInFlight) return null;
    if (this.inCooldown) {
      if (Date.now() < this.cooldownUntil) return null;
      this.probeInFlight = true;
      return 'probe';
    }
    return 'normal';
  }

  private settleBackendSuccess(attempt: 'normal' | 'probe'): void {
    if (attempt === 'probe') {
      this.probeInFlight = false;
      this.inCooldown = false;
      this.cooldownUntil = 0;
    }
    this.noteRecovered();
  }

  private settleBackendFailure(attempt: 'normal' | 'probe', err: unknown): void {
    if (attempt === 'probe') this.probeInFlight = false;
    this.inCooldown = true;
    this.cooldownUntil = Date.now() + this.failureCooldownMs;
    this.noteDegraded(err);
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.fallback.init(options);
  }

  private noteDegraded(err: unknown): void {
    const now = Date.now();
    if (!this.degraded || now - this.lastDegradeLogAt >= DEGRADE_LOG_INTERVAL_MS) {
      console.error(
        `[ember] rate-limit store (${this.prefix}) unavailable — falling back to per-instance in-memory counters:`,
        err instanceof Error ? err.message : err,
      );
      this.lastDegradeLogAt = now;
    }
    this.degraded = true;
  }

  private noteRecovered(): void {
    if (this.degraded) {
      console.error(`[ember] rate-limit store (${this.prefix}) recovered — shared counters in use again.`);
      this.degraded = false;
    }
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const attempt = this.beginBackendAttempt();
    if (attempt && this.backend) {
      try {
        const info = await withTimeout(this.backend.hit(`${this.prefix}${key}`, this.windowMs), this.timeoutMs);
        // The library validates totalHits itself, but a malformed
        // shared reply must degrade, not crash the request path.
        if (!Number.isInteger(info.totalHits) || info.totalHits < 1 || !(info.resetTime instanceof Date) || Number.isNaN(info.resetTime.getTime())) {
          throw new Error('rate-limit store returned a malformed hit result');
        }
        this.settleBackendSuccess(attempt);
        return info;
      } catch (err) {
        this.settleBackendFailure(attempt, err);
      }
    }
    return this.fallback.increment(key);
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const attempt = this.beginBackendAttempt();
    if (attempt && this.backend) {
      try {
        const info = await withTimeout(this.backend.get(`${this.prefix}${key}`), this.timeoutMs);
        this.settleBackendSuccess(attempt);
        return info;
      } catch (err) {
        this.settleBackendFailure(attempt, err);
      }
    }
    return this.fallback.get(key);
  }

  async decrement(key: string): Promise<void> {
    // The app never enables skipFailedRequests/skipSuccessfulRequests,
    // so the library never calls this in production; it exists for
    // interface completeness. A shared decrement goes through the
    // backend (best effort — a failed one degrades like any other
    // store error); the fallback counter is always decremented too,
    // which is a no-op when the hit never landed there.
    const attempt = this.beginBackendAttempt();
    if (attempt && this.backend) {
      try {
        await withTimeout(this.backend.decrement(`${this.prefix}${key}`), this.timeoutMs);
        this.settleBackendSuccess(attempt);
      } catch (err) {
        this.settleBackendFailure(attempt, err);
      }
    }
    await this.fallback.decrement(key);
  }

  async resetKey(key: string): Promise<void> {
    const attempt = this.beginBackendAttempt();
    if (attempt && this.backend) {
      try {
        await withTimeout(this.backend.reset(`${this.prefix}${key}`), this.timeoutMs);
        this.settleBackendSuccess(attempt);
      } catch (err) {
        this.settleBackendFailure(attempt, err);
      }
    }
    await this.fallback.resetKey(key);
  }

  async shutdown(): Promise<void> {
    await this.fallback.shutdown?.();
  }
}

/** One store per limiter — express-rate-limit forbids sharing one. */
export function createRateLimitStore(prefix: string, backend: RateLimitBackend | null): SupabaseRateLimitStore {
  return new SupabaseRateLimitStore({ prefix, backend });
}

/**
 * The production backend: the shared counter table via the
 * service-role Supabase client. `hit` is the 0018 RPC (atomic);
 * `get`/`reset`/`decrement` are plain table operations on the same
 * client — they are administrative paths the limiter does not use
 * per request, so they do not need the RPC's atomicity (decrement,
 * the one mutation among them, is never called by this app's
 * limiter configuration; a lost decrement race would only ever
 * under-count by one).
 */
export function createSupabaseRateLimitBackend(url: string, serviceRoleKey: string): RateLimitBackend {
  // One lazily-built client per backend, like the token verifier /
  // auth-admin services. Typed as the bare SupabaseClient (the
  // repository's pattern): without generated schema types, the
  // generic createClient typing rejects rpc/table arguments.
  let client: SupabaseClient | null = null;
  const db = () => {
    client ??= createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    return client;
  };

  return {
    async hit(key, windowMs) {
      const { data, error } = await db().rpc('rate_limit_hit', { p_key: key, p_window_ms: windowMs });
      if (error) throw new Error(`rate_limit_hit failed: ${error.message}`);
      const row = (Array.isArray(data) ? data[0] : data) as { total_hits?: unknown; reset_at?: unknown } | null;
      const totalHits = typeof row?.total_hits === 'number' ? row.total_hits : NaN;
      const resetTime = typeof row?.reset_at === 'string' ? new Date(row.reset_at) : new Date(NaN);
      if (!Number.isInteger(totalHits) || Number.isNaN(resetTime.getTime())) {
        throw new Error('rate_limit_hit returned a malformed row');
      }
      return { totalHits, resetTime };
    },

    async get(key) {
      const { data, error } = await db()
        .from('rate_limit_counters')
        .select('count, expires_at')
        .eq('key', key)
        .maybeSingle();
      if (error) throw new Error(`rate_limit_counters read failed: ${error.message}`);
      if (!data) return undefined;
      const row = data as { count?: unknown; expires_at?: unknown };
      const resetTime = typeof row.expires_at === 'string' ? new Date(row.expires_at) : new Date(NaN);
      if (typeof row.count !== 'number' || Number.isNaN(resetTime.getTime()) || resetTime.getTime() <= Date.now()) {
        return undefined;
      }
      return { totalHits: row.count, resetTime };
    },

    async reset(key) {
      const { error } = await db().from('rate_limit_counters').delete().eq('key', key);
      if (error) throw new Error(`rate_limit_counters delete failed: ${error.message}`);
    },

    async decrement(key) {
      const current = await this.get(key);
      if (!current || current.totalHits <= 0) return;
      const { error } = await db()
        .from('rate_limit_counters')
        .update({ count: current.totalHits - 1 })
        .eq('key', key);
      if (error) throw new Error(`rate_limit_counters decrement failed: ${error.message}`);
    },
  };
}
