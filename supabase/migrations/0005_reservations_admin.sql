-- Ember & Co. — migration 0005: admin reservation management.
-- Reservations gain a source ('website' = the public form, 'admin' = walk-in /
-- phone bookings created from the admin panel) and free-text notes, and the
-- email becomes optional (walk-ins do not always leave one). Restaurant
-- settings gain a per-time-slot guest capacity that drives the admin
-- Reservations day board. Idempotent — safe to run more than once.

alter table public.reservations
  add column if not exists source text not null default 'website';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'reservations_source_check'
  ) then
    alter table public.reservations
      add constraint reservations_source_check check (source in ('website', 'admin'));
  end if;
end $$;

alter table public.reservations
  add column if not exists notes text;

alter table public.reservations
  alter column email drop not null;

alter table public.restaurant_settings
  add column if not exists reservation_slot_capacity int not null default 40
  check (reservation_slot_capacity between 1 and 500);
