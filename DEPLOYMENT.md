# Ember & Co. — Deployment Guide

Single-restaurant deployment: one codebase, one deployment per restaurant.
Two supported shapes — **Option A (default): everything on Vercel** (site +
API as serverless functions), or **Option B: Vercel frontend + Railway
backend**. Database/auth/storage/realtime on **Supabase** either way.

## Environments & branches

| Branch    | Environment | Frontend (Vercel)     | Backend (Railway — Option B only) |
|-----------|-------------|-----------------------|------------------------|
| `develop` | Staging     | staging deployment    | staging service        |
| `main`    | Production  | production deployment | production service     |

Under **Option A** there is no separate backend deployment — the API ships inside the same Vercel deployment as the frontend. The Railway column applies only to Option B.

CI (`.github/workflows/ci.yml`) runs frontend lint/typecheck/build, backend lint/typecheck/test/build, and the `vercel-entry` gate (builds the serverless function with Vercel's own builder and smoke-tests the generated output) on every push/PR to `main` and `develop`. Merge only on green.

## Option A — Vercel only (frontend + API together, serverless) — DEFAULT for the demo

The whole product ships as ONE Vercel project: the Vite site plus the Express
API as a serverless function (`api/index.ts`, rewrites in `vercel.json`).
No Railway, no second domain, no CORS juggling, $0 on the Hobby plan.

- Import the repo in Vercel, root directory = project root. Framework: Vite.
- Environment Variables (Production) — BOTH sets live in this one project:
  - Frontend: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`
    (`VITE_API_URL` is NOT needed — production calls the API same-origin.)
  - Server (function): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
    `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GEMINI_API_KEY` (Ember AI
    chat — without it `/api/v1/chat` returns 503), `CORS_ORIGIN` (the site's
    own https origin), `SITE_URL` (the site's own https origin — drives the
    absolute URLs in `robots.txt`, `sitemap.xml`, `llms.txt` and
    `llms-full.txt`; unset it falls back to the demo's origin),
    `TRUST_PROXY=1` (Vercel's edge is the one proxy hop in
    front of the function — the per-visitor rate limits key off it),
    `NODE_ENV=production`.
- Stripe webhook URL becomes `https://<site-domain>/api/v1/payments/webhook`.
- A note on card payments: checkout supports Stripe cards and
  cash-on-delivery. Stripe only onboards businesses in its supported
  countries (Pakistan is not one of them), so a restaurant there runs this
  same deployment with the Stripe vars left unset — checkout then offers
  cash-on-delivery and reports card payments as not configured instead of
  faking them.
- Limits to remember: 4.5 MB request body (admin image uploads are resized
  in the browser before upload for exactly this reason); functions are
  stateless — the app is built for that (Supabase holds all state).

## Option B — Vercel frontend + Railway backend (always-on server)

Use when a paying client needs an always-on server. Steps below.

## One-time setup

Follow `SUPABASE_SETUP.md` first (all sixteen migrations, seed, storage buckets, first admin, Stripe webhook).

### Frontend (Vercel)
- Import the repo, root directory = project root (not `backend/`).
- Framework preset: Vite. Build command `npm run build`, output `dist`.
- Env vars: `VITE_API_URL` (the Railway backend URL), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`.
- SPA routing: all paths must serve `index.html` (Vercel does this automatically for Vite SPAs via the fallback in `vercel.json` if present, otherwise add a rewrite `/(.*) -> /index.html`).

### Backend (Railway)
- New service from the same repo, root directory = `backend/`.
- Build `npm run build`, start `npm start` (runs `node dist/index.js`).
- Env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-side only — never as a `VITE_` var or anywhere in the browser bundle; in Option A the same key lives as a server-side env var on the Vercel project, where only the function can read it), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GEMINI_API_KEY` (Ember AI chat), `CORS_ORIGIN` (the exact Vercel domain), `SITE_URL` (the site's own domain — drives the absolute URLs in `robots.txt`, `sitemap.xml`, `llms.txt` and `llms-full.txt`; unset it falls back to the demo's origin), `TRUST_PROXY=1` (one proxy hop in front of the backend — the per-visitor rate limits key off it), `NODE_ENV=production`. `PORT` is provided by Railway.
- Health check: `GET /api/v1/health`.

## Rollback
- **Frontend:** Vercel → Deployments → pick the previous production deployment → "Promote to Production".
- **Backend:** Railway → Deployments → redeploy the previous successful deployment.
- **Database:** migrations are additive; roll back by deploying the previous app version first, then (only if needed) fix data with SQL. Take a backup before risky migrations.

## Backups
- Supabase provides daily backups on paid plans and **Point-in-Time Recovery (PITR)** on higher tiers (Project Settings → Database → Backups). Enable PITR before real customer data arrives.
- The `menu-images` storage bucket is public-read; its contents are reproducible from the admin panel but should be included in any manual export routine. The `hero-portfolio-video` bucket holds the owner's hero video + mobile hero photo and is NOT reproducible from the admin panel — include it in manual exports too.

## Smoke checklist after every deploy
1. `GET /api/v1/health` → `{ status: 'ok', supabaseConfigured: true, ... }`.
2. Homepage loads; LiveStatus reflects the admin Settings toggle.
3. Menu page shows dishes from the API (edit one price in admin, confirm it changes).
4. Place a test order (cash on delivery) → track it → change its status in admin → tracking page updates.
5. Stripe test-mode card order → webhook marks it paid → admin Finance total increases.
