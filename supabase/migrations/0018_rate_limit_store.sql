-- Ember & Co. — migration 0018: shared rate-limit store
-- (Mega Audit #2, Medium OPS-M1).
--
-- Every rate limiter (express-rate-limit) used the library's default
-- in-memory store. The app runs as Vercel serverless functions, so
-- each live function instance kept its OWN counters and they
-- vanished on cold start: the effective per-IP budget was
-- limit × instances, and enforcement reset whenever an instance
-- recycled. This migration gives the limiters one shared home in
-- the database the deployment already has:
--
--   1. rate_limit_counters — one row per limiter key (the store
--      namespaces keys per limiter: 'global:<ip>', 'orders:<ip>',
--      'coupon:<ip>', 'forms:<ip>', 'chat:<ip>',
--      'failed-login:<ip>'; the IP part still comes from req.ip,
--      exactly as the in-memory keys did).
--   2. rate_limit_hit(p_key, p_window_ms) — the single atomic hit
--      the backend's store calls once per counted request.
--
-- RLS is enabled with NO policies — the same posture as audit_events
-- (0012): the table is reachable only by the service role (the
-- backend), which bypasses RLS; anon/authenticated callers get
-- nothing. The RPC is SECURITY DEFINER with a pinned search_path
-- (the trigger functions' established style) and EXECUTE is revoked
-- from public/anon/authenticated and granted to service_role only,
-- so the function is callable exactly by the backend and by the
-- SQL Editor / direct DB channel.
--
-- ATOMICITY of rate_limit_hit — one statement, one round trip:
-- the INSERT … ON CONFLICT DO UPDATE takes the row lock for the
-- key's row (or the speculative-insert lock for a fresh key) and
-- holds it to transaction end, so concurrent hits on the same key
-- serialise INSIDE Postgres: no two callers can read the same
-- pre-increment count, lose an increment, or double-roll a window.
-- The window logic is a conditional inside that same UPDATE:
--   - no row yet           → INSERT creates count 1, expiry
--                            now + window;
--   - row, window expired  → the CASEs roll it: count resets to 1
--                            and a fresh expiry is set (a fixed
--                            window, matching the in-memory store's
--                            semantics — hits do not slide it);
--   - row, window live     → count increments, expiry untouched.
-- The clock is read ONCE per call (clock_timestamp() captured into
-- v_now before the statement), so the expiry test and the new
-- expiry can never disagree about "now". RETURNING hands the
-- post-increment count and the window's reset time back in the
-- same round trip — the exact shape express-rate-limit's Store
-- contract asks increment() for.
--
-- Rows are never deleted by the hit path; an expired row is rolled
-- in place on its key's next hit. The table's size is bounded by
-- the number of distinct (limiter, IP) keys ever seen — the same
-- order of magnitude as the traffic itself, and each row is three
-- small columns. Pruning long-expired rows is a safe optional
-- housekeeping DELETE (expires_at < now()) the owner may run from
-- the SQL Editor at any time; nothing depends on it.
--
-- Idempotent and live-safe: the table is create-if-not-exists, the
-- function is create-or-replace, the revoke/grant pair is naturally
-- idempotent. App code is live-safe BEFORE this runs and needs no
-- deploy coordination: the backend store treats a missing table /
-- function (or any store error) as a signal to fall back, per
-- request, to the per-instance in-memory counter — today's exact
-- behaviour — and shared enforcement begins by itself with the
-- first successful RPC after this migration lands.

create table if not exists public.rate_limit_counters (
  key text primary key,
  count integer not null default 0,
  expires_at timestamptz not null
);

alter table public.rate_limit_counters enable row level security;
-- No policies on purpose: service-role (backend) access only, like
-- audit_events in 0012. Anon/authenticated callers can do nothing
-- with this table, including reading other visitors' counters.

create or replace function public.rate_limit_hit(p_key text, p_window_ms bigint)
returns table (total_hits integer, reset_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window interval := make_interval(secs => p_window_ms::double precision / 1000.0);
  v_count integer;
  v_reset timestamptz;
begin
  insert into public.rate_limit_counters (key, count, expires_at)
  values (p_key, 1, v_now + v_window)
  on conflict (key) do update set
    count = case
      when rate_limit_counters.expires_at <= v_now then 1
      else public.rate_limit_counters.count + 1
    end,
    expires_at = case
      when rate_limit_counters.expires_at <= v_now then v_now + v_window
      else rate_limit_counters.expires_at
    end
  returning count, expires_at into v_count, v_reset;
  total_hits := v_count;
  reset_at := v_reset;
  return next;
end $$;

-- Callable by the backend (service role) and the direct DB channel
-- only — never by anon/authenticated API callers, who could
-- otherwise inflate a victim IP's counters and rate-limit them off
-- the site, or probe the counters through the function.
revoke execute on function public.rate_limit_hit(text, bigint) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, bigint) to service_role;

-- Make PostgREST pick the new table + function up immediately.
notify pgrst, 'reload schema';
