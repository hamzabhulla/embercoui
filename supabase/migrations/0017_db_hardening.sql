-- Ember & Co. — migration 0017: database hardening (Mega Audit #2,
-- Mediums DB-M1 + DB-M2 + DB-M3).
--
-- Three independent hardenings, one file:
--
-- 1. DB-M1 — the profile authority guards (0001's guard_profile_role,
--    0016's guard_profile_authority) had an "admin branch": a caller
--    whose profile row said role='admin' could change ANY profile's
--    role / permissions / mfa_required directly through PostgREST.
--    That bypasses the backend, and therefore bypasses Change
--    History — breaking the guarantee that every authority change is
--    logged (the backend routes are the ones that write the audit
--    rows). It was also the ONLY barrier: the column-level REVOKEs
--    in 0001/0016 very likely never bound, because Postgres resolves
--    a caller's effective privilege by OR-ing table-level and
--    column-level grants, and the API roles hold table-level UPDATE
--    on profiles. This migration therefore does BOTH halves:
--      a. tightens both guard functions (create-or-replace) so an
--         'anon' / 'authenticated' caller can NEVER change an
--         authority column — the admin branch is gone, every such
--         attempt raises; and
--      b. adds a privilege layer that actually binds despite
--         privilege-OR: table-level UPDATE on profiles is revoked
--         from anon and authenticated, and UPDATE is granted back to
--         authenticated on ONLY the non-authority columns.
--    The other two caller branches are UNCHANGED in both guards:
--    no JWT at all (direct DB / SQL Editor — the owner's bootstrap
--    path for the first admin) and the service role (the backend)
--    stay allowed, because auth.role() is then neither 'anon' nor
--    'authenticated'. Every legitimate writer already goes through
--    the backend's service-role key — verified by grep over the
--    whole tree before this was written: the browser client performs
--    ZERO direct writes to profiles (it uses Supabase only for Auth
--    and Realtime; all data access goes through the Express API),
--    and the only profiles writers are the service-role repository
--    functions (upsertProfile, updateProfile, updateProfileRole,
--    setUserPermissions, setUserMfaRequired in
--    backend/src/repositories/supabaseRepository.ts), the signup
--    trigger's INSERT (handle_new_user, 0001 — inserts only, this
--    migration restricts UPDATE), and the SQL-Editor bootstrap.
--    The own-row RLS policy from 0001 is untouched: it still gates
--    WHICH rows an authenticated caller may update; the grants now
--    gate WHICH columns. The final profiles column set (0001 +
--    0012 + 0013) is: id, role, full_name, phone, addresses,
--    favorites, created_at, updated_at, permissions, mfa_required.
--    The grant-back enumerates exactly the non-authority columns —
--    full_name, phone, addresses, favorites, updated_at (updated_at
--    is trigger-managed by set_updated_at; including it keeps a
--    direct self-service update behaving exactly as before). SELECT
--    privileges are not touched, and the service role is not
--    revoked — backend reads/writes are unaffected.
--
-- 2. DB-M2 — audit_events was append-only by code discipline only:
--    the backend INSERTs and SELECTs it (grep-verified: the single
--    insert and the list query in supabaseRepository.ts; no UPDATE,
--    DELETE, upsert or truncate exists anywhere in backend,
--    frontend, scripts or other migrations), but nothing at the
--    database level stopped even the service role from rewriting
--    history. BEFORE UPDATE / BEFORE DELETE triggers now raise
--    unconditionally — triggers fire regardless of RLS bypass, so
--    this binds the service role too. Honest limit: TRUNCATE
--    bypasses row-level triggers entirely; it remains possible for
--    a table-owner-level principal (the SQL Editor / direct DB
--    channel, which is owner-grade by definition) and is the one
--    mutation channel this migration deliberately does not claim
--    to close. INSERTs are untouched — the log keeps working.
--
-- 3. DB-M3 — hot-path indexes the audit found missing. Inventory
--    first (0001 + 0007 + 0012 + 0014): reservations had only
--    (reservation_date, status) and (fee_payment_intent_id);
--    reviews and profiles had NO secondary indexes at all;
--    audit_events had (created_at desc), (actor_id) and
--    (entity, entity_id). None of the six below duplicates an
--    existing index — the single-column audit_events (actor_id)
--    index in particular is NOT equivalent to (actor_id,
--    created_at desc): it cannot serve the Security & Activity
--    list's actor-filtered, newest-first paging without a sort.
--    created_at direction follows the repository's actual ordering:
--    every affected list orders created_at DESC (reviews admin list
--    and public approved list, the customers list filtered by role,
--    the audit list), so the composites carry created_at desc. The
--    two reservations single-column indexes serve the account
--    page's "your reservations" lookups (by user_id, and by guest
--    email) in listReservationsForUser.
--
-- Pure restriction + additive indexes, no data movement: re-running
-- is safe (guard functions are create-or-replace, triggers are
-- dropped and recreated, revoke/grant are naturally idempotent,
-- indexes are IF NOT EXISTS), and app code is live-safe before this
-- runs — nothing in the backend or frontend depends on the admin
-- guard branch, on direct profiles writes, or on mutating
-- audit_events, so behaviour is identical until the migration lands
-- and unchanged (for legitimate flows) after it.

