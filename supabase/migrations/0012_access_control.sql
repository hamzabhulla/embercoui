-- Ember & Co. — migration 0012: access control foundation (Phase A).
--
-- Three roles for the admin panel: Owner (profiles.role = 'admin', the
-- original super admin), the NEW 'manager' role, and 'staff'. On top of
-- the roles sits an owner-controlled permission system: twelve admin
-- sections, three levels each ('none' | 'view' | 'manage'), resolved per
-- request on the backend as:
--   per-person override (profiles.permissions)
--     ?? role default (role_permissions row)
--     ?? built-in default (backend/src/lib/permissions.ts)
--     ?? 'none'
-- The Owner is hard-coded to 'manage' on every section in code — nothing
-- stored in the database can ever reduce the owner.
--
--   - profiles.role check widened to include 'manager'.
--   - role_permissions: one row per assignable role holding the owner's
--     edited defaults (seeded here with the built-in defaults).
--   - profiles.permissions: per-person overrides (jsonb, nullable).
--   - audit_events: the append-only activity log foundation (Phase C
--     builds the Security & Activity UI on it). Rows are written ONLY by
--     the backend service role; RLS is enabled with NO client policies,
--     so anon/authenticated clients can neither read nor write it.
--
-- Like 0010/0011 this is a pure widening: every statement is guarded so
-- re-running it (or running it after a partial application) is safe,
-- and the backend is written to behave EXACTLY as before until this
-- migration runs (missing table/column errors degrade to the built-in
-- defaults in code).

-- ---------------------------------------------------------------------------
-- 1. Widen the profiles.role check constraint to include 'manager'.
--    The constraint is inline in 0001 (unnamed — Postgres generated its
--    name), so find it by its definition rather than guessing a name.
-- ---------------------------------------------------------------------------
do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'profiles'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%''customer''%'
    and pg_get_constraintdef(con.oid) like '%''admin''%'
    and pg_get_constraintdef(con.oid) like '%''staff''%'
    and pg_get_constraintdef(con.oid) not like '%''manager''%'
  limit 1;
  if cname is not null then
    execute format('alter table public.profiles drop constraint %I', cname);
  end if;
  if not exists (
    select 1
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'profiles'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) like '%''manager''%'
  ) then
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('customer', 'admin', 'staff', 'manager'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. role_permissions — owner-editable defaults per role.
-- ---------------------------------------------------------------------------
create table if not exists public.role_permissions (
  role text primary key check (role in ('manager', 'staff')),
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists role_permissions_updated_at on public.role_permissions;
create trigger role_permissions_updated_at before update on public.role_permissions
  for each row execute function public.set_updated_at();

-- Backend service-role access only: RLS on, no policies for
-- anon/authenticated (same posture as the other locked-down tables).
alter table public.role_permissions enable row level security;

-- ---------------------------------------------------------------------------
-- 3. profiles.permissions — per-person overrides (nullable: NULL means
--    "no overrides; follow the role default").
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists permissions jsonb;

-- ---------------------------------------------------------------------------
-- 4. audit_events — append-only activity log (foundation; Phase C adds
--    the hooks on every mutation and the admin UI).
-- ---------------------------------------------------------------------------
create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  actor_label text,
  actor_role text,
  action text not null,
  entity text,
  entity_id text,
  summary text,
  changes jsonb,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists audit_events_created_at_idx on public.audit_events (created_at desc);
create index if not exists audit_events_actor_id_idx on public.audit_events (actor_id);
create index if not exists audit_events_entity_idx on public.audit_events (entity, entity_id);

alter table public.audit_events enable row level security;

-- ---------------------------------------------------------------------------
-- 5. Seed the role defaults with the built-in defaults from
--    backend/src/lib/permissions.ts (on conflict do nothing: an owner
--    who already edited the defaults keeps their values on a re-run).
-- ---------------------------------------------------------------------------
insert into public.role_permissions (role, permissions) values
  ('manager', '{"dashboard":"view","orders":"manage","reservations":"manage","menu":"manage","customers":"view","reviews":"manage","newsletter":"view","coupons":"view","finance":"none","staff":"none","settings":"none","security":"none"}'::jsonb),
  ('staff', '{"dashboard":"view","orders":"manage","reservations":"manage","menu":"manage","customers":"none","reviews":"manage","newsletter":"none","coupons":"view","finance":"none","staff":"none","settings":"none","security":"none"}'::jsonb)
on conflict (role) do nothing;

-- Make PostgREST pick the new table/column up immediately.
notify pgrst, 'reload schema';
