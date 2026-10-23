-- Ember & Co. — migration 0016: profile authority-column guard
-- (final mega-audit blocker B1).
--
-- profiles.permissions (0012) and profiles.mfa_required (0013) are
-- AUTHORITY columns: the backend trusts them on every admin request
-- (resolvePermissions in backend/src/lib/permissions.ts and
-- effectiveMfaRequired in backend/src/lib/mfa.ts). But nothing ever
-- restricted WHO could write them. RLS restricts rows, not columns,
-- so the own-row UPDATE policy from 0001 ("users update own profile")
-- let ANY signed-in user PATCH their own profile through PostgREST
-- and set permissions to all-'manage' and mfa_required to false —
-- a silent self-grant of the whole admin panel with two-factor
-- switched off, invisible to Change History. Only `role` was ever
-- protected (0001's column revoke + guard_profile_role trigger);
-- 0012 and 0013 added these two columns with no equivalent guard.
--
-- This migration gives the two columns EXACTLY the treatment 0001
-- gave `role` — same mechanics, defense in depth:
--   1. a column-level privilege revoke, and
--   2. a BEFORE UPDATE guard trigger that raises when a caller who
--      is neither the service role / direct DB nor an admin profile
--      tries to change either column.
--
-- NOTE: the revoke applies to ALL authenticated users (admins
-- included), so permission and two-factor changes from the browser
-- are impossible by design — exactly as with `role`. Every legitimate
-- writer already goes through the backend's service-role key:
--   - PUT /admin/staff/:id/permissions  → setUserPermissions
--   - PUT /admin/staff/:id/mfa-required → setUserMfaRequired
-- (both in backend/src/repositories/supabaseRepository.ts, on the
-- service-role client). The service role is unaffected by the revoke,
-- and the trigger's privileged branches only ever fire for
-- service-role / direct-DB sessions. Nothing else in the codebase
-- writes these columns: the signup trigger (handle_new_user, 0001)
-- inserts id/full_name/phone only, leaving both columns NULL, and
-- profile self-service edits (full_name, phone, addresses,
-- favorites) write OTHER columns through the backend — this
-- migration restricts ONLY permissions and mfa_required, so those
-- flows are untouched.
--
-- Pure restriction, no data movement: re-running it is safe (the
-- revoke is naturally idempotent, the guard function is
-- create-or-replace, the trigger is dropped and recreated), and
-- until it runs the backend behaves exactly as before — this file
-- changes no application behaviour on its own.

-- ---------------------------------------------------------------------------
-- 1. Column-level revoke — mirrors 0001's `revoke update (role)`.
-- ---------------------------------------------------------------------------
revoke update (permissions, mfa_required) on public.profiles from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Guard trigger — a sibling of 0001's guard_profile_role, with the
--    same caller branches, watching the two authority columns.
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
    if exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin') then
      return new;
    end if;
    raise exception 'Only an admin can change profile permissions or the two-factor requirement';
  end if;
  return new;
end $$;
drop trigger if exists profiles_guard_authority on public.profiles;
create trigger profiles_guard_authority before update on public.profiles
  for each row execute function public.guard_profile_authority();

-- Make PostgREST pick the tightened privileges up immediately.
notify pgrst, 'reload schema';
