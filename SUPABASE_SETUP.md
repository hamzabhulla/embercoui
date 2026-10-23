# SUPABASE SETUP — Ember & Co. (morning checklist)

Use YOUR OWN Supabase project: create one (or open your existing one) at
supabase.com and use **its** Project URL and keys throughout this checklist —
every Ember & Co. install gets its own project. (The current live demo runs
on the project with ref `mmkokxwgdxqbgxbftfsl`.)

The code is complete and verified live — the demo at embercoui.vercel.app runs
this exact stack. Going live is setup only, no code changes. Do these steps
in order:

## 1. Create the tables (2 minutes)
Supabase Dashboard → **SQL Editor** → paste and run, in this order:
1. `supabase/migrations/0001_init.sql` — core schema: tables, checks, RLS policies, realtime on `orders`
2. `supabase/migrations/0002_storage.sql` — `menu-images` storage bucket + policies (menu photos uploaded from the admin panel)
3. `supabase/migrations/0003_currency.sql` — multi-currency: `currency` on the restaurant settings + a per-order currency snapshot
4. `supabase/migrations/0004_whatsapp.sql` — nullable `whatsapp_number` setting (drives the floating WhatsApp button; empty = button hidden)
5. `supabase/migrations/0005_reservations_admin.sql` — admin reservation management: booking source + notes, optional email, per-slot guest capacity
6. `supabase/migrations/0006_order_idempotency.sql` — idempotent checkout: a per-attempt key on `orders` (+ unique index) so a retried or double-submitted checkout returns the original order instead of duplicating it
7. `supabase/migrations/0007_indexes.sql` — supporting indexes for the paged admin lists (reservations by date + status, menu by availability/category/sort order, orders by creation time)
8. `supabase/migrations/0008_api_only_writes.sql` — drops the permissive client INSERT policies from 0001 (reservations, newsletter, contact, reviews): all writes flow through the backend API, which validates and rate-limits; the service-role backend is unaffected
9. `supabase/migrations/0009_hero_bucket.sql` — creates the public `hero-portfolio-video` storage bucket + policies (same model as `menu-images` in 0002)
10. `supabase/migrations/0010_site_locations.sql` — per-location website contacts: a `site_locations` JSON on the settings (footer / contact page / reservation section overrides of the global profile fields); settings saves degrade gracefully until it runs
11. `supabase/migrations/0011_money_precision.sql` — money storage precision: widens every money column (menu prices, order totals, coupon values) to `numeric(12, 3)` so 3-decimal currencies (KWD, BHD…) store their smallest unit exactly instead of rounding to 2 places
12. `supabase/migrations/0012_access_control.sql` — three-role access control (Owner / Manager / Staff): owner-controlled permissions per role and per person (`role_permissions`, `profiles.permissions`) plus the append-only `audit_events` log behind Security & Activity; the backend resolves built-in permission defaults until it runs
13. `supabase/migrations/0013_mfa_required.sql` — per-person two-factor requirement flag (`profiles.mfa_required`): the owner's per-person MFA decision on top of the role defaults (Owner/Manager on, Staff off); MFA enforcement stays off until it runs
14. `supabase/migrations/0014_reservation_fee.sql` — reservation fee: owner controls on the settings (`reservation_fee_enabled`, `reservation_fee_amount`) plus a per-booking fee record on reservations (amount, currency, payment status, PaymentIntent id); fees stay off until it runs
15. `supabase/migrations/0015_reservation_requests.sql` — customer reservation change requests (`reservation_requests`): a signed-in customer's proposed date/time/guests plus a note, handled from the admin Reservations inbox; change requests return 503 until it runs
16. `supabase/migrations/0016_profile_authority_guard.sql` — profile authority-column guard: revokes direct client writes on `profiles.permissions` and `profiles.mfa_required` and adds a guard trigger (the same treatment 0001 gave `role`), closing a hole where a signed-in staff or manager account could grant itself full admin permissions and switch off its own two-factor requirement (a customer account gained nothing from it: that role resolves to no permissions regardless of the stored values and never reaches the admin panel)
17. `supabase/seed.sql` — starter content: restaurant settings and the current menu (15 items)

