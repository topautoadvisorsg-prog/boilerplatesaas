# Changelog

All notable changes to the SaaS boilerplate are documented here.
This project uses [Semantic Versioning](https://semver.org/).

## [1.2.0] — 2026-01-XX

Initial public boilerplate cut, implementing the v1.2 spec.

### Added
- Next.js 15 App Router + TypeScript (strict, `noUncheckedIndexedAccess`, zero `any`)
- Clerk authentication (email/password, Google OAuth, magic link via Clerk dashboard)
- Multi-tenant subdomain routing via edge middleware (host header trust boundary at Vercel CDN)
- Neon Postgres + Drizzle ORM with full schema:
  - `users`, `tenants`, `tenant_members`, `subscriptions`, `invitations`, `audit_logs`, `processed_stripe_events`, `invite_rate_limit`
  - v1.2 idempotency fields: `users.welcome_email_sent_at`, `invitations.invite_email_sent_at`, `subscriptions.trial_reminder_sent_at`
- Row-Level Security on `tenant_members`, `subscriptions`, `invitations`, `audit_logs` (`drizzle/rls.sql`, applied via `pnpm db:rls`)
- `withTenant()` helper sets `app.current_tenant_id` per transaction; nesting disallowed
- Stripe billing: Free / Pro ($49) / Enterprise ($199), 14-day Pro trial, Checkout, Billing Portal, atomic-idempotent webhooks
- Inngest background jobs: welcome email, tenant provisioning, invite email, trial-ending reminder, payment-failed handling, scheduled cleanup of `processed_stripe_events`
- Resend transactional email — **stubbed** to console for this boilerplate (swap one function in `lib/email/client.ts` to go live)
- Internal admin dashboard gated by `ADMIN_USER_IDS`, with audit log entries on tenant access
- Team management: invite (rate-limited 10/hr/tenant), accept (cryptographically secure 64-hex token, 7-day expiry), remove, RBAC (owner/admin/member)
- Sentry: client/server/edge configs + Next 15 `onRequestError`
- Zod validation on all form inputs and webhook payloads
- Startup env validation (`lib/env.ts` + `instrumentation.ts`) — boot fails loudly on missing variables
- Reserved-slug list + slug format validator

### Decisions / Rules
- All mutations happen in server actions; API routes exist only for webhooks (Clerk, Stripe, Inngest)
- Plan is **always** read from DB before gated operations; never cached in JWT/cookie/session
- Lapsed subscriptions (`past_due`, `unpaid`, `incomplete_expired`) drop to read-only via `canUseFeature()`
- Webhook signature verification is mandatory (Svix for Clerk, Stripe SDK, Inngest signing key)
- No business logic inside webhook routes — long-running side effects dispatched to Inngest
- Email sending is never inline in a request; always via an Inngest job

### Known follow-ups
- Wire Resend in `lib/email/client.ts` (replace `sendEmail` stub)
- Add Sentry alert rules + on-call rotation
- Build product-specific features on top (flash cards module, etc.)
