# 🍽️ Ember & Co. — Restaurant Ordering Platform

A complete single-restaurant food ordering platform: customer website, online ordering with Stripe payments, real-time order tracking, and a full admin panel.

🔗 **Live:** [embercoui.vercel.app](https://embercoui.vercel.app)

> This codebase is built to be re-deployed per restaurant (own domain, own Supabase project, own branding settings) rather than as a shared multi-tenant SaaS — each restaurant's own site ranks on its own domain.

---

## ✅ What's built

**Customer website**
- Home, Menu, Our Story, Contact pages (React Router), cart with localStorage persistence
- Menu, live kitchen status and testimonials served from the backend API
- Accounts: Supabase Auth (sign up / login / password reset), profile, saved addresses, favourite dishes, order history, leave-a-review
- Reservations, newsletter signup and contact form — validated and stored via the API
- Checkout: server-recalculated totals (client prices are never trusted), coupon codes, cash-on-delivery or Stripe card payment (Elements)
- Order tracking page: live status via Supabase Realtime with polling fallback
- Ember AI chat assistant (Google Gemini): answers from the live menu and settings, and can add dishes to the cart (checkout always stays manual)

**Admin panel** (`/admin`, staff + admin roles)
- Dashboard with real revenue/order aggregates
- Orders: filter + status management (drives customer tracking in real time)
- Menu CRUD with image uploads to Supabase Storage
- Reservations, Customers, Reviews moderation, Newsletter list + CSV export
- Coupons (Marketing), Finance (paid-revenue by day/month), Staff role management, Settings (kitchen open toggle, wait times, restaurant info)

**Backend API** (`backend/`, Express + TypeScript)
- Supabase Postgres with Row Level Security; the API uses the service-role key server-side only
- Supabase JWT verification + role-based guards; zod validation; rate limiting; helmet; CORS whitelist
- Stripe PaymentIntents + signature-verified webhook — an order is marked paid **only** by the webhook
- 300+ automated tests (Vitest + Supertest, data layer mocked) — money integrity, privacy and admin authorization are covered

## 🗺️ Roadmap (not built yet)
- PayPal checkout option
- Per-restaurant theming pack for repeat deployments

---

## ⚙️ Tech stack

| Layer    | Technology |
|----------|------------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React Router |
| Backend  | Node.js, Express, TypeScript, Zod |
| Database | Supabase Postgres (+ Auth, Realtime, Storage) |
| Payments | Stripe (PaymentIntents + webhooks) |
| Hosting  | Vercel — frontend + serverless API in one project (Railway optional: always-on backend, Option B) |
| CI       | GitHub Actions — lint/typecheck/build (frontend) + lint/typecheck/test/build (backend) + the vercel-entry gate |

## 🚀 Getting started

1. **Database:** follow [SUPABASE_SETUP.md](SUPABASE_SETUP.md) — run the SQL in `supabase/migrations/`, then `supabase/seed.sql`, upload the hero media and create your first admin.
2. **Backend:** `cd backend && npm install && cp .env.example .env` (fill in your keys) `&& npm run dev` → API on `http://localhost:4000`, health at `/api/v1/health`.
3. **Frontend:** `cp .env.example .env` (fill in `VITE_*` values) `&& npm install && npm run dev`.
4. **Deploy:** see [DEPLOYMENT.md](DEPLOYMENT.md).

Without Supabase/Stripe keys the backend still boots: health responds and data endpoints return a clear `503 Supabase not configured` — nothing is faked.

## 📁 Structure

```
src/            customer frontend (+ /admin panel under src/pages/admin)
backend/        Express API (src/routes, src/repositories, tests/)
supabase/       SQL migrations + seed
.github/        CI workflow (frontend + backend jobs)
```

---

Built by **Hamza Bhulla** — full-stack developer from Bhai Pheru, Pakistan.
