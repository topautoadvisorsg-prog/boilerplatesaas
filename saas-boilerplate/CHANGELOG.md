# Changelog

All notable changes to the SaaS boilerplate are documented here.
This project uses [Semantic Versioning](https://semver.org/).

## [1.8.0] — 2026-02-XX — Phase 4: Study engine (FSRS) + streak service

### Added — Dependency
- `ts-fsrs@^5.4.0` — open-source FSRS scheduler. Wrapped in `lib/study/fsrs.ts` so the algorithm is swappable without touching the service or the DB.

### Added — Schema
- New enums: `fsrs_state` (new/learning/review/relearning), `fsrs_rating` (again/hard/good/easy).
- `user_card_state` (RLS): per-user, per-card FSRS state. Carries `state`, `due`, `stability`, `difficulty`, `elapsed_days`, `scheduled_days`, `learning_steps`, `reps`, `lapses`, `last_review`, plus a `version` column for optimistic locking. `card_ref` is the resolved card id (global OR tenant fork) at review time; `global_card_id` is always populated when there is upstream lineage so study state survives a tenant fork being created mid-stream. Unique on `(tenant_id, user_id, card_ref)`; indexed on `(tenant_id, user_id, due)` for the "what's due now?" lookup.
- `study_session` (RLS): one row per session, with `started_at`, `ended_at`, `cards_reviewed`, `cards_correct`, per-rating tallies in a `ratings` jsonb. Partial index on `(tenant_id, user_id) WHERE ended_at IS NULL` makes the "resume my active session" lookup O(1).
- `study_review` (RLS): append-only log of every rating — `rating`, `prev_state`, `next_state`, `elapsed_ms`, `reviewed_at`, FK to `studySession` + `userCardState`. Drives the daily-cap aggregate, streak reconciliation, and any future analytics.

### Added — RLS
- `ucs_tenant_isolation`, `ss_tenant_isolation`, `sr_tenant_isolation` policies in `drizzle/rls.sql`.

### Added — Study engine (`lib/study/` + `lib/services/studyService.ts`)
- `lib/study/fsrs.ts` — pure-function wrapper: `emptyState(now)`, `rate(current, rating, now)`. Type-safe `Grade` mapping, public `ReviewRating` / `ReviewState` tokens. No DB, no I/O — unit-testable.
- `studyService.startSession(ctx)` — opens a session or resumes the active one. Sets `region_id` from the user's primary region.
- `studyService.endSession(ctx, sessionId)` — idempotent close.
- `studyService.getNextCardForDeck(ctx, deckId)` — due reviews first (oldest first), then unseen cards by `display_order`. Returns the resolved card + current persisted state + `daily_usage` summary. Throws `DailyLimitReachedError` if the user has hit the Free 20-card cap.
- `studyService.rateCard(ctx, { sessionId, cardId, rating, elapsedMs })` — FSRS schedule → optimistic-CAS update of `user_card_state` (single retry on conflict) → append `study_review` → bump session tally via `jsonb_set`. Throws `DailyLimitReachedError`, `NoActiveSessionError`, `StudyConcurrencyError`.
- `studyService.getDailyUsage(ctx)` — `{ reviewedToday, limit, remaining, capped }`.

### Added — Streak service (`lib/services/streakService.ts`)
- `reconcileStreak(userId)` — uses `Intl.DateTimeFormat` with the user's `users.timezone` (IANA tz) to compute "today" and "yesterday" in local time, then bumps / preserves / resets `users.streak_count` accordingly. Audits `STREAK_INCREMENTED` / `STREAK_BROKEN`.
- `listUsersNeedingReconcile()` — returns user ids with a non-zero streak OR a review in the last 36 hours (covers every IANA tz offset).

### Added — Inngest
- New event types in `lib/jobs/client.ts`: `study/streak.cron`, `study/streak.reconcile`.
- New functions in `lib/jobs/functions.ts`:
  - `scheduleStreakReconcile` (cron `0 4 * * *` UTC, concurrency 1) — fans out one `study/streak.reconcile` event per active user.
  - `runStreakReconcile` (event-triggered, concurrency 10, retries 3) — calls `streakService.reconcileStreak(userId)`.

### Added — Audit actions
- `STUDY_SESSION_STARTED`, `STUDY_SESSION_ENDED`, `STUDY_CARD_RATED`, `STUDY_DAILY_LIMIT_HIT`, `STREAK_INCREMENTED`, `STREAK_BROKEN`.

### Added — Tests
- `tests/fsrs.test.ts` — 10 pure-function assertions on the FSRS wrapper (empty state shape, Good/Again/Easy ratings, scheduling monotonicity).
- `tests/streak.test.ts` — 6 assertions on the timezone day-boundary contract (UTC vs LA vs Tokyo, year roll-over edge cases).
- Wired as `pnpm test:unit`. Runs in <1s, no DB needed. Both suites pass on every commit.

### Notes — Architectural decisions
- **Optimistic locking, not pessimistic**: every rating writes `WHERE version = $old`; conflicts retry once then surface `StudyConcurrencyError`. Avoids row locks on the hot path.
- **Daily cap reads at request time** — no cache. Cheap (`COUNT(*) WHERE reviewed_at >= today_start`), and the right answer is always the right answer.
- **Append-only `study_review`** — never updated, never deleted. Doubles as the scheduler's audit trail.
- **Streak math out of the hot path** — every `rateCard` would otherwise need a tz-aware "was yesterday a study day?" check. Deferring to a nightly cron is correct because streaks are a *display* concern, not a *blocking* concern.
- **`card_ref` not a FK** — content can live in either `global_cards` or `tenant_cards`. Enforcing a FK across both is awkward; we store the resolved id and validate it via `findCardLineage()` on every rating, which also pulls `globalCardId` for lineage.

## [1.7.0] — 2026-02-XX — Phase 3: Content schema + recall pipeline

### Added — Schema (hybrid content model)
- New enums: `card_type` (basic/image/audio/cloze), `access_tier` (free/pro/premium), `content_source` (global/tenant).
- `global_decks` (GLOBAL, no RLS): `slug` unique, `name`, `description`, `region_id` FK, `access_tier`, `tags` jsonb, `cover_image_url`, `display_order`, `version` (bumped on every published edit — drives recall pipeline), `is_active`.
- `global_cards` (GLOBAL, no RLS): `global_deck_id` FK (cascade), `card_type`, `front`, `back`, `image_url`, `audio_url`, `hints` jsonb, `payload` jsonb (cloze/quiz variants), `display_order`, `version`, `is_active`.
- `tenant_decks` (RLS-scoped): `tenant_id`, `global_deck_id` nullable (NULL = tenant-original, NOT NULL = fork of a global deck), `slug` unique per tenant, `overridden_fields` jsonb (tracks which columns have diverged from the global parent), `is_published`, `is_archived`, `source_version` (snapshot of `global_decks.version` at fork time). Partial unique index on `(tenant_id, global_deck_id) WHERE global_deck_id IS NOT NULL` prevents duplicate forks.
- `tenant_cards` (RLS-scoped): `tenant_id`, `tenant_deck_id` FK, `global_card_id` nullable, same content columns as `global_cards`, `overridden_fields`, `source_version`. Partial unique on `(tenant_id, global_card_id) WHERE global_card_id IS NOT NULL`.

### Added — RLS
- `tenant_decks` policy `td_tenant_isolation` and `tenant_cards` policy `tc_tenant_isolation` (USING + WITH CHECK on `tenant_id = app_current_tenant_id()`). Global tables intentionally NOT under RLS.

### Added — Service layer (`lib/services/contentService.ts`)
- **Reads** (hybrid resolution — UNIONs globals + forks, applies field-level inheritance for non-overridden columns):
  - `listDecksForUser(ctx)` — user-visible decks across globals + tenant forks/originals, filtered by visible regions + plan tier
  - `getDeckForUser(ctx, deckId)` — resolves a single deck (tenant first, then global) with access checks
  - `listCardsForDeck(ctx, deckId)` — cards within a deck, UNIONing inherited globals + tenant overrides
- **Writes** (clone-on-edit):
  - `forkGlobalDeck(ctx, globalDeckId)` — idempotent shell fork; cards stay inherited until edited
  - `updateDeck(ctx, deckId, patch)` — lazy-forks if the caller hands us a global id; appends touched fields to `overridden_fields`
  - `updateCard(ctx, cardId, patch)` — same, but forks BOTH the parent deck and the card on first edit
  - `createTenantDeck(ctx, input)` — tenant-original deck (no global parent)
  - `createTenantCard(ctx, input)` — tenant-original card under a tenant deck
- **Platform-admin writes** (no tenant context):
  - `updateGlobalDeck(globalDeckId, patch, actor)` — bumps `version`, dispatches `content/global.deck-changed` Inngest event
  - `updateGlobalCard(globalCardId, patch, actor)` — same for cards
- Role gate: only `owner`/`admin` may mutate content; `member` is read-only.
- Plan gate: `TIER_RANK` (free=0, pro=1, premium=2). Decks above the caller's tier are filtered out of reads and throw `ContentAccessError` on direct lookup. Lapsed subscriptions are downgraded to `free` for access checks.

### Added — Inngest event types + functions (`lib/jobs/`)
- New event types: `content/global.deck-changed` and `content/global.card-changed` (both carry `{ id, version }`).
- New functions: `propagateGlobalDeckChange` and `propagateGlobalCardChange` — bulk-update `source_version` on every fork so admins can see how stale their fork is, and act as the hook point for future cache invalidation / search-index reindex / recommendation recompute.

### Added — Audit actions
- `CONTENT_DECK_FORKED`, `CONTENT_DECK_CREATED`, `CONTENT_DECK_UPDATED`, `CONTENT_DECK_ARCHIVED`, `CONTENT_CARD_FORKED`, `CONTENT_CARD_CREATED`, `CONTENT_CARD_UPDATED`, `CONTENT_CARD_ARCHIVED`, `CONTENT_GLOBAL_DECK_UPDATED`, `CONTENT_GLOBAL_CARD_UPDATED`.

### Added — Seed
- `scripts/seed-content.ts` — idempotent (decks upsert by `slug`; cards keyed by `payload.key` + `global_deck_id`). Seeds 3 starter decks: PNW Conifers (free), Rocky Mountain Mammals (free), Desert Southwest Flora (pro). Wired as `pnpm db:seed-content`.

### Notes — Architectural decisions
- **Hybrid model (reference-by-default, clone-on-edit)** chosen over "always-clone" or "reference-only". Globals stay canonical; tenants only pay storage cost when they actually customize a row. Non-overridden fields keep inheriting upstream updates at read time.
- **Lineage preserved** via `global_deck_id` / `global_card_id` on forks, so Phase 4 study state can follow the upstream link if a fork is created after a user has been studying the global card.
- **Field-level inheritance** is resolved in the application layer (not via Postgres views) so the rules can evolve without a migration.

## [1.6.0] — 2026-01-XX — Phase 2: Region system

### Added — Schema
- `regions` table (GLOBAL catalog — no RLS, all tenants read from it): `slug`, `name`, `description`, `parent_region_id` (self-FK for hierarchy), `bounding_box` jsonb, `accent_color`, `display_order`, `is_active`. Active+order index, slug unique.
- `user_regions` table (RLS-scoped per tenant): `tenant_id`, `user_id`, `region_id`, `is_primary`. Composite unique on `(tenant_id, user_id, region_id)`. **Partial unique index on `(tenant_id, user_id) WHERE is_primary = true`** — DB enforces "exactly one primary region per user".

### Added — RLS
- `user_regions` enabled with policy `ur_tenant_isolation` (USING + WITH CHECK on `tenant_id = app_current_tenant_id()`). `regions` intentionally NOT under RLS — it's a global catalog; tenants restrict the visible subset via application logic.

### Added — Service layer (`lib/services/regionService.ts`)
- `listAvailableRegions(tenantId)` — global catalog filtered by `tenant_settings.enabled_region_ids` (empty array = all)
- `getUserRegions(ctx)` — user's selected regions, joined with the catalog
- `setUserRegions(ctx, { regionIds, primaryRegionId? })` — atomic replace; validates against tenant's enabled set, enforces `PlanLimits.maxActiveRegions` (Free = 1), promotes one primary
- `setPrimaryRegion(ctx, regionId)` — swap primary among already-selected regions
- `removeUserRegion(ctx, regionId)` — drop one; refuses if it would leave the user with zero; auto-promotes a new primary if needed
- `getPrimaryRegion(ctx)` — convenience read used by product code
- `RegionLimitError` exported for UI gating

### Added — Audit actions
- `REGION_SELECTED`, `REGION_REMOVED`, `REGION_PRIMARY_CHANGED` in `AUDIT_ACTIONS`

### Added — Seed script
- `scripts/seed-regions.ts` — idempotent (`ON CONFLICT (slug) DO UPDATE`) — seeds 10 NA wilderness regions: Pacific Northwest, Rocky Mountains, Sierra Nevada, Desert Southwest, Great Basin, Appalachians, Great Lakes & Northwoods, Canadian Boreal, Atlantic & Gulf Coastal Plains, Subtropical Florida. Each carries a bounding box + accent color for the SVG map.
- Run via `pnpm db:seed-regions`. Added to `package.json` scripts.

### Notes
- Plan-tier filter: free users are capped at 1 active region. Pro & Premium are unlimited. Lapsed (`past_due`/`unpaid`/`incomplete_expired`) users are treated as free for region capacity purposes.
- Regions intentionally have no tenant_id — a single source of truth makes recall propagation (Phase 3) and cross-tenant analytics straightforward.

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
