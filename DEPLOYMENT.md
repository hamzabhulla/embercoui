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
  stateless — the app is built for that. Supabase holds all state:
  the product data, and the rate-limit counters too (migration 0018),
  so per-visitor limits are shared across function instances instead
  of resetting on every cold start. Function instances keep only an
  in-memory fallback counter, used per request when the shared store
  is unreachable (including before 0018 has been run) — limiting
  never switches off, it just degrades to per-instance budgets until
  the shared store answers again.

## Option B — Vercel frontend + Railway backend (always-on server)

Use when a paying client needs an always-on server. Steps below.

## One-time setup

Follow `SUPABASE_SETUP.md` first (all eighteen migrations — or the one-paste `supabase/all-in-one.sql`, which is the same 0001–0018 + seed — storage buckets, first admin, Google provider, Stripe webhook).

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

## Security note — browser session storage (SEC-M1: accepted architecture, assessed 2026-10-23)

**What is stored where, and why.** The browser Supabase client
(`src/lib/supabase.ts`) is created with no auth options, so supabase-js uses
its platform defaults: the session — access token, refresh token, expiry and
user — is persisted in `localStorage` under its `sb-<project-ref>-auth-token`
key, and the access token is sent as a `Bearer` header on every API call
(`src/services/api.ts`, `src/services/adminApi.ts`). This is the app's
standing Bearer architecture: the backend verifies the token server-side on
every request, and the service-role key never reaches the browser. Nothing in
app code writes tokens anywhere else — the only other web-storage records are
the cart (`localStorage`) and the admin screen-lock / OAuth-return records
(`sessionStorage`), and those carry user ids and validated admin paths only,
never token material.

**The contingent risk, stated plainly.** `localStorage` is readable by any
JavaScript executing on the origin. If attacker JS ever ran on the origin
(a cross-site scripting hole, a compromised dependency), it could copy the
stored refresh token and hold a persistent session until the token is revoked
or expires — and an access token stolen from a signed-in admin who has
completed two-factor verification already carries that verification (aal2)
until it expires. This is a contingent architectural residual, not a live
hole: there is presently no way for attacker JS to get onto the origin.

**Why it is not exploitable today.** Three mitigations hold together, and
all three were re-verified in the 2026-10-23 assessment (Mega Audit #2,
SEC-M1): (1) the tree contains **zero HTML sinks** — no
`dangerouslySetInnerHTML`, no `innerHTML` writes outside a test file, and
the one runtime-injected script payload (the Restaurant JSON-LD) is assigned
via `textContent`, so rendered content cannot become markup; (2) the served
Content-Security-Policy is strict — `script-src 'self' https://js.stripe.com`
with `object-src 'none'` and `base-uri 'self'` — confirmed byte-for-byte
against the live site's response headers on 2026-10-23 and matching
`vercel.json`; and (3) **no third-party JavaScript executes on the origin
beyond Stripe.js** (loaded via `loadStripe` only when a publishable key is
configured) — there is no analytics or tag script at all; Google Fonts,
OpenStreetMap tiles, Unsplash images and the Google Maps embed are passive
resources or cross-origin frames, which cannot read this origin's storage.
A full leak sweep in the same assessment (every `console.*`/log call, every
URL and redirect target, every user-facing error path, the chat and API
request layers) found no place where a token, session object or
Authorization header is logged, placed in a URL, or serialised into a
request body: the Bearer token travels in the `Authorization` header only.

**The accepted decision.** Migrating the session to httpOnly cookies (or any
other storage rewrite) was deliberately **not** undertaken: it would replace
the Supabase client + Bearer design across the whole app to defend against
an attack that currently has no entry point. The residual above is accepted
as the architecture's standing cost.

**Re-open triggers — this note must be revisited if any of these change:**
adding any HTML sink (`dangerouslySetInnerHTML`, an `innerHTML` write, a new
templating path that bypasses React escaping) — *adding a sink reopens this
finding on its own*; relaxing the CSP (a new `script-src` host, or
`'unsafe-inline'` / `'unsafe-eval'` in `script-src`); loading any new
third-party script on the origin (analytics, chat widgets, tag managers);
or changing token longevity in the Supabase dashboard (Auth → JWT expiry /
refresh-token lifetime), which directly scales the blast radius above.

## Smoke checklist after every deploy
1. `GET /api/v1/health` → `{ status: 'ok', supabaseConfigured: true, ... }`.
2. Homepage loads; LiveStatus reflects the admin Settings toggle.
3. Menu page shows dishes from the API (edit one price in admin, confirm it changes).
4. Place a test order (cash on delivery) → track it → change its status in admin → tracking page updates.
5. Stripe test-mode card order → webhook marks it paid → admin Finance total increases.
