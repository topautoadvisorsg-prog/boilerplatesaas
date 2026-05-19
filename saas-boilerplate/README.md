# SaaS Boilerplate — v1.6

A reusable, white-label multi-tenant SaaS engine. Drop in product features on top of a fully-wired auth, billing, team, jobs, and observability stack.

> **Stack**: Next.js 15 (App Router) · TypeScript strict · Clerk · Neon Postgres · Drizzle ORM · Stripe · Inngest · Resend (flag-gated) · Sentry · Tailwind v4 · Vercel
>
> **Billing model (v1.5)**: subscriptions are **user-scoped within a tenant** — tenant = scope/billing-container, user = entitlement-holder. Default plans: Free / Pro $4.99 / Premium $9.99 (rename in `lib/config/billing.ts` per product).
>
> **Regions (v1.6)**: optional global region catalog (`regions` table) + per-user selection (`user_regions`, RLS-scoped). Region capacity gated by `PlanLimits.maxActiveRegions`. Seeded by `pnpm db:seed-regions`.

## System overview

### What this is
A **reusable SaaS engine**. Not a starter template you copy-paste from. The core systems (auth, multi-tenancy, billing, jobs, email, admin) are built as **services** with **config-driven identity** and **feature flags**. You configure once, then build your product on top.

### What this is **not**
- Not a marketing site (spec says: separate repo)
- Not a product (no flash-cards, no CRM, no analytics — those are *your* product, built on top)
- Not a single-tenant template (every primitive assumes tenancy)
- Not auth-from-scratch (Clerk handles every auth edge case; we don't second-guess it)

### Multi-tenancy in one paragraph
Each customer organization is a **tenant**. Tenants live at their own subdomain (`acme.yourapp.com`). The edge middleware reads the subdomain, the application re-validates membership against the DB, then every tenant-scoped query runs inside a transaction that sets `app.current_tenant_id` — and **Row-Level Security policies enforce isolation at the database layer**, not just in application code. Even a bug in your business logic cannot leak data across tenants.

---

## Architecture map

```
app/                              ← INTERFACE LAYER (UI + thin actions + webhooks)
  (auth)/sign-in, sign-up         Clerk hosted pages
  onboarding/                     creates workspace (delegates to tenantService)
  (tenant)/                       tenant-scoped UI (dashboard, team, billing, settings)
  admin/                          internal admin (ADMIN_USER_IDS + feature flag)
  accept-invite/[token]/          join-by-invite (delegates to inviteService)
  api/webhooks/clerk, stripe      signature-verify + idempotency-gate + delegate
  api/inngest/                    Inngest function endpoint

lib/
  config/                         ← WHITE-LABEL CORE — only place product identity lives
    app.ts                        name, description, marketing, Inngest app id
    billing.ts                    plan catalog (Free / Pro / Premium — user-scoped entitlements)
    features.ts                   runtime flags (admin/billing/invites/email)

  services/                       ← BUSINESS LOGIC LAYER — every mutation lives here
    tenantService.ts              createTenant, upsertTenantFromClerk
    userService.ts                upsert/delete users, membership lifecycle
    inviteService.ts              invites + accept + remove member
    billingService.ts             Stripe checkout + portal
    subscriptionService.ts        Stripe webhook handlers

  db/                             schema, drizzle client, withTenant() helper
  auth/                           current user, admin gating
  billing/plans.ts                back-compat re-export of config/billing
  billing/stripe.ts               lazy Stripe client
  email/                          transport (Resend or stub) + templates
  jobs/                           Inngest functions
  audit/                          action enum + writer
  tenant.ts                       slug validation + reserved words
  rate-limit.ts                   invite rate limiter (Postgres-backed)
  env.ts                          Zod-validated env, fails fast at boot

drizzle/
  migrations/                     generated SQL
  rls.sql                         Row-Level Security policies

scripts/apply-rls.ts              runs drizzle/rls.sql
middleware.ts                     Clerk + subdomain routing
instrumentation.ts                Sentry init + env validation at boot
sentry.{client,server,edge}.config.ts
```

### Layer rules
1. **`app/`** is pure interface — pages, server actions (thin wrappers), webhook routes (signature-verify + delegate).
2. **`lib/services/`** holds all business logic. Anything that mutates DB state or talks to an external API lives here.
3. **`lib/config/`** is the only place product identity exists. Forking a new product = editing these three files + setting env vars.
4. **`lib/db/`** is never touched by `app/` code. Services own the data layer.

### Database schema at a glance (`lib/db/schema.ts`)

| Table | Purpose | Tenant-scoped? | Key fields |
|---|---|---|---|
| `users` | App user (synced from Clerk) | No (global) | `clerk_user_id`, `email`, `timezone`, `daily_goal_minutes`, `onboarding_complete`, `streak_count`, `last_study_date`, `email_unsubscribed`, `email_unsubscribed_types` |
| `tenants` | Workspace / organization | No (global) | `clerk_org_id`, `slug`, `subdomain`, `custom_domain`, `status` enum, branding (`primary_color`, `secondary_color`, `font_family`, `logo_url`), `support_email` |
| `tenant_settings` | Per-tenant runtime config (1:1 w/ tenants) | Yes (1 row per tenant) | `feature_flags`, `subscription_tiers`, `trial_days`, `grace_period_days`, `storage_quota_mb`, `session_card_cap`, `enabled_region_ids` |
| `tenant_members` | User ↔ tenant link with role | Yes (RLS) | `tenant_id`, `user_id`, `role` (owner/admin/member) |
| `subscriptions` | **User-scoped** Stripe state inside a tenant | Yes (RLS) | unique `(tenant_id, user_id)`, `plan` (free/pro/premium), `status`, `stripe_customer_id`, `stripe_subscription_id`, `trial_ends_at`, `grace_period_end`, `previously_unlocked_deck_ids` |
| `invitations` | Pending team invites | Yes (RLS) | `tenant_id`, `email`, `role`, `token`, `expires_at`, `accepted_at` |
| `audit_logs` | Append-only audit trail | Yes (RLS, nullable tenant_id for system events) | `tenant_id`, `user_id`, `action` (from `AUDIT_ACTIONS`), `metadata` jsonb |
| `processed_stripe_events` | Stripe webhook idempotency gate | No (global) | `stripe_event_id` PK |
| `invite_rate_limit` | Postgres-backed rate limiter | No (per-tenant bucket) | `tenant_id` PK, `window_start`, `count` |
| `regions` | Global catalog of regions/territories | **No (global)** — readable by all tenants | `slug`, `name`, `description`, `parent_region_id`, `bounding_box` jsonb, `accent_color`, `display_order`, `is_active`. Seeded via `pnpm db:seed-regions`. |
| `user_regions` | User's selected regions | Yes (RLS) | `tenant_id`, `user_id`, `region_id`, `is_primary`. Partial unique index enforces "1 primary per user". Plan limit (`maxActiveRegions`) enforced in service layer. |

---

## Modules

Each subsystem documented as: **what it does · where it lives · how to modify it.**

### 1. Auth (Clerk)
- **What**: Email/password, Google OAuth, magic link, organizations, session JWTs. Every auth edge case (email merge, deletion, session expiry) handled by Clerk.
- **Where**:
  - `middleware.ts` — Clerk session validation on every protected route
  - `lib/auth/current-user.ts` — `requireAppUser()` resolves Clerk session → app `users` row, lazy-provisioning on first hit
  - `lib/auth/admin.ts` — `isInternalAdmin()` / `requireInternalAdmin()` gated by `ADMIN_USER_IDS`
  - `app/(auth)/sign-in/`, `app/(auth)/sign-up/` — Clerk hosted components
  - `app/api/webhooks/clerk/route.ts` — Svix-verified webhook → delegates to `userService` + `tenantService`
- **How to modify**:
  - Enable/disable login methods → Clerk Dashboard (no code change)
  - Customize sign-in UI → swap `<SignIn />` for self-hosted Clerk components, or restyle via Clerk's appearance API
  - Add new auth-required routes → they're protected by default; mark routes public in `middleware.ts` via `createRouteMatcher`
  - Change admin gate → edit `ADMIN_USER_IDS` env var (comma-separated Clerk user IDs)

### 2. Tenancy
- **What**: Organizations live at `{slug}.yourapp.com`. Subdomain → tenant resolution at the edge, re-validated server-side, enforced by Postgres RLS. Each tenant has a `tenant_settings` row holding per-tenant runtime config (feature flags, branding, region whitelist, session caps, grace period).
- **Where**:
  - `middleware.ts` — extracts subdomain (trusting only Vercel-normalized `Host`), sets `x-tenant-slug` header
  - `lib/db/with-tenant.ts` — `resolveTenantForUser()` re-validates membership against DB; `withTenant()` opens a transaction with `app.current_tenant_id` set
  - `drizzle/rls.sql` — RLS policies on `tenant_members`, `subscriptions`, `invitations`, `audit_logs`
  - `lib/tenant.ts` — slug format + reserved words
  - `lib/services/tenantService.ts` — `createTenant` (atomic Clerk + DB w/ rollback, seeds `tenant_settings` + owner's free subscription in one txn), `upsertTenantFromClerk`
  - `tenants` table fields: `name`, `slug`, `subdomain`, `custom_domain`, `status` enum, `primary_color`, `secondary_color`, `font_family`, `support_email`, `logo_url`
- **How to modify**:
  - Add reserved slugs → append to `RESERVED_SLUGS` in `lib/tenant.ts`
  - Change slug rules → edit `SLUG_REGEX` in `lib/tenant.ts`
  - Add tenant-scoped table → add `tenant_id uuid NOT NULL` column + write an RLS policy in `drizzle/rls.sql` + re-run `pnpm db:rls`
  - Add a per-tenant config field → extend the `tenant_settings` table schema; defaults seeded automatically by `tenantService.createTenant`
  - Switch to path-based tenancy (e.g., `/t/{slug}/...`) → rewrite `middleware.ts` to parse path instead of `Host`; everything downstream is slug-based and unchanged

### 3. Billing (Stripe)
- **What**: Per-user subscription billing with trial / upgrade / downgrade / cancel / payment-failed. **Entitlement lives on the user, not the tenant** — each user has their own Stripe Customer and Subscription row, scoped by `(tenant_id, user_id)`. Plan is **always read from DB** (never cached in session); lapsed subscriptions drop to read-only.
- **Where**:
  - `lib/config/billing.ts` — plan catalog (Free / Pro $4.99 / Premium $9.99, trial days, feature matrix: `maxDecks`, `dailyCardLimit`, `maxActiveRegions`, `hasAudioCards`, `hasAdvancedProgress`, `hasAiCardGeneration`)
  - `lib/services/billingService.ts` — `startCheckout` (per-user Stripe Customer), `openBillingPortal`, internal `ensureCustomer`
  - `lib/services/subscriptionService.ts` — `applySubscriptionUpsert`, `markSubscriptionCanceled`, `markPastDueByStripeId`, `getUserSubscription`, `ensureFreeSubscription`
  - `app/api/webhooks/stripe/route.ts` — verified webhook, atomic idempotency via `processed_stripe_events`; subscription metadata MUST contain `tenant_id` AND `user_id`
  - `app/(tenant)/billing/page.tsx` + `actions.ts` — UI + thin server actions
- **How to modify**:
  - Add a new plan → add entry to `billingConfig` in `lib/config/billing.ts`, add `STRIPE_<NAME>_PRICE_ID` env var, create the price in Stripe Dashboard
  - Change feature matrix → edit the `limits` object on each plan; `canUseFeature()` and `isWithinLimit()` use it
  - Change trial length → edit `trial_period_days` in `billingService.startCheckout` *and* `trialDays` in `lib/config/billing.ts` (keep them in sync)
  - Disable billing entirely → `FEATURE_BILLING_ENABLED=0` (tab hides, actions reject)
  - Add a new webhook event → handle in `app/api/webhooks/stripe/route.ts` (delegate to a service method; never inline logic)
  - **Switch to tenant-scoped billing (B2B team model)** → change the unique index on `subscriptions` from `(tenant_id, user_id)` to `(tenant_id)`, drop `user_id` references in services & webhook. The schema/service split makes either model possible.

### 4. Jobs (Inngest)
- **What**: Async tasks with retries (3x), concurrency limits, dead-letter behavior, and cron triggers. **Idempotency is enforced by callers**, not Inngest — every job checks a `*_sent_at` column or the `processed_*_events` table before doing work.
- **Where**:
  - `lib/jobs/client.ts` — `Inngest` instance + typed `AppEvents`
  - `lib/jobs/functions.ts` — all 7 functions registered:
    - `sendWelcomeEmail` (event-triggered, idempotent via `users.welcome_email_sent_at`)
    - `provisionTenant` (event-triggered)
    - `sendInviteEmail` (event-triggered, idempotent via `invitations.invite_email_sent_at`)
    - `trialEndingReminder` (event-triggered, idempotent via `subscriptions.trial_reminder_sent_at`)
    - `scheduleTrialEndingReminders` (cron `0 9 * * *`, fan-outs `billing/trial-ending` events)
    - `handlePaymentFailed` (event-triggered)
    - `cleanupStripeEvents` (cron `0 3 * * *`, purges `processed_stripe_events` >30 days)
  - `app/api/inngest/route.ts` — Next route adapter
- **How to modify**:
  - Add a new job → declare event in `AppEvents`, write function via `inngest.createFunction`, push it into `functions[]` array
  - Trigger a job → `inngest.send({ name, data })` from any service. Never send events from inside webhook routes — that's what services are for
  - Change retry policy → per-function `retries` config; default is 3
  - Add an idempotency guard → add a `*_sent_at` column to the relevant table, set it at the end of `step.run`, check it at the start

### 5. Email
- **What**: Transactional email through one transport interface. Stub-by-default for boilerplate; flips to Resend with one env var.
- **Where**:
  - `lib/email/client.ts` — `sendEmail()` — Resend SDK lazy-imported only when `FEATURE_EMAIL_ENABLED=1`
  - `lib/email/templates.ts` — 5 typed templates (welcome, invite, trial-ending, payment-failed, subscription-canceled)
  - Always called from Inngest jobs, **never** inline in a request
- **How to modify**:
  - Flip from stub to real → `FEATURE_EMAIL_ENABLED=1` in `.env.local` (and ensure `RESEND_API_KEY` + verified `EMAIL_FROM`)
  - Add a new template → add a function to `lib/email/templates.ts` returning `{ subject, html, text }`. Call it from the relevant Inngest job
  - Switch provider (SendGrid, Postmark, etc.) → replace the body of `sendEmail()` only; nothing else changes
  - All transactional emails respect Resend's suppression list automatically (we don't bypass)

### 6. Admin
- **What**: Read-only internal dashboard for support/ops. Tenant overview, paid-subscription count, full tenant list with plan/status, per-tenant detail (subscription + members), full user list. Access logged via `admin.tenant_accessed` audit events.
- **Where**:
  - `app/admin/layout.tsx` — feature flag gate + `ADMIN_USER_IDS` gate (404 / redirect)
  - `app/admin/page.tsx` — overview aggregates (raw SQL count)
  - `app/admin/tenants/page.tsx`, `app/admin/tenants/[id]/page.tsx` — listings + detail
  - `app/admin/users/page.tsx` — user list
- **How to modify**:
  - Add an admin user → append Clerk user id to `ADMIN_USER_IDS`
  - Disable admin entirely → `FEATURE_ADMIN_ENABLED=0` (all `/admin/*` routes return 404)
  - Add an admin-only mutation → write a new service method, wrap in `requireInternalAdmin()`, write an `AUDIT_ACTIONS.ADMIN_*` log entry
  - Add filters / pagination / charts → standard Next.js work in `app/admin/tenants/page.tsx`; no architectural change needed

### 7. Observability
- **What**: Sentry across all 3 Next.js runtimes (client, server, edge) + `onRequestError` for App-Router-aware capture.
- **Where**: `sentry.{client,server,edge}.config.ts`, `instrumentation.ts`, `next.config.ts` (`withSentryConfig`)
- **How to modify**: Edit DSN / sample rates per environment in the three config files. Source-map upload requires `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` at build time.

### 8. Regions *(optional product layer — v1.6)*
- **What**: Two-table region system. `regions` is a global catalog (no tenancy). `user_regions` is RLS-scoped per tenant and tracks each user's selection with exactly-one-primary enforced by a partial unique index. Region capacity is plan-gated via `PlanLimits.maxActiveRegions` — Free is capped at 1, paid tiers unlimited.
- **Where**:
  - `lib/db/schema.ts` — `regions`, `user_regions` tables + relations
  - `lib/services/regionService.ts` — `listAvailableRegions`, `getUserRegions`, `setUserRegions`, `setPrimaryRegion`, `removeUserRegion`, `getPrimaryRegion`, `RegionLimitError`
  - `drizzle/rls.sql` — `ur_tenant_isolation` policy on `user_regions`
  - `scripts/seed-regions.ts` — idempotent NA wilderness seed (10 regions)
  - `lib/audit/actions.ts` — `REGION_SELECTED`, `REGION_PRIMARY_CHANGED`, `REGION_REMOVED`
- **How to modify**:
  - Add/rename a region → edit the `SEED` array in `scripts/seed-regions.ts`, then `pnpm db:seed-regions` (idempotent — runs as upsert by slug)
  - Restrict a tenant's visible regions → set `tenant_settings.enabled_region_ids` to a non-empty array of region UUIDs. Empty array = all regions.
  - Change region capacity per plan → edit `maxActiveRegions` in `lib/config/billing.ts`
  - Switch the catalog to a totally different concept (e.g., industries, languages) → keep the schema, replace seed data + service variable names; the `tenant_settings.enabled_region_ids` filter logic still applies
  - Drop the region system entirely → delete the two tables, the service, the seed, and the RLS policy. Nothing else depends on it.

---

## Quick start

```bash
git clone <this-repo> my-app
cd my-app
cp .env.example .env.local
# fill in keys (see "Environment" below)

pnpm install              # or yarn / npm
pnpm db:generate          # produce SQL from drizzle schema
pnpm db:migrate           # apply migrations to Neon
pnpm db:rls               # apply RLS policies
pnpm dev                  # http://localhost:3000
```

Local subdomains — add to `/etc/hosts`:

```
127.0.0.1   localhost
127.0.0.1   acme.localhost
127.0.0.1   admin.localhost
```

Then visit `http://localhost:3000` → sign up → onboarding → workspace at `http://<slug>.localhost:3000`.

> **Safari** can be flaky with `.localhost` subdomains; use Chrome/Firefox or set `NEXT_PUBLIC_APP_DOMAIN=lvh.me` (resolves to `127.0.0.1`).

---

## Environment

Every variable in `.env.example` is **required at boot**. The app will refuse to start if anything is missing — by design.

### Where to get each key

| Variable | Provider | How to get it |
|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | [Neon](https://neon.tech) | Create a project → Connection details → copy "Pooled" and "Direct". |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | [Clerk](https://dashboard.clerk.com) | Create an app → API Keys. Enable **Organizations** in the dashboard. |
| `CLERK_WEBHOOK_SECRET` | Clerk | Webhooks → Add Endpoint → `https://<your-domain>/api/webhooks/clerk` → subscribe to `user.*`, `organization.*`, `organizationMembership.*`. |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY` | [Stripe](https://dashboard.stripe.com) | Developers → API keys (use test keys to start). |
| `STRIPE_WEBHOOK_SECRET` | Stripe | Developers → Webhooks → Add endpoint → `https://<your-domain>/api/webhooks/stripe` → events: `customer.subscription.*`, `invoice.payment_failed`. For local dev: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`. |
| `STRIPE_PRO_PRICE_ID`, `STRIPE_PREMIUM_PRICE_ID` | Stripe | Products → create two recurring prices (defaults: $4.99 Pro / $9.99 Premium — edit in `lib/config/billing.ts`). Copy the `price_...` IDs. |
| `RESEND_API_KEY`, `EMAIL_FROM` | [Resend](https://resend.com) | Create API key. Verify a sending domain — `EMAIL_FROM` must use that domain. *Email is stubbed by default; only required at boot.* |
| `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | [Inngest](https://app.inngest.com) | Project → Manage → Event keys / Signing key. |
| `NEXT_PUBLIC_APP_URL` | — | `https://yourapp.com` (or `http://localhost:3000` locally). |
| `NEXT_PUBLIC_APP_DOMAIN` | — | Root domain only, e.g. `yourapp.com` (no protocol). |
| `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN` | [Sentry](https://sentry.io) | Project → Client Keys (DSN). |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | Sentry | Only needed for source-map uploads at build time. |
| `ADMIN_USER_IDS` | Clerk | Comma-separated list of Clerk `user_...` IDs that can access `/admin`. |

> **Rule**: No secret key may use the `NEXT_PUBLIC_` prefix. Anything `NEXT_PUBLIC_*` is shipped to the browser.

---

## Architecture at a glance

```
Browser
  │
  ▼
Vercel Edge (CDN)        ← normalizes Host header (trust boundary)
  │
  ▼
middleware.ts            ← reads subdomain → x-tenant-slug; runs Clerk auth
  │
  ▼
Next.js App
  ├── Server Components  ← read data via withTenant()  → DB (RLS-enforced)
  ├── Server Actions     ← mutate data via withTenant()
  └── /api/webhooks/*    ← Clerk, Stripe, Inngest (signature-verified)
        │
        └─► Inngest events ─► background jobs (emails, provisioning, reminders)
```

### Multi-tenant safety model

1. **Edge** — Vercel normalizes the Host header. The client cannot spoof `x-tenant-slug`.
2. **Middleware** — extracts subdomain → header. Never trusted directly downstream.
3. **Server code** — calls `resolveTenantForUser(slug, userId)` against the DB. Throws if no membership.
4. **`withTenant(ctx, fn)`** — opens a transaction and runs `set_config('app.current_tenant_id', ...)`. Every query inside the transaction is scoped by RLS.
5. **RLS** — `tenant_members`, `subscriptions`, `invitations`, `audit_logs` all have policies that compare `tenant_id` to `app_current_tenant_id()`. See `drizzle/rls.sql`.

> Nesting `withTenant()` inside another transaction is **disallowed**. If you already have a `tx`, run `SELECT set_config('app.current_tenant_id', $1, true)` manually inside it.

---

## Developer workflow (order matters)

Run these in this exact order the first time:

1. **Provision external services** (parallel)
   - Neon project → grab `DATABASE_URL` + `DATABASE_URL_UNPOOLED`
   - Clerk app → grab keys; **enable Organizations** in Clerk Dashboard → Organizations settings
   - Stripe (test mode) → grab keys; create Pro + Premium products with monthly recurring prices
   - Inngest project → grab event key + signing key
   - Sentry project → grab DSN
2. **Fill `.env.local`** from `.env.example`. Boot will refuse if anything is missing.
3. **Database**: `pnpm db:generate && pnpm db:migrate && pnpm db:rls && pnpm db:seed-regions`
4. **Local subdomains**: add hosts entries (`acme.localhost`, `admin.localhost`)
5. **Start app**: `pnpm dev`
6. **Webhook tunnels** (separate terminals — wait until step 5 is up):
   - `stripe listen --forward-to localhost:3000/api/webhooks/stripe` → copy printed `whsec_...` into `STRIPE_WEBHOOK_SECRET` and restart dev
   - For Clerk: open an ngrok tunnel, then in Clerk Dashboard → Webhooks → Add Endpoint pointing at `<tunnel>/api/webhooks/clerk` subscribed to `user.*`, `organization.*`, `organizationMembership.*`. Copy the signing secret into `CLERK_WEBHOOK_SECRET` and restart dev
7. **Inngest dev server** (separate terminal): `pnpm inngest:dev` → UI at http://localhost:8288 syncs your functions automatically
8. **Run the smoke test checklist** (below)

## Common commands

```bash
pnpm dev                  # Next dev server
pnpm typecheck            # tsc --noEmit
pnpm lint                 # eslint
pnpm build                # production build (uploads source maps to Sentry if SENTRY_AUTH_TOKEN set)

pnpm db:generate          # produce a new migration from schema changes
pnpm db:migrate           # apply pending migrations
pnpm db:push              # ⚠️ dev only — skip migration files, push schema directly
pnpm db:rls               # apply Row-Level Security policies
pnpm db:seed-regions      # seed/refresh the global regions catalog (idempotent)

pnpm inngest:dev          # local Inngest dev server (UI at http://localhost:8288)
```

### Stripe webhooks locally

```bash
stripe login
stripe listen --forward-to localhost:3000/api/webhooks/stripe
# copy the printed whsec_... into STRIPE_WEBHOOK_SECRET
```

### Clerk webhooks locally

Use [ngrok](https://ngrok.com) or [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) to expose `localhost:3000`, then point a Clerk webhook at `https://<tunnel>/api/webhooks/clerk`.

---
## Troubleshooting

### Quick "where do I look?" table

| Symptom | First file to open |
|---|---|
| App won't boot, env error | `lib/env.ts` (validates env), `.env.local` |
| Sign-in/sign-up issue | `middleware.ts`, `lib/auth/current-user.ts`, Clerk dashboard |
| Wrong user after login | `lib/auth/current-user.ts` (`requireAppUser`) |
| Tenant routing broken | `middleware.ts` (subdomain extraction), `lib/db/with-tenant.ts` (`resolveTenantForUser`) |
| Cross-tenant data leak | `drizzle/rls.sql`, any service in `lib/services/` not using `withTenant()` |
| Onboarding fails | `lib/services/tenantService.ts` (`createTenant` — seeds tenant_settings + owner sub), `app/onboarding/actions.ts` |
| Per-tenant setting not applied | `tenant_settings` row + `lib/services/tenantService.ts` seeding logic |
| Invite/accept broken | `lib/services/inviteService.ts`, `app/(tenant)/team/actions.ts`, `app/accept-invite/[token]/actions.ts` |
| Stripe checkout/portal broken | `lib/services/billingService.ts` (per-user customer), `app/(tenant)/billing/actions.ts`, `lib/billing/stripe.ts` |
| Stripe webhook bug | `app/api/webhooks/stripe/route.ts` (gate + metadata `tenant_id`+`user_id`), `lib/services/subscriptionService.ts` (logic) |
| Wrong plan / lapsed user not gated | `lib/config/billing.ts` (`canUseFeature`), `lib/services/subscriptionService.ts` (`getUserSubscription`) |
| User has multiple subs in one tenant | Expected — billing is user-scoped. Composite unique is `(tenant_id, user_id)`. |
| Clerk webhook bug | `app/api/webhooks/clerk/route.ts` (gate), `lib/services/userService.ts` + `tenantService.ts` (logic) |
| Background job not running | `lib/jobs/functions.ts`, `lib/jobs/client.ts`, `app/api/inngest/route.ts` |
| Email not sending / wrong content | `lib/email/client.ts` (transport), `lib/email/templates.ts` (copy) |
| Plan/feature gate wrong | `lib/config/billing.ts` (`canUseFeature`, plan limits) |
| Feature flag not toggling | `lib/config/features.ts` |
| Branding string showing wrong | `lib/config/app.ts` + `NEXT_PUBLIC_APP_*` env vars |
| Admin UI bug | `app/admin/*`, `components/admin/*`, `components/ui/*` |
| Admin tenants list missing plan column | Removed in v1.5 — billing is user-scoped, so a tenant has many subs. See per-user list on `/admin/tenants/[id]`. |
| Audit log missing entries | `lib/audit/log.ts`, `lib/audit/actions.ts` (enum) |
| DB schema mismatch | `lib/db/schema.ts` → re-run `pnpm db:generate && pnpm db:migrate` |
| RLS blocking valid query | `drizzle/rls.sql`, confirm caller wraps in `withTenant()` |

### Concrete failures, in priority order

### App refuses to start: `Invalid or missing environment variables`
- **Cause**: `lib/env.ts` Zod validation failed at boot.
- **Fix**: The error lists every missing/invalid key with its path. Fill them in `.env.local`. No fallbacks exist — by design.

### Sign-in works, but visiting `acme.localhost:3000/dashboard` redirects to `/onboarding`
- **Most likely**: there's no tenant with slug `acme` in your DB, or your Clerk user isn't a member.
- **Check**: `SELECT * FROM tenants WHERE slug='acme';` and `SELECT * FROM tenant_members WHERE tenant_id=...;`
- **Also check**: Did onboarding succeed? Network tab → response of the `createOrgAction` POST.

### Stripe webhook returns 400 `Invalid signature`
- **Most likely**: `STRIPE_WEBHOOK_SECRET` doesn't match the endpoint sending events.
- **Local dev**: each `stripe listen` invocation prints a new `whsec_...`. Copy the latest into `.env.local` and restart `pnpm dev`.
- **Production**: Stripe Dashboard → Webhooks → endpoint → reveal signing secret. Must match exactly.

### Stripe webhook returns 200 with `{ duplicate: true }`
- **Cause**: idempotency gate working as designed — event id already in `processed_stripe_events`.
- **Fix needed?**: usually no. If you really need to replay state: `DELETE FROM processed_stripe_events WHERE stripe_event_id='evt_...';` then resend from Stripe Dashboard.

### Clerk webhook returns 400 `Missing Svix headers` or `Invalid signature`
- **Cause**: Clerk uses Svix headers (`svix-id`, `svix-timestamp`, `svix-signature`).
- **Local dev**: ngrok must forward HTTPS. Copy the **Signing Secret** from the Clerk webhook config (starts with `whsec_`).
- **Test**: Clerk Dashboard → Webhooks → Endpoint → "Testing" tab → send a test event.

### Clerk sign-in works but no `users` row appears
- **Cause**: webhook not reaching dev server (most often: ngrok tunnel down or URL stale).
- **Workaround**: `requireAppUser()` lazy-provisions the user from `currentUser()` on the next protected request — visit any tenant page and the row will be created.
- **Real fix**: Re-verify Clerk webhook endpoint URL + secret.

### `pnpm db:migrate` fails with permission/auth errors
- **Cause**: using `DATABASE_URL` (pooled) instead of `DATABASE_URL_UNPOOLED` (direct).
- **Fix**: Drizzle migrations must run against the **direct** connection. `drizzle.config.ts` already enforces this — confirm both env vars are set.

### RLS error: `new row violates row-level security policy for table "..."`
- **Cause**: writing a row whose `tenant_id` doesn't equal `app.current_tenant_id` (the GUC `withTenant` sets).
- **Fix**: confirm the write is inside `withTenant(ctx, fn)` AND the row's `tenant_id` matches `ctx.tenantId`.
- **System writes** (webhooks): operate at trust level, scope by literal `tenant_id` from event metadata.

### Inngest functions not firing
- **Local dev**: `pnpm inngest:dev` must be running. Dev server discovers functions via `/api/inngest`.
- **Production**: Inngest Dashboard → Apps → sync your deployed URL (`https://yourapp.com/api/inngest`). Without this, no events trigger.
- **Note**: `inngest.send(...)` only enqueues; it doesn't execute. Check Inngest Dashboard → Runs for execution logs.
- **Early exits**: most jobs return `{ skipped: "already-sent" }` if `*_sent_at` is already set. That's correct.

### Cron jobs (`scheduleTrialEndingReminders`, `cleanupStripeEvents`) never run
- **Cause**: Inngest cron triggers register only after the app is synced in the Inngest Dashboard.
- **Fix**: Inngest Dashboard → Apps → sync. Then "Functions" should show next-run time.

### Infinite redirect / "Maximum call stack" on `/dashboard`
- **Cause**: missing tenant slug. `(tenant)/layout.tsx` redirects to `/onboarding` if `x-tenant-slug` is absent.
- **Fix**: visit on a subdomain URL (`acme.localhost:3000/dashboard`, not `localhost:3000/dashboard`).

### Production: subdomain shows Vercel 404
- **Cause**: wildcard domain not configured.
- **Fix**: Vercel → Project → Domains → add `*.yourapp.com`. DNS must have a wildcard CNAME pointing to `cname.vercel-dns.com`.

### Email "sent" but recipient sees nothing
- **Cause**: `FEATURE_EMAIL_ENABLED=0` (default) — emails only log to console.
- **Fix**: set `FEATURE_EMAIL_ENABLED=1`, provide valid `RESEND_API_KEY`, and verify your sending domain in Resend so `EMAIL_FROM` is accepted.

### Sentry not capturing errors
- **Check**: `SENTRY_DSN` (server) and `NEXT_PUBLIC_SENTRY_DSN` (browser) — both required.
- **Check**: `instrumentation.ts` is at the project root (not in `app/`). It is.
- **No source maps in traces**: set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` before `pnpm build`.

---

## Extending the system — building a product on top

The whole point of this engine. Read carefully.

### Where to add new code

| You want to add… | Put it here |
|---|---|
| A tenant-scoped page (`/projects`, `/notes`, `/decks`) | `app/(tenant)/<feature>/page.tsx` |
| A new mutation | New service in `lib/services/<feature>Service.ts` + thin action in `app/(tenant)/<feature>/actions.ts` |
| A new DB table | `lib/db/schema.ts` (include `tenant_id uuid NOT NULL` for tenant-scoped data) → `pnpm db:generate && pnpm db:migrate` → add RLS policy to `drizzle/rls.sql` → `pnpm db:rls` |
| A new plan | Add to `billingConfig` in `lib/config/billing.ts` + create the Stripe price + add `STRIPE_<NAME>_PRICE_ID` env var |
| A new feature gate | Add a flag to `lib/config/features.ts` |
| A new background job | Declare event in `lib/jobs/client.ts` `AppEvents` → write function in `lib/jobs/functions.ts` → push into `functions[]` array |
| A new email | Add template to `lib/email/templates.ts` → call from an Inngest job (never inline) |
| A new admin page | `app/admin/<page>/page.tsx` — wrap in `requireInternalAdmin()`, audit access via `logAudit(AUDIT_ACTIONS.ADMIN_*)` |

### What you must NOT touch

These are core invariants. Modifying them breaks tenant safety:

- **`middleware.ts`** — unless changing the tenant-routing strategy entirely. Don't loosen Clerk gating.
- **`lib/db/with-tenant.ts`** — the `set_config('app.current_tenant_id', ...)` call is what makes RLS work.
- **`drizzle/rls.sql`** — only ADD policies for new tables. Never relax existing ones.
- **Webhook signature verification** in `app/api/webhooks/*/route.ts` — never disable.
- **`processed_stripe_events` atomic insert** in the Stripe webhook — that's the idempotency gate.
- **`lib/env.ts`** — never add a fallback for a required key. Boot must fail loud.

### Worked example: adding a "Projects" feature

End-to-end, what a new tenant-scoped feature looks like:

1. **Schema** (`lib/db/schema.ts`):
   ```ts
   export const projects = pgTable("projects", {
     id: uuid("id").primaryKey().defaultRandom(),
     tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
     name: text("name").notNull(),
     createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
   }, (t) => [index("projects_tenant_idx").on(t.tenantId)]);
   ```
2. **Migrate**: `pnpm db:generate && pnpm db:migrate`
3. **RLS** — append to `drizzle/rls.sql`:
   ```sql
   ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
   ALTER TABLE projects FORCE ROW LEVEL SECURITY;
   CREATE POLICY projects_tenant_isolation ON projects
     USING (tenant_id = app_current_tenant_id())
     WITH CHECK (tenant_id = app_current_tenant_id());
   ```
   Then `pnpm db:rls`.
4. **Service** (`lib/services/projectService.ts`):
   ```ts
   export async function createProject(ctx: TenantContext, input: { name: string }) {
     return withTenant(ctx, async (tx) => {
       const [row] = await tx.insert(projects)
         .values({ tenantId: ctx.tenantId, name: input.name })
         .returning();
       return row;
     });
   }
   ```
5. **Action** (`app/(tenant)/projects/actions.ts`):
   ```ts
   "use server";
   export async function createProjectAction(formData: FormData) {
     const { ctx } = await tenantCtx();
     await createProject(ctx, { name: String(formData.get("name")) });
     revalidatePath("/projects");
   }
   ```
6. **Page** (`app/(tenant)/projects/page.tsx`): standard server component reading data via `withTenant()`.

Auth, tenancy, RLS, audit log (if you add one), billing gate (`canUseFeature`), feature flag (if you wire one) all work for free.

### Plan-gating a feature

```ts
import { canUseFeature } from "@/lib/config/billing";

const [sub] = await db.select({ plan: subscriptions.plan, status: subscriptions.status })
  .from(subscriptions).where(eq(subscriptions.tenantId, ctx.tenantId)).limit(1);
if (!canUseFeature(sub.plan, sub.status, "hasAdvancedProgress")) {
  throw new Error("Upgrade required");
}
```

Plan is **always read from DB**, never cached. Lapsed subscriptions automatically drop to read-only via `canUseFeature`.

---



## Going live: switching email from stub to Resend

Set `FEATURE_EMAIL_ENABLED=1` in `.env.local`. That's it — `lib/email/client.ts` already calls Resend behind that flag. Make sure `RESEND_API_KEY` and `EMAIL_FROM` are valid before flipping.

## Branding / white-labelling

All identity lives in **`lib/config/app.ts`** + the `NEXT_PUBLIC_APP_*` env vars in `.env.example`. To start a new product:

1. Set `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_DESCRIPTION`, `NEXT_PUBLIC_APP_HEADLINE`, `NEXT_PUBLIC_APP_SUBHEAD`, `NEXT_PUBLIC_APP_SLUG`, `NEXT_PUBLIC_SUPPORT_EMAIL` in `.env.local`.
2. (Optional) Tweak `lib/config/billing.ts` plan catalog and `lib/config/features.ts` defaults.
3. Build your product UI as new routes under `app/(tenant)/<your-feature>/`. Use services from `lib/services/*` and never write raw DB queries in your pages.

No code under `app/` references the boilerplate name.

---

## Deployment (Vercel)

1. Push to GitHub, import in Vercel.
2. Add all env variables from `.env.example`.
3. Configure your domain as a **wildcard**: add `*.yourapp.com` in Vercel → Domains.
4. After first deploy:
   - Add Clerk webhook endpoint pointing at `https://yourapp.com/api/webhooks/clerk`.
   - Add Stripe webhook endpoint pointing at `https://yourapp.com/api/webhooks/stripe`.
   - In Inngest, sync your app from the dashboard (point to `https://yourapp.com/api/inngest`).
5. Source maps: set `SENTRY_AUTH_TOKEN` + `SENTRY_ORG` + `SENTRY_PROJECT` for build-time upload.

---

## Smoke test (Phase 0 checklist)

After cloning, before building product features, verify:

- [ ] `pnpm typecheck` → zero errors
- [ ] `pnpm lint` → zero errors
- [ ] `pnpm db:migrate && pnpm db:rls && pnpm db:seed-regions` → succeeds against a fresh Neon DB; `regions` table contains 10 active rows
- [ ] Sign up via Clerk → `users` row exists in DB with default `timezone='UTC'`, `daily_goal_minutes=10`, `onboarding_complete=false`
- [ ] Onboarding flow → `tenants` (status='active'), `tenant_members` (role=owner), `tenant_settings`, and `subscriptions` (plan=free, scoped to owner's user_id) rows all created
- [ ] Visit `<slug>.localhost:3000/dashboard` → loads
- [ ] Visit another slug you don't belong to → redirect to `/onboarding`
- [ ] Invite a teammate → row in `invitations`, console logs invite email, 7-day expiry set
- [ ] Accept invite as that user → `tenant_members` row added, `accepted_at` set
- [ ] Start Pro trial as Owner → Stripe Checkout → webhook upserts `subscriptions` row scoped by `(tenant_id, user_id)`
- [ ] Have a *second* user start their own trial in the same workspace → second `subscriptions` row created (owner's row unaffected) — confirms user-scoped billing
- [ ] Admin user can reach `/admin`, non-admin gets redirected
- [ ] `/admin/tenants/[id]` shows per-user subscription list (not a single subscription card)
- [ ] Replay the same Stripe webhook id → returns `{ duplicate: true }` (idempotency)

---

## Migration rollback procedure

1. Identify the failing migration in `drizzle/migrations/`.
2. Roll back manually:
   ```bash
   psql "$DATABASE_URL_UNPOOLED" < drizzle/migrations/<bad>.down.sql
   ```
   Drizzle doesn't auto-generate down migrations — if you don't have one, restore from Neon's Point-in-Time Recovery (available on paid tiers).
3. Delete the bad migration file from `drizzle/migrations/`.
4. Fix the schema in `lib/db/schema.ts`.
5. Re-generate: `pnpm db:generate && pnpm db:migrate && pnpm db:rls`.

---

## Definition of done (per feature)

Before merging any change:

- [ ] Zod-validated input on every external boundary (form, webhook, URL param)
- [ ] `auth()` called in every sensitive server action (don't trust the layout)
- [ ] Tenant-scoped queries wrapped in `withTenant()`
- [ ] No business logic inside webhook routes
- [ ] Idempotency guard on background jobs (`*_sent_at` column or `processed_*_events` table)
- [ ] `pnpm typecheck` and `pnpm lint` pass
- [ ] Sentry captures the failure path (no swallowed errors)
- [ ] If a plan check is involved: plan read fresh from DB, not from session

---

## License

Use freely. No warranty.