-- ---------------------------------------------------------------------------
-- 1a. DB-M1 — guard_profile_role (0001) without the admin branch.
--     An anon/authenticated caller can never change a role now; only
--     the no-JWT (SQL Editor / direct DB) and service-role channels
--     pass, exactly as the bootstrap and the backend require.
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role then
    -- No JWT at all (direct DB / SQL Editor) or the service role (backend):
    -- already fully privileged channels, and the SQL Editor path is how the
    -- owner creates the FIRST admin. API callers always carry a JWT role.
    if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
      return new;
    end if;
    raise exception 'Profile roles can only be changed through the backend or direct database access';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.guard_profile_role();

-- ---------------------------------------------------------------------------
-- 1b. DB-M1 — guard_profile_authority (0016) without the admin branch.
-- ---------------------------------------------------------------------------
create or replace function public.guard_profile_authority()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.permissions is distinct from old.permissions
     or new.mfa_required is distinct from old.mfa_required then
    -- No JWT at all (direct DB / SQL Editor) or the service role (backend):
    -- already fully privileged channels. API callers always carry a JWT role.
    if coalesce(auth.role(), '') not in ('anon', 'authenticated') then
      return new;
    end if;
    raise exception 'Profile permissions and the two-factor requirement can only be changed through the backend or direct database access';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_authority on public.profiles;
create trigger profiles_guard_authority before update on public.profiles
  for each row execute function public.guard_profile_authority();

-- ---------------------------------------------------------------------------
-- 1c. DB-M1 — the privilege layer that binds despite privilege-OR:
--     revoke table-level UPDATE from the API roles, re-assert the
--     authority-column revokes from 0001/0016, then grant UPDATE
--     back to authenticated on ONLY the non-authority columns
--     (the full set is: full_name, phone, addresses, favorites,
--     updated_at). anon gets nothing back — it has no own-row
--     UPDATE policy (0001) and no legitimate profile writes.
-- ---------------------------------------------------------------------------
revoke update on public.profiles from anon, authenticated;
revoke update (role, permissions, mfa_required) on public.profiles from anon, authenticated;
grant update (full_name, phone, addresses, favorites, updated_at) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 2. DB-M2 — audit_events is append-only at the database level.
--    One guard function, two triggers; both raise unconditionally.
-- ---------------------------------------------------------------------------
create or replace function public.guard_audit_events_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'audit_events is append-only: % operations are not permitted', tg_op;
end $$;
drop trigger if exists audit_events_no_update on public.audit_events;
create trigger audit_events_no_update before update on public.audit_events
  for each row execute function public.guard_audit_events_append_only();
drop trigger if exists audit_events_no_delete on public.audit_events;
create trigger audit_events_no_delete before delete on public.audit_events
  for each row execute function public.guard_audit_events_append_only();

-- ---------------------------------------------------------------------------
-- 3. DB-M3 — missing hot-path indexes (see the header inventory).
-- ---------------------------------------------------------------------------
create index if not exists reservations_user_id_idx
  on public.reservations (user_id);

create index if not exists reservations_email_idx
  on public.reservations (email);

create index if not exists reviews_approved_created_idx
  on public.reviews (is_approved, created_at desc);

create index if not exists profiles_role_created_idx
  on public.profiles (role, created_at desc);

create index if not exists audit_events_action_created_idx
  on public.audit_events (action, created_at desc);

create index if not exists audit_events_actor_created_idx
  on public.audit_events (actor_id, created_at desc);

-- Make PostgREST pick the tightened privileges up immediately.
notify pgrst, 'reload schema';
