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

## Quality gates after Phase 2
- `tsc --noEmit`: **0 errors**
- `eslint`: **0 errors, 0 warnings**
- Branding grep: clean

## Phase plan (remaining)
- **Phase 3** — Content schema + global→tenant clone pipeline + recall propagation — 2-3d
- **Phase 4** — Study engine (FSRS, UserCardState, StudySession, daily limit, streak service) — 3-4d
- **Phase 5** — Recommendation engine — 1d
- **Phase 6** — Tenant Admin CMS (deck/card editor, region toggles, access tiers) — 2-3d
- **Phase 7** — Customer-facing frontend (Field Journal design system + onboarding/home/study/library/progress/profile) — 5-7d
- **Phase 8** — Monetization wire-up (paywalls, trial, checkout, promo codes) — 1d
- **Phase 9** — Retention emails (streak warnings, weekly summary, unsubscribe per-type) — 1-2d

## Open items
- Migration strategy from current dev DB: run fresh `pnpm db:generate && pnpm db:migrate && pnpm db:rls`.
- For an existing prod DB with `enterprise` plan rows: manual SQL needed (Postgres enum manipulation). Documented in CHANGELOG v1.5.0.
