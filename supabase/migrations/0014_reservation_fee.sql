-- Ember & Co. — migration 0014: owner-set reservation fee, charged
-- online at booking (Phase F of the access system).
--
-- restaurant_settings gains the owner's controls:
--   reservation_fee_enabled boolean NOT NULL DEFAULT false
--   reservation_fee_amount  numeric(12,3) NOT NULL DEFAULT 0
--     — flat per reservation, in the restaurant's currency (the
--       settings currency at the moment of the booking).
--
-- reservations gains the per-booking fee record:
--   fee_amount            numeric(12,3) — NULL when the booking
--                         carries no fee; otherwise the amount the
--                         guest was charged, snapshotted at booking.
--   fee_currency          text — the settings currency at booking
--                         (a later currency switch never rewrites
--                         what a past guest was charged).
--   fee_payment_status    text NOT NULL DEFAULT 'none'
--                         ∈ none | pending | paid | failed:
--                           none    — no fee on this booking;
--                           pending — fee intent created, unpaid;
--                           paid    — the Stripe webhook settled it;
--                           failed  — payment failed (or setup did).
--                         Only a 'paid' fee booking holds seats:
--                         pending/failed rows consume NO slot
--                         capacity, exactly like a booking that was
--                         never made.
--   fee_payment_intent_id text — the Stripe PaymentIntent the
--                         webhook reconciles against.
--
-- THE FEE IS EFFECTIVE only when enabled AND amount > 0 AND a card
-- provider is configured — that rule lives in ONE place in the
-- backend (lib/reservationFee.ts) and every surface consumes it, so
-- with no provider connected the toggle alone can never make a
-- booking claim a charge that cannot happen: bookings stay free.
--
-- Like 0012/0013 this is a pure widening — new columns with safe
-- defaults, no data movement, guarded so re-running it is safe.
-- The backend degrades gracefully until this migration runs: the
-- settings sanitizer defaults the missing columns (fee OFF, bookings
-- behave exactly as before), reservation rows read their fee fields
-- as none/null, and settings writes retry without the new columns.

alter table public.restaurant_settings
  add column if not exists reservation_fee_enabled boolean not null default false;
alter table public.restaurant_settings
  add column if not exists reservation_fee_amount numeric(12, 3) not null default 0;

alter table public.reservations
  add column if not exists fee_amount numeric(12, 3);
alter table public.reservations
  add column if not exists fee_currency text;
alter table public.reservations
  add column if not exists fee_payment_status text not null default 'none';
alter table public.reservations
  add column if not exists fee_payment_intent_id text;

-- The status vocabulary is closed; enforce it at the database so a
-- hand-edited row can never invent a fifth state the code (and the
-- capacity math) does not understand. Guarded for re-runs.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reservations_fee_payment_status_check'
  ) then
    alter table public.reservations
      add constraint reservations_fee_payment_status_check
      check (fee_payment_status in ('none', 'pending', 'paid', 'failed'));
  end if;
end $$;

-- The webhook looks reservations up by intent id on every fee event.
create index if not exists reservations_fee_payment_intent_id_idx
  on public.reservations (fee_payment_intent_id)
  where fee_payment_intent_id is not null;

-- Make PostgREST pick the new columns up immediately.
notify pgrst, 'reload schema';