**Running behind on migrations is safe but reduced — and 0016 is not optional.**
Until a feature's migration runs, that feature stays in its reduced-but-honest
mode: permissions resolve to the built-in defaults, MFA enforcement is off,
reservation fees are off, change requests are unavailable (the API returns
503), and settings saves partially degrade — nothing fails unexpectedly and nothing fakes
success. Migration 0016 is different in kind: it closes a real
privilege-escalation hole (see its entry above), so it belongs in every
install's run list, not on a someday list.

## 2. Hero media files (manual, one minute)
The `hero-portfolio-video` bucket itself is created by migration **0009** above — no manual bucket setup. Only the media files are uploaded by hand:
Dashboard → **Storage** → **`hero-portfolio-video`** → **Upload**:
- `hero-video.mp4` (homepage hero video) and `hero-mobile.jpg` (mobile hero photo).

`src/components/Hero.tsx` loads both files from this bucket's public URLs —
after uploading, make sure the two URLs in `Hero.tsx` point at YOUR project's
storage URL (as shipped they carry the demo project's URL).

## 3. Keys (never share the service-role key publicly, never put it in the frontend)
Dashboard → **Settings → API**:
- `Project URL` → `SUPABASE_URL` (backend) and `VITE_SUPABASE_URL` (frontend)
- `anon public` key → `VITE_SUPABASE_ANON_KEY` (frontend — safe to expose)
- `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**server-side only** — an env var of the API host; for the demo that is the same Vercel project's env vars, with NO `VITE_` prefix, so it never reaches the browser)

## 4. Environment variables
**Demo / default (Option A — everything in ONE Vercel project):**
Vercel → your project → **Settings → Environment Variables** (Production):
- Frontend set: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`
  (do NOT set `VITE_API_URL` — production calls the API same-origin)
- Server set (read only by the API function): `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `GEMINI_API_KEY` (Ember AI chat — free key from Google AI Studio; without it
  `/api/v1/chat` returns 503), `CORS_ORIGIN` (your own site origin, e.g.
  `https://embercoui.vercel.app`), `SITE_URL` (your own site origin — it
  drives the absolute URLs in `robots.txt`, `sitemap.xml`, `llms.txt` and
  `llms-full.txt`; unset, it falls back to the demo's origin, so a real
  install must set it to its own domain), `TRUST_PROXY=1` (one proxy hop
  in front of the API — Vercel's edge in Option A, Railway's in Option B; the
  per-visitor rate limits key off it), `NODE_ENV=production`
Then **Deployments → Redeploy** so the new vars apply.

**Option B (Railway backend instead):** the server set goes to
Railway → Variables, `CORS_ORIGIN` = your Vercel domain, and the Vercel
project additionally gets `VITE_API_URL` = the Railway domain. (`PORT` is
provided by Railway automatically; a standalone backend defaults to 4000.)

## 5. Auth settings
Dashboard → **Authentication → URL Configuration**:
- Site URL: your deployed domain
- Redirect URLs: add `https://YOUR-DOMAIN/**` and, for local development, `http://localhost:5173/**` — Supabase matches redirect URLs exactly unless a glob is used, so a bare domain entry does **not** cover app pages. Password-reset emails link back to `/reset-password`, which the `/**` glob covers.

## 6. Create the first admin
1. Open the live site → **Sign up** with the owner's email (creates a `customer` profile automatically).
2. Dashboard → **SQL Editor**:
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'OWNER_EMAIL_HERE');
   ```
3. Log in at `/admin/login` — done. More staff can be promoted later from **Admin → Staff**.

## 7. Stripe webhook (for card payments)
Stripe Dashboard → **Developers → Webhooks** → Add endpoint:
- URL: `https://YOUR-SITE-DOMAIN/api/v1/payments/webhook` (Option A: your Vercel domain — the API lives on the same domain; Option B: your Railway domain)
- Events: `payment_intent.succeeded`, `payment_intent.payment_failed`
- Copy the signing secret → `STRIPE_WEBHOOK_SECRET` wherever the server env lives (Option A: Vercel; Option B: Railway), then redeploy.

Without Stripe keys the site still works: checkout will clearly report that
card payments are not configured yet instead of pretending an order was paid.

## 8. Verify
- `https://YOUR-SITE-DOMAIN/api/v1/health` → `{ "status": "ok", "supabaseConfigured": true, ... }`
- Home page menu, LiveStatus bar, and testimonials now come from the database —
  change the wait time in **Admin → Settings** and watch the homepage bar update.
