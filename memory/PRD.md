# PRD — Wilderness Intelligence (built on SaaS Engine v1.5)

## Original product
> A B2C wilderness-knowledge flash-cards SaaS, multi-tenant-ready under the hood. Phase 1A ships single-app UX. Phase 3 turns on B2B licensing.

## Decisions locked (Phase 1A)
- **Billing model**: tenant = billing/scope container, user = entitlement holder. Subscriptions are `(tenant_id, user_id)`-scoped. Engine refactored in v1.5.0.
- **Phase 1A UX**: single app, no subdomain selection, one auto-seeded default tenant. Multi-tenant infrastructure intact.
- **Map**: custom hand-drawn SVG of NA regions (committed art).
- **Audio cards**: deferred to Phase 2 ("Coming soon" badge in Premium tier).
- **Content**: you supply real content via the Tenant Admin CMS — CMS is Phase 6 scope.
- **No XP / no badges** — streaks only (per blueprint, contradicting UX spec).
- **Plans**: Free / Pro $4.99 / Premium $9.99. 14-day Pro trial. Free = 20 cards/day, 3 decks, 1 active region.

## Build progress
- ✅ **Phase 0** — Engine (auth, RLS, tenancy, jobs, billing infra, admin UI, white-label config)
- ✅ **Phase 1** — Engine adjustments
  - Subscription model refactor → user-scoped
  - `users`, `tenants` schema extensions
  - `tenant_settings` new table
  - Plan rename `enterprise → premium`
  - Plan limits redesigned for B2C product
  - Stripe Customer per-user
  - Webhook handlers updated for `user_id` metadata
  - Admin UI updated for per-user subscriptions
- ✅ **Phase 2** — Region system (this delivery)
  - `regions` global catalog + `user_regions` RLS-scoped (partial unique index for "1 primary per user")
  - `regionService` (list / get / set / set-primary / remove / get-primary) with plan-tier limit enforcement
  - Audit actions: `REGION_SELECTED`, `REGION_PRIMARY_CHANGED`, `REGION_REMOVED`
  - `scripts/seed-regions.ts` idempotent seed of 10 NA wilderness regions + `pnpm db:seed-regions` script
  - `tenant_settings.enabled_region_ids` filter wired in
  - Bugfix: `setUserRegions` now uses `notInArray()` (Drizzle) instead of an unsafe `sql\`region_id NOT IN ${ids}\`` template — prevents single-param mis-binding when removing dropped regions.
- ✅ **Phase 3** — Content schema + recall pipeline (hybrid: reference-by-default, clone-on-edit)
  - 4 new tables: `global_decks`, `global_cards` (global, no RLS) + `tenant_decks`, `tenant_cards` (RLS-scoped, with `global_*_id` lineage)
  - `cardType` / `accessTier` / `contentSource` enums + version columns + `overridden_fields` jsonb + partial unique indexes (fork de-dupe)
  - `contentService` (read: `listDecksForUser` / `getDeckForUser` / `listCardsForDeck`; tenant write: `forkGlobalDeck` / `updateDeck` / `updateCard` / `createTenantDeck` / `createTenantCard`; platform write: `updateGlobalDeck` / `updateGlobalCard`)
  - Plan-tier gating via `TIER_RANK` (free/pro/premium); lapsed subs downgraded to free for access checks
  - Inngest events `content/global.deck-changed` / `content/global.card-changed` + functions `propagateGlobalDeckChange` / `propagateGlobalCardChange` — bump `source_version` on every fork and act as the cache-invalidation hook for Phases 4-5
  - 10 new audit actions for content lifecycle
  - `scripts/seed-content.ts` (3 starter decks: PNW Conifers free / Rocky Mtn Mammals free / Desert SW Flora pro) wired as `pnpm db:seed-content`
- ✅ **Phase 4** — Study engine (FSRS) + tz-aware streaks
  - `ts-fsrs@^5.4.0` installed; wrapped in `lib/study/fsrs.ts` (pure functions, unit-testable, swappable)
  - 3 new tables: `user_card_state` (with optimistic-locking `version` column), `study_session`, `study_review` (append-only); 2 new enums (`fsrs_state`, `fsrs_rating`); RLS policies for all three
  - `studyService` (`startSession` / `endSession` / `getNextCardForDeck` / `rateCard` / `getDailyUsage`); single retry on optimistic CAS conflict; daily-cap enforced via `study_review` aggregate read at request time
  - `streakService.reconcileStreak` uses `Intl.DateTimeFormat` with `users.timezone` (IANA tz) — no naive UTC math
  - Inngest: `scheduleStreakReconcile` (cron `0 4 * * *`) + `runStreakReconcile` event handler
  - 6 new audit actions; 16 pure-function unit tests in `tests/` runnable via `pnpm test:unit`

## Quality gates after Phase 4
- `tsc --noEmit`: **0 errors**
- `eslint`: **0 errors, 0 warnings**
- `pnpm test:unit`: **16 / 16 passed** (10 FSRS + 6 streak helpers)
- Branding grep: clean

## Phase plan (remaining)
- **Phase 5** — Recommendation engine — 1d
- **Phase 6** — Tenant Admin CMS (deck/card editor, region toggles, access tiers) — 2-3d
- **Phase 7** — Customer-facing frontend (Field Journal design system + onboarding/home/study/library/progress/profile) — 5-7d
- **Phase 8** — Monetization wire-up (paywalls, trial, checkout, promo codes) — 1d
- **Phase 9** — Retention emails (streak warnings, weekly summary, unsubscribe per-type) — 1-2d

## Open items
- Migration strategy from current dev DB: run fresh `pnpm db:generate && pnpm db:migrate && pnpm db:rls`.
- For an existing prod DB with `enterprise` plan rows: manual SQL needed (Postgres enum manipulation). Documented in CHANGELOG v1.5.0.
