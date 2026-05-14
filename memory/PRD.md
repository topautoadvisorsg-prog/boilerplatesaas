# PRD — SaaS Boilerplate (v1.2)

## Original problem statement
> Create a boilerplate from the attached blueprint (`saas-boilerplate-spec-v1.2.md.pdf`). Review the blueprint, call out issues, then build. The eventual product on top will be a flash-cards app, but the boilerplate itself is white-label.

## User choices (captured)
- **Stack**: Keep Next.js 15 / Neon Postgres / Clerk as spec'd (delivered as code in `/app/saas-boilerplate/`; not running in Emergent preview).
- **Auth**: Email/password + Google OAuth (both via Clerk).
- **Billing**: Stripe code present, but no test keys wired; placeholder env vars + clear setup docs.
- **Email**: Stubbed (console logger) — README explains the one-function swap to Resend.
- **Sentry**: Included (client, server, edge configs + `onRequestError`).
- **Flash-cards module**: deferred — boilerplate is white-label.

## Architecture
- Next.js 15 App Router, TypeScript strict
- Edge middleware: subdomain → `x-tenant-slug`, Clerk auth
- Postgres (Neon) + Drizzle ORM; `withTenant()` helper + RLS policies on tenant-scoped tables
- Server actions for mutations; API routes for webhooks (Clerk/Stripe/Inngest)
- Inngest background jobs, idempotent via `*_sent_at` columns and `processed_stripe_events`
- Sentry across runtimes

## Implemented (v1.2.0, 2026-01)
- Full Drizzle schema with v1.2 idempotency fields
- `lib/env.ts` (Zod) + `instrumentation.ts` for fail-fast boot
- `withTenant()` + `drizzle/rls.sql` + `scripts/apply-rls.ts`
- Plans matrix (Free / Pro $49 / Enterprise $199) + DB-only plan reads + lapsed-state read-only
- Audit log enum (`AUDIT_ACTIONS`) + writer
- Postgres-backed invite rate limit (10/tenant/hr)
- Email client (stub) + 5 templates
- 6 Inngest functions (welcome, provision, invite, trial-ending, payment-failed, cleanup)
- Middleware (Clerk + subdomain) with proper matcher
- Sentry 3 configs + `onRequestError`
- Webhooks: Clerk (Svix), Stripe (atomic idempotency), Inngest
- Pages: marketing root, sign-in/up, onboarding (Clerk+DB atomic with rollback), tenant dashboard/team/billing/settings, admin (overview/tenants/users/detail), accept-invite
- Server actions: createOrg, invite, removeMember, acceptInvite, startCheckout, openBillingPortal
- README (full setup walkthrough), CHANGELOG, .env.example, .gitignore

## Quality gates
- `tsc --noEmit`: **zero errors**
- `eslint`: **zero errors, zero warnings**
- No `any` types
- All env vars validated at boot

## Backlog / next tasks
- **P0**: User to provision Clerk, Neon, Stripe (test), Inngest, Sentry accounts and fill `.env.local`.
- **P1**: Swap email stub → Resend (one function in `lib/email/client.ts`).
- **P1**: Add E2E smoke tests (Playwright) for the Phase 0 checklist in README.
- **P2**: Build flash-cards product module on top (decks, cards, SM-2 spaced repetition, study stats).
- **P2**: Audit log export endpoint (Enterprise plan gate).
- **P3**: Marketing site (separate repo per spec).

## Notes
- Boilerplate lives in `/app/saas-boilerplate/` (separate folder so the Emergent supervisor's default React+FastAPI scaffolding is undisturbed). Treat that folder as the root of a fresh repo when cloning to a real GitHub/Vercel project.
