-- Ember & Co. — migration 0015: customer reservation change requests
-- (Phase G of the access system).
--
-- A signed-in customer can ask for a change to one of THEIR
-- reservations (a different date, time or party size, and/or a short
-- note) from their Account page. The request lands in Admin →
-- Reservations as an inbox item; whoever holds the Reservations
-- section at 'manage' level applies it (the reservation edit carries
-- the request id and the save marks the request approved), declines
-- it with a reply, or marks it handled. The customer reads the
-- outcome — status + the admin's reply — back in their account.
--
--   reservation_requests
--     reservation_id    the booking the request refers to (FK,
--                       cascade: a deleted booking takes its requests
--                       with it — a request about nothing is nothing).
--     requester_user_id the account that sent it (profiles FK, set
--                       null if the account is deleted; the email
--                       snapshot below keeps the inbox readable).
--     requester_email   the account's email at send time.
--     proposed_date / proposed_time / proposed_guests
--                       ALL nullable — every part of the proposal is
--                       optional; a request may be a bare message.
--                       The guests CHECK mirrors the reservation
--                       form's own bounds (1–20).
--     message           the customer's note ('' when they only
--                       proposed new values).
--     status            pending | approved | declined | handled.
--     admin_reply       the team's answer, shown to the customer.
--     handled_by        the admin/staff profile that closed it.
--
-- At most ONE pending request per reservation: enforced here by a
-- partial unique index (the backend ALSO checks before inserting so
-- the customer gets a friendly 409, and translates a lost race on
-- this index — Postgres 23505 — into the same 409).
--
-- RLS is enabled with NO client policies, exactly like audit_events
-- (0012): the table is reachable only through the backend service
-- role, which enforces ownership (a customer only ever sees or
-- requests changes to their own bookings) and the Phase A capability
-- gates itself. Request rows carry a customer's free-text message —
-- there is no reason for any browser client to touch this table
-- directly.
--
-- Like 0012–0014 this is a pure addition — one new table, no data
-- movement, guarded so re-running it is safe. The backend degrades
-- gracefully until this migration runs: the Account reservations
-- list works exactly as without the feature (requests read as
-- unavailable, never faked), request creation answers an honest 503,
-- and the admin inbox reports itself degraded instead of erroring.

create table if not exists public.reservation_requests (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations (id) on delete cascade,
  requester_user_id uuid references public.profiles (id) on delete set null,
  requester_email text,
  proposed_date date,
  proposed_time time,
  proposed_guests int check (proposed_guests is null or (proposed_guests between 1 and 20)),
  message text not null default '',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'declined', 'handled')),
  admin_reply text,
  handled_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists reservation_requests_updated_at on public.reservation_requests;
create trigger reservation_requests_updated_at before update on public.reservation_requests
  for each row execute function public.set_updated_at();

-- The customer's list and the admin inbox both read by reservation.
create index if not exists reservation_requests_reservation_idx
  on public.reservation_requests (reservation_id);
-- The inbox pages one status newest-first.
create index if not exists reservation_requests_status_idx
  on public.reservation_requests (status, created_at desc);
-- The one-pending-per-reservation guard (see the header).
create unique index if not exists reservation_requests_one_pending_idx
  on public.reservation_requests (reservation_id)
  where status = 'pending';

-- Backend service role only — no anon/authenticated policies.
alter table public.reservation_requests enable row level security;

-- Make PostgREST pick the new table up immediately.
notify pgrst, 'reload schema';
