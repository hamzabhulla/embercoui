-- Ember & Co. — migration 0006: idempotent order creation.
-- Checkout sends one idempotency key per attempt (generated when the
-- checkout page loads). A retried or double-submitted POST /orders with
-- the same key returns the ORIGINAL order instead of creating a duplicate.
-- The key stays internal to the backend — it is never exposed in order
-- DTOs. Idempotent migration — safe to run more than once.

alter table public.orders
  add column if not exists idempotency_key text;

-- Partial unique index: any number of key-less orders (every client that
-- does not send a key, and every pre-0006 row) coexist freely; a given key
-- may appear at most once. This is the database backstop behind the
-- repository's check-then-insert — under a concurrent double submit, the
-- loser gets a unique violation and returns the winner's order.
create unique index if not exists orders_idempotency_key_uidx
  on public.orders (idempotency_key)
  where idempotency_key is not null;

-- Make PostgREST pick the new column up immediately (the backend degrades
-- gracefully until it does: a missing column simply disables dedupe).
notify pgrst, 'reload schema';
