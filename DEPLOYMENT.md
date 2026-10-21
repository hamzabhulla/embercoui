# Ember & Co. — Deployment Guide

Single-restaurant deployment: one codebase, one deployment per restaurant.
Frontend on **Vercel**, backend API on **Railway**, database/auth/storage/realtime on **Supabase**.

## Environments & branches

| Branch    | Environment | Frontend (Vercel)     | Backend (Railway)      |
|-----------|-------------|-----------------------|------------------------|
| `develop` | Staging     | staging deployment    | staging service        |
| `main`    | Production  | production deployment | production service     |

CI (`.github/workflows/ci.yml`) runs frontend lint/typecheck/build and backend lint/typecheck/test/build on every push/PR to `main` and `develop`. Merge only on green.

## One-time setup

Follow `SUPABASE_SETUP.md` first (migrations, seed, storage bucket, first admin, Stripe webhook).

### Frontend (Vercel)
- Import the repo, root directory = project root (not `backend/`).
- Framework preset: Vite. Build command `npm run build`, output `dist`.
- Env vars: `VITE_API_URL` (the Railway backend URL), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_STRIPE_PUBLISHABLE_KEY`.
- SPA routing: all paths must serve `index.html` (Vercel does this automatically for Vite SPAs via the fallback in `vercel.json` if present, otherwise add a rewrite `/(.*) -> /index.html`).

### Backend (Railway)
- New service from the same repo, root directory = `backend/`.
- Build `npm run build`, start `npm start` (runs `node dist/index.js`).
- Env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-side only — never in Vercel), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `CORS_ORIGIN` (the exact Vercel domain), `NODE_ENV=production`. `PORT` is provided by Railway.
- Health check: `GET /api/v1/health`.

## Rollback
- **Frontend:** Vercel → Deployments → pick the previous production deployment → "Promote to Production".
- **Backend:** Railway → Deployments → redeploy the previous successful deployment.
- **Database:** migrations are additive; roll back by deploying the previous app version first, then (only if needed) fix data with SQL. Take a backup before risky migrations.

## Backups
- Supabase provides daily backups on paid plans and **Point-in-Time Recovery (PITR)** on higher tiers (Project Settings → Database → Backups). Enable PITR before real customer data arrives.
- The `menu-images` storage bucket is public-read; its contents are reproducible from the admin panel but should be included in any manual export routine.

## Smoke checklist after every deploy
1. `GET /api/v1/health` → `{ status: 'ok', supabaseConfigured: true }`.
2. Homepage loads; LiveStatus reflects the admin Settings toggle.
3. Menu page shows dishes from the API (edit one price in admin, confirm it changes).
4. Place a test order (cash on delivery) → track it → change its status in admin → tracking page updates.
5. Stripe test-mode card order → webhook marks it paid → admin Finance total increases.
