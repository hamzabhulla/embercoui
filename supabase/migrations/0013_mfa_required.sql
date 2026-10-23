-- Ember & Co. — migration 0013: owner-controlled two-factor
-- requirement (Phase B of the access system).
--
-- profiles.mfa_required: boolean, NULLABLE by design. The column is a
-- tri-state (backend/src/lib/mfa.ts resolves it on every admin
-- request):
--   TRUE / FALSE — the owner's explicit per-person decision, made from
--                  Admin → Staff. It wins over the role default in
--                  both directions: staff can be made to require
--                  two-factor, and a manager — or the owner themselves
--                  — can be released from it.
--   NULL         — no per-person decision: the role default applies
--                  (Owner ON, Manager ON, Staff OFF).
--
-- Two-factor itself is Supabase Auth TOTP MFA (no custom system): the
-- admin sign-in enrolls/verifies factors through supabase-js auth.mfa,
-- and the backend merely checks the verified token's aal claim on
-- every admin request. The owner can also delete a locked-out
-- person's factors (Supabase Admin API) so they can enroll again.
--
-- Like 0012 this is a pure widening — one nullable column, no data
-- movement, guarded so re-running it is safe. The backend degrades
-- gracefully until this migration runs: profiles are read with
-- select('*'), so the column is simply ABSENT from the row, and that
-- absence means "the requirement system is not in force" — MFA
-- enforcement stays OFF entirely and the panel behaves exactly as
-- before. No state of this migration can lock anyone out.

alter table public.profiles add column if not exists mfa_required boolean;

-- Make PostgREST pick the new column up immediately.
notify pgrst, 'reload schema';
