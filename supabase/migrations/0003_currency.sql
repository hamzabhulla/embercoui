-- Ember & Co. — multi-currency support
-- Adds a currency to the restaurant settings (the currency the restaurant
-- currently trades in) and snapshots that currency onto every order, so
-- historical orders always keep the currency they were placed in even after
-- the restaurant switches. Codes are ISO 4217 alphabetic, stored uppercase.

alter table public.restaurant_settings
  add column if not exists currency text not null default 'USD'
  check (currency ~ '^[A-Z]{3}$');

alter table public.orders
  add column if not exists currency text not null default 'USD'
  check (currency ~ '^[A-Z]{3}$');
