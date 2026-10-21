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
- `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**backend only** — Railway env)

## 3. Environment variables
**Frontend (Vercel → Settings → Environment Variables)** — see `.env.example`:
`VITE_API_URL` (your Railway backend URL), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

**Backend (Railway → Variables)** — see `backend/.env.example`:
`PORT` (Railway sets this), `NODE_ENV=production`, `CORS_ORIGIN` (your Vercel domain),
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`

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
- URL: `https://YOUR-BACKEND-DOMAIN/api/v1/payments/webhook`
- Events: `payment_intent.succeeded`, `payment_intent.payment_failed`
- Copy the signing secret → `STRIPE_WEBHOOK_SECRET` on Railway.

Without Stripe keys the site still works: checkout will clearly report that
card payments are not configured yet instead of pretending an order was paid.

## 7. Verify
- `https://YOUR-BACKEND-DOMAIN/api/v1/health` → `{ "status": "ok", "supabaseConfigured": true, ... }`
- Home page menu, LiveStatus bar, and testimonials now come from the database —
  change the wait time in **Admin → Settings** and watch the homepage bar update.
