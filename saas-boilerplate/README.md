# SaaS Boilerplate — v1.2

Multi-tenant SaaS foundation. Drop in product features on top of a fully-wired auth, billing, team, jobs, and observability stack.

> **Stack**: Next.js 15 (App Router) · TypeScript strict · Clerk · Neon Postgres · Drizzle ORM · Stripe · Inngest · Resend (stubbed) · Sentry · Tailwind v4 · Vercel

## Why this exists

Most SaaS projects spend the first 2–4 weeks rebuilding the same boring scaffolding: auth, organizations, subdomain routing, RBAC, billing, webhooks, idempotency, background jobs, audit logs. This boilerplate ships all of that — opinionated, type-safe, isolated per tenant at the DB layer — so you can start on the actual product on day one.

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
| `STRIPE_PRO_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID` | Stripe | Products → create two recurring prices ($49, $199). Copy the `price_...` IDs. |
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

## Project structure

```
app/
  (auth)/sign-in, sign-up        ← Clerk hosted pages
  onboarding/                    ← create workspace (thin action → tenantService)
  (tenant)/                      ← tenant-scoped UI (dashboard, team, billing, settings)
  admin/                         ← internal admin (gated by ADMIN_USER_IDS + feature flag)
  accept-invite/[token]/         ← join-by-invite (thin action → inviteService)
  api/
    webhooks/clerk, stripe       ← signature-verified, delegate to services
    inngest/                     ← Inngest function endpoint

lib/
  config/                        ← WHITE-LABEL CORE — override per deployment
    app.ts                       ← name, description, branding, Inngest app id
    billing.ts                   ← plan catalog (Free / Pro / Enterprise)
    features.ts                  ← runtime flags (adminEnabled, billingEnabled, ...)

  services/                      ← BUSINESS LOGIC LAYER — all mutations live here
    tenantService.ts             ← createTenant, upsertTenantFromClerk
    userService.ts               ← upsert/delete users, membership lifecycle
    inviteService.ts             ← invites + accept + remove member
    billingService.ts            ← Stripe checkout + portal
    subscriptionService.ts       ← Stripe webhook handlers

  db/                            ← schema, drizzle client, withTenant() helper
  auth/                          ← current user, admin gating
  billing/plans.ts               ← back-compat re-export of config/billing
  billing/stripe.ts              ← lazy Stripe client
  email/                         ← transport (Resend or stub) + templates
  jobs/                          ← Inngest functions
  audit/                         ← action enum + writer
  tenant.ts                      ← slug validation + reserved words
  rate-limit.ts                  ← invite rate limiter (Postgres-backed)
  env.ts                         ← Zod-validated env, fails fast at boot

drizzle/
  migrations/                    ← generated SQL
  rls.sql                        ← Row-Level Security policies

scripts/apply-rls.ts             ← runs drizzle/rls.sql
middleware.ts                    ← Clerk + subdomain routing
instrumentation.ts               ← Sentry init + env validation at boot
sentry.{client,server,edge}.config.ts
```

### Layer rules
1. **`app/`** is pure interface — pages, server actions (thin wrappers), webhook routes (signature-verify + delegate).
2. **`lib/services/`** holds all business logic. Anything that mutates DB state or talks to an external API lives here.
3. **`lib/config/`** is the only place product identity exists. Forking a new product = editing these three files + setting env vars.
4. **`lib/db/`** never gets touched by `app/` code. Services own the data layer.

---

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
- [ ] `pnpm db:migrate && pnpm db:rls` → succeeds against a fresh Neon DB
- [ ] Sign up via Clerk → `users` row exists in DB
- [ ] Onboarding flow → `tenants`, `tenant_members` (role=owner), `subscriptions` (plan=free) rows
- [ ] Visit `<slug>.localhost:3000/dashboard` → loads
- [ ] Visit another slug you don't belong to → redirect to `/onboarding`
- [ ] Invite a teammate → row in `invitations`, console logs invite email, 7-day expiry set
- [ ] Accept invite as that user → `tenant_members` row added, `accepted_at` set
- [ ] Start Pro trial → Stripe Checkout → webhook updates `subscriptions` row
- [ ] Admin user can reach `/admin`, non-admin gets redirected
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
