# SUPABASE SETUP — Ember & Co. (morning checklist)

Your Supabase project (the one already hosting the hero video):
**https://vamwyouzculrmxlxqkwe.supabase.co**

The code is complete and tested against a mock data layer. To go live you only
need to connect this project — no code changes. Do these steps in order:

## 1. Create the tables (2 minutes)
Supabase Dashboard → **SQL Editor** → paste and run, in this order:
1. `supabase/migrations/0001_init.sql` — tables, checks, RLS policies, realtime on `orders`
2. `supabase/migrations/0002_storage.sql` — `menu-images` storage bucket + policies
3. `supabase/seed.sql` — your current menu (15 items), restaurant settings, and the 3 testimonials as approved reviews

## 2. Keys (never share the service-role key publicly, never put it in the frontend)
Dashboard → **Settings → API**:
- `Project URL` → `SUPABASE_URL` (backend) and `VITE_SUPABASE_URL` (frontend)
- `anon public` key → `VITE_SUPABASE_ANON_KEY` (frontend — safe to expose)
- `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**server-side only** — an env var of the API host; for the demo that is the same Vercel project's env vars, with NO `VITE_` prefix, so it never reaches the browser)

## 3. Environment variables
**Demo / default (Option A — everything in ONE Vercel project):**
Vercel → your project → **Settings → Environment Variables** (Production):
- Frontend set: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`
  (do NOT set `VITE_API_URL` — production calls the API same-origin)
- Server set (read only by the API function): `SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `CORS_ORIGIN` (your own site origin, e.g. `https://embercoui.vercel.app`),
  `NODE_ENV=production`
Then **Deployments → Redeploy** so the new vars apply.

**Option B (Railway backend instead):** the server set goes to
Railway → Variables, `CORS_ORIGIN` = your Vercel domain, and the Vercel
project additionally gets `VITE_API_URL` = the Railway domain.

## 4. Auth settings
Dashboard → **Authentication → URL Configuration**:
- Site URL: your production domain
- Redirect URLs: add your domain + `http://localhost:5173` (password-reset emails link back to `/forgot-password` handled by the app; Supabase email templates use the Site URL)

## 5. Create the first admin
1. Open the live site → **Sign up** with the owner's email (creates a `customer` profile automatically).
2. Dashboard → **SQL Editor**:
   ```sql
   update public.profiles set role = 'admin'
   where id = (select id from auth.users where email = 'OWNER_EMAIL_HERE');
   ```
3. Log in at `/admin/login` — done. More staff can be promoted later from **Admin → Staff**.

## 6. Stripe webhook (for card payments)
Stripe Dashboard → **Developers → Webhooks** → Add endpoint:
- URL: `https://YOUR-SITE-DOMAIN/api/v1/payments/webhook` (Option A: your Vercel domain — the API lives on the same domain; Option B: your Railway domain)
- Events: `payment_intent.succeeded`, `payment_intent.payment_failed`
- Copy the signing secret → `STRIPE_WEBHOOK_SECRET` wherever the server env lives (Option A: Vercel; Option B: Railway), then redeploy.

Without Stripe keys the site still works: checkout will clearly report that
card payments are not configured yet instead of pretending an order was paid.

## 7. Verify
- `https://YOUR-SITE-DOMAIN/api/v1/health` → `{ "status": "ok", "supabaseConfigured": true, ... }`
- Home page menu, LiveStatus bar, and testimonials now come from the database —
  change the wait time in **Admin → Settings** and watch the homepage bar update.
