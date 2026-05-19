# Changelog

All notable changes to the SaaS boilerplate are documented here.
This project uses [Semantic Versioning](https://semver.org/).

## [1.5.0] — 2026-01-XX — Phase 1: Wilderness engine adjustments

### Changed — Billing model: tenant-scoped → user-scoped (entitlement)
- `subscriptions` table refactored from `(tenant_id)` unique → `(tenant_id, user_id)` unique. Each user can have their own subscription within a tenant.
- Stripe Customer now created **per-user** (not per-tenant).
- Stripe webhook metadata now requires both `tenant_id` AND `user_id`; events missing either are dropped (or recovered via `stripe_subscription_id` lookup for cancel events).
- `subscriptionService` API: `applySubscriptionUpsert`, `markSubscriptionCanceled`, `markPastDueByStripeId` all take `userId`. New helpers: `getUserSubscription`, `ensureFreeSubscription`.
- `billingService.startCheckout` now resolves `userId` from `TenantContext`; `ensureCustomer` is per-user.
- `tenantService.createTenant` seeds the owner's free subscription row at provisioning time.
- Admin tenant detail page now shows **per-user subscription list** instead of a single subscription card.
- Admin tenants list dropped plan/status columns (ambiguous at tenant level); shows member count instead.

### Changed — Plan catalog renamed
- `enterprise` → `premium`. Pricing: Pro $4.99/mo, Premium $9.99/mo. Limits redesigned for B2C product (`maxDecks`, `dailyCardLimit`, `maxActiveRegions`, `hasAudioCards`, `hasAdvancedProgress`, `hasAiCardGeneration`).
- Env var `STRIPE_ENTERPRISE_PRICE_ID` renamed → `STRIPE_PREMIUM_PRICE_ID`.

### Added — Schema extensions
- `users` table: `timezone`, `daily_goal_minutes`, `onboarding_complete`, `onboarding_step`, `streak_count`, `last_study_date`, `email_unsubscribed`, `email_unsubscribed_types`, `is_active`.
- `tenants` table: `subdomain`, `custom_domain` (unique), `status` enum (`provisioning`/`active`/`inactive`/`suspended`/`failed`/`deleted`), `primary_color`, `secondary_color`, `font_family`, `support_email`.
- `tenant_settings` table: `feature_flags`, `subscription_tiers`, `trial_days`, `grace_period_days`, `storage_quota_mb`, `session_card_cap`, `enabled_region_ids`. Seeded by `tenantService.createTenant`.
- `subscriptions` table: `grace_period_end`, `previously_unlocked_deck_ids` (for re-subscribe UX after cancel).

### Notes
- No data migration auto-generated yet. Run `pnpm db:generate && pnpm db:migrate && pnpm db:rls` against a fresh DB. For an existing DB, the rename of `enterprise → premium` requires a manual `ALTER TYPE plan ADD VALUE 'premium'; UPDATE subscriptions SET plan='premium' WHERE plan='enterprise'; ALTER TYPE plan DROP VALUE 'enterprise'` (Postgres enum manipulation).
- `provisionTenant` Inngest job converted to no-op stub; future async provisioning (content cloning, analytics bootstrap) hangs off this event.

## [1.4.0] — 2026-01-XX — Admin UI production polish

### Added — UI primitive library (`components/ui/`)
- `Button` (5 variants × 3 sizes), `Card` (header/title/description/content/footer), `Badge` (6 tones, optional dot), `Input`, `Table` (Th/Td/Tr/THead/TBody), `Avatar` (initials with stable color hash + image fallback), `EmptyState`, `Skeleton`, `PageHeader`, `Breadcrumb`
- All accessible, keyboard-focusable, dark-mode-aware via semantic tokens

### Added — Admin-specific components (`components/admin/`)
- `AdminSidebar` — persistent left nav with active-route highlighting and "Back to app" link
- `StatCard` — KPI tile with icon, hint, and optional trend indicator
- `StatusBadge` / `PlanBadge` — Stripe subscription status + plan with tone mapping (trialing→info, past_due→warning, etc.)
- `DataTable` — searchable, filterable client component with empty states, clickable rows, search-count summary

### Added — Design system (`app/globals.css`)
- Semantic color tokens (`background`, `foreground`, `card`, `muted`, `border`, `border-strong`, `primary`, `accent`, `success`, `warning`, `danger`, `info`) — all with paired `*-foreground` and soft variants
- Subtle scrollbar styling, selection color, shimmer keyframe for skeletons

### Added — Date/time formatting (`lib/format.ts`)
- `formatRelativeTime` ("just now", "5m ago", "Jan 12"), `formatDate`, `formatDateTime`

### Changed — Admin pages rewritten
- `/admin` (Overview) — 4 KPI cards (Tenants, Users, Paid subs with trial/past-due breakdown, MRR estimate from Pro+Enterprise list price); Recent Tenants list + Recent Users list with avatars
- `/admin/tenants` — Searchable DataTable with name/slug, plan badge, status badge, relative date; clickable rows
- `/admin/tenants/[id]` — Breadcrumb + sectioned cards (Workspace identity, Subscription detail, Members with role badges, Recent Activity audit log feed); no JSON dumps
- `/admin/users` — Searchable DataTable with avatar, ID, relative join date

### Added — Loading & error states
- `app/admin/loading.tsx`, `app/admin/tenants/loading.tsx`, `app/admin/users/loading.tsx` — Skeleton-based placeholders matching final layout
- `app/admin/error.tsx` — Friendly error boundary with retry button

## [1.3.0] — 2026-01-XX — White-label hardening

### Added — Configuration layer (`lib/config/`)
- `lib/config/app.ts` — single source of truth for app identity (name, description, marketing copy, Inngest app id, support email). All values overridable via `NEXT_PUBLIC_APP_*` env vars.
- `lib/config/billing.ts` — plan catalog moved here from `lib/billing/plans.ts` (which is now a back-compat re-export). Override per deployment to customize plan names, prices, limits.
- `lib/config/features.ts` — runtime feature flags: `adminEnabled`, `billingEnabled`, `invitesEnabled`, `emailEnabled`. Driven by `FEATURE_*` env vars.

### Added — Services layer (`lib/services/`)
Business logic moved out of server actions and webhook routes into:
- `tenantService` — `createTenant` (atomic Clerk+DB with rollback), `upsertTenantFromClerk`
- `userService` — `upsertUserFromClerk`, `deleteUserByClerkId`, `addMembershipByClerk`, `removeMembershipByClerk` (correctly scoped by `(tenantId, userId)`)
- `inviteService` — `createInvite`, `removeMember`, `acceptInvite`
- `billingService` — `startCheckout`, `openBillingPortal`, internal `ensureCustomer`
- `subscriptionService` — `applySubscriptionUpsert`, `markSubscriptionCanceled`, `markPastDueByStripeId`

Server actions are now thin interface adapters that parse input and delegate. Webhook routes verify signatures, gate idempotency, and delegate. **Zero business logic in `app/` outside of UI.**

### Changed — Identity removed from runtime
- `app/layout.tsx` metadata reads from `appConfig.name` / `.description`
- `app/page.tsx` marketing copy reads from `appConfig.marketing.*`
- `lib/jobs/client.ts` Inngest app id reads from `appConfig.inngestAppId`
- `app/admin/layout.tsx` header label generic ("Admin")
- No file under `app/` or `lib/` references "SaaS Boilerplate" or any product-specific term (grep verified)

### Changed — Feature flags applied
- `/admin/*` returns 404 when `FEATURE_ADMIN_ENABLED=0`
- Billing nav link hidden when `FEATURE_BILLING_ENABLED=0`; `startCheckout` / `openBillingPortal` reject
- Invite UI hidden + `createInvite` rejects when `FEATURE_INVITES_ENABLED=0`
- `lib/email/client.ts` sends via Resend when `FEATURE_EMAIL_ENABLED=1`, otherwise logs to console (Resend SDK lazy-imported only when enabled)

### Verified — Tenant isolation invariants
- Every `app/(tenant)/**` page either calls `resolveTenantForUser()` first or runs inside `withTenant()`
- Every mutation in services that touches tenant-scoped tables wraps in `withTenant()` (rate-limit table is global by design)
- Webhook routes operate at system trust level (no `withTenant`), document writes scoped explicitly by `tenant_id`
- Admin queries are explicitly global (overview aggregates, full tenant/user lists) and audit-logged on per-tenant access

## [1.2.1] — 2026-01-XX

### Fixed
- `app/api/webhooks/clerk/route.ts` — `organizationMembership.deleted` was deleting all members for a tenant due to missing `userId` scope. Now correctly scopes by `(tenantId AND userId)` and guards against missing `organization.id` / `public_user_data.user_id`.
- `app/admin/page.tsx` — removed `{void tenants}{void users}{void subscriptions}` placeholder JSX and the unused schema imports backing them.

### Added
- `scheduleTrialEndingReminders` — daily Inngest cron (`0 9 * * *` UTC) that queries `subscriptions` where `trial_ends_at` is within the next 3 days and `trial_reminder_sent_at IS NULL`, then fan-outs `billing/trial-ending` events. Idempotency continues to be enforced by `trial_reminder_sent_at` inside `trialEndingReminder`.

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
