-- Ember & Co. — migration 0008: API-only writes (close the direct-PostgREST bypass).
-- Migration 0001 added permissive client INSERT policies so the browser
-- could write straight to PostgREST. The site never does that: every form
-- (reservation, newsletter, contact, review) submits to the backend API,
-- which validates input, enforces the reservation past-date/capacity
-- rules and the review verified-purchase name rule, and rate-limits.
-- Those INSERT policies therefore only serve direct callers holding the
-- public anon key, letting anyone insert fake bookings/subscribers/
-- messages or self-approved-looking reviews while skipping every API
-- guard. This migration drops the four client INSERT policies so writes
-- flow through the API only.
-- The backend uses the service-role key, which bypasses RLS entirely —
-- all website forms and admin flows keep working unchanged. SELECT
-- policies (public menu/settings/approved reviews, own-profile and
-- own-orders reads, staff reads) are NOT touched, and neither are the
-- profiles update policy or any update/delete policy.
-- Idempotent — safe to run more than once. Nothing changes until this
-- runs; after it runs, direct anon/authenticated INSERTs on these four
-- tables are denied while API writes continue as before.

drop policy if exists "guests and users can reserve" on public.reservations;
drop policy if exists "anyone can subscribe" on public.newsletter_subscribers;
drop policy if exists "anyone can send a message" on public.contact_messages;
drop policy if exists "users can post reviews" on public.reviews;
