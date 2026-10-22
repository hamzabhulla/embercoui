-- Ember & Co. — migration 0010: per-location website contacts.
-- Until now the website had ONE global contact identity (the Restaurant
-- profile fields: phone / email / address) and the public pages ignored
-- even that, showing hardcoded template text instead. This migration
-- adds `site_locations`, a JSONB bag on the settings singleton holding
-- per-location overrides so each place on the website can show its own
-- contact details:
--   { footer:      { phone, email, address },
--     contact:     { phone, email, address, hours, mapLocation },
--     reservation: { phone, address, hours, locationLabel } }
-- Every value is a string or null; null (or a missing key) means "fall
-- back to the global Restaurant profile field", so an install that never
-- touches this feature behaves exactly as before. The backend validates
-- and sanitizes the shape on every read and write — the column itself
-- stays free-form JSON.
-- The backend degrades gracefully until this runs: settings saves retry
-- without the new column when PostgREST reports it missing (42703 /
-- PGRST204), so nothing breaks while the site waits on this migration;
-- the location fields simply start persisting once it has run.
-- Idempotent — safe to run more than once.

alter table public.restaurant_settings
  add column if not exists site_locations jsonb not null default '{}'::jsonb;
