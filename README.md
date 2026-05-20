# Wilderness Intelligence

A B2C spaced-repetition flash-cards SaaS that teaches users to identify plants, animals, terrain, weather, and field skills for the North American wilderness region they spend time in. Built on a reusable multi-tenant SaaS engine (see `saas-boilerplate/`).

> **Stack**: Next.js 15 · TypeScript strict · Clerk · Neon Postgres + RLS · Drizzle ORM · Stripe · Inngest · Resend · Sentry · Tailwind v4 · Vercel
>
> **Repo layout**: the full app lives at `/saas-boilerplate/`. Engine docs → `saas-boilerplate/README.md`. Product spec → this file.

---

## 1. Product summary
A flash-cards app powered by the open-source [FSRS](https://github.com/open-spaced-repetition/ts-fsrs) algorithm. Users pick one or more North American wilderness regions, the app serves them region-relevant decks, and tracks daily streaks. Free tier converts to **Pro $4.99/mo** or **Premium $9.99/mo** via a 14-day Pro trial.

## 2. Who it's for
- **Primary**: weekend hikers, hunters, anglers, backpackers, naturalists who want to deepen their field knowledge.
- **Secondary**: outdoor educators, scout leaders, guide-school students.
- **B2B (post-MVP)**: outdoor brands, guide services, parks/conservation orgs that white-label the platform. The multi-tenant infra is already in place; B2B onboarding UX is a GTM-roadmap item, not a build-roadmap item.

## 3. Headline experience (the loop)
1. **Onboard**: sign in → pick your region(s) → set a daily goal in minutes.
2. **Home**: today's recommended cards (due reviews + new), streak count, recent decks.
3. **Study**: card front → flip → self-rate (`Again` / `Hard` / `Good` / `Easy`) → FSRS schedules the next interval → server records the rating + bumps streak.
4. **Library**: browse all decks visible to your region(s) + plan tier.
5. **Progress**: per-region mastery, retention curve, streak calendar.
6. **Profile / Billing**: trial state, plan, region capacity.

## 4. Plans (locked, Phase 1A)
| | **Free** | **Pro $4.99/mo** | **Premium $9.99/mo** |
|---|---|---|---|
| Daily card limit | **20** | unlimited | unlimited |
| Active regions | **1** | unlimited | unlimited |
| Decks visible | 3 | unlimited | unlimited |
| Audio cards | — | — | ✓ |
| Advanced progress / retention curves | — | ✓ | ✓ |
| AI card generation | — | — | ✓ |
| Priority support | — | — | ✓ |
| 14-day Pro trial | new sign-ups auto-enrolled in a Pro trial; downgrades to Free on lapse, retains read-only access to previously-unlocked decks |

Plans live in `saas-boilerplate/lib/config/billing.ts`. Lapsed subscriptions (`past_due` / `unpaid` / `incomplete_expired`) are treated as Free for all access checks.

## 5. Content architecture — hybrid (reference-by-default, clone-on-edit)
The platform ships a canonical library in `global_decks` / `global_cards`. Every tenant reads it for free. The first time a tenant admin **edits** a global deck or card (or **authors** a net-new one), a `tenant_decks` / `tenant_cards` row is created with `global_*_id` lineage and an `overridden_fields` array. Non-overridden fields keep inheriting fresh values from the global parent at read time. A platform-side edit bumps `global_*.version` and dispatches an Inngest event so every fork's `source_version` reflects how stale it is.

**Why this model**: globals stay canonical (one source of truth for recall propagation, search, analytics); tenants only pay storage cost when they actually customize a row; lineage is preserved so study state can follow the upstream card through a fork. Code lives at `saas-boilerplate/lib/services/contentService.ts`.

## 6. Region system
North America is divided into 10 wilderness regions: Pacific Northwest, Rocky Mountains, Sierra Nevada, Desert Southwest, Great Basin, Appalachians, Great Lakes & Northwoods, Canadian Boreal, Atlantic & Gulf Coastal Plains, Subtropical Florida. The map is a hand-drawn SVG (Phase 7 art). Each region carries an accent color + bounding box.

Users select 1–N regions (Free capped at 1; paid unlimited). Exactly one is `is_primary` — DB-enforced via partial unique index. Tenants can restrict the visible region set via `tenant_settings.enabled_region_ids` (empty array = all 10).

## 7. Study engine — FSRS *(Phase 4)*
- Open-source FSRS algorithm replaces SM-2 (better retention curves, fewer parameters).
- Per-user, per-card state in `user_card_state`: `due_date`, `stability`, `difficulty`, `last_review`, `reviews`, `lapses`, optimistic-locking `version` column.
- `study_session` table: one row per session, capped at the daily limit for Free users (20 cards). Sessions are append-only; ratings stream into `user_card_state` via optimistic CAS.
- Streak service: nightly Inngest cron reconciles `users.streak_count` and `users.last_study_date` using the user's `timezone` column (no naive UTC math).

## 8. Recommendation engine *(Phase 5)*
Rule-based scoring, **NOT** ML:
- Due reviews first (FSRS overdue ratio).
- Mix in new cards capped by daily goal.
- Boost primary region; weight secondary regions lower.
- 5-minute server-side cache per `(tenant_id, user_id)` to keep dashboard fast.

## 9. Tenant Admin CMS *(Phase 6)*
- Deck list with origin badge (`Global` / `Forked from global` / `Tenant-original`).
- Card editor (front/back markdown, image, audio URL, hints, payload, card type).
- Region toggle and access-tier picker per deck.
- "X fields diverged from global" diff badge on forks.
- Region whitelist editor → writes `tenant_settings.enabled_region_ids`.

## 10. Customer frontend *(Phase 7)*
**Design system — "Field Journal"**: parchment paper background, forest-green accents, hand-lettered display font, slate-gray serif body. Custom SVG map of NA regions. Card flip uses CSS 3D transform + light shadow. No emoji icons (use lucide-react / FontAwesome).

**Screens**: onboarding (region picker + daily-goal slider) → home (today's queue + streak + recent decks) → study (card flip + 4-button rate) → library (deck grid by region) → progress (calendar + per-region mastery) → profile/billing.

## 11. Monetization *(Phase 8)*
- 14-day Pro trial auto-enrolled on sign-up (Stripe `trial_period_days`).
- Day-11 reminder email via Inngest (already shipped at engine level).
- Paywalls: locked decks (above tier) show "Upgrade to unlock" CTA; soft paywall at 20-card limit with "Continue with Pro" inline CTA.
- Promo codes via Stripe Coupons; admin can attach to checkout URL.
- Resubscribe UX preserves `subscriptions.previously_unlocked_deck_ids` so churned users land back in their old library.

## 12. Retention emails *(Phase 9)*
- Streak warning (24h before break) — Inngest cron, idempotent via per-day `*_sent_at`.
- Weekly summary (Monday 9am local) — cards reviewed, streak, top region.
- Trial-ending reminder (already shipped — engine-level).
- Per-type unsubscribe via `users.email_unsubscribed_types` jsonb.

## 13. Build status — 9-phase plan

| Phase | Scope | Status | Engine release |
|---|---|---|---|
| **0** | Engine: auth, RLS, tenancy, jobs, billing infra, admin UI, white-label config | ✅ Shipped | v1.0–v1.4 |
| **1** | User-scoped billing refactor, plan rename, `tenant_settings`, plan limits redesigned for B2C | ✅ Shipped | v1.5 |
| **2** | Region system: `regions` global + `user_regions` RLS, plan-tier capacity, seed | ✅ Shipped | v1.6 |
| **3** | Content schema: hybrid global/tenant decks + cards, clone-on-edit, recall pipeline hooks | ✅ Shipped | v1.7 |
| **4** | Study engine: FSRS, `user_card_state`, `study_session`, daily limit, streak cron | ⏭ **Next** | — |
| **5** | Recommendation engine: rule-based scoring + 5-min cache | ⏳ Pending | — |
| **6** | Tenant Admin CMS: deck/card editor, region toggles, access-tier picker | ⏳ Pending | — |
| **7** | Customer frontend: Field Journal design system + 6 screens | ⏳ Pending | — |
| **8** | Monetization wire-up: trial, paywalls, promo codes | ⏳ Pending | — |
| **9** | Retention emails: streak warnings, weekly summary, per-type unsubscribe | ⏳ Pending | — |

## 14. Quality gates (every phase)
- `pnpm typecheck` → 0 errors
- `pnpm lint` → 0 errors / 0 warnings
- Every mutation goes through `lib/services/*` (no inline DB in route handlers).
- Every tenant-scoped query runs through `withTenant()` (RLS enforced at the Postgres layer).
- README + CHANGELOG updated in the same commit as the feature.

## 15. Architectural decisions (locked)
- **Billing model**: tenant = scope/billing-container, user = entitlement-holder. Subscriptions `(tenant_id, user_id)` unique.
- **Phase 1A UX**: single app, no subdomain UI, one auto-seeded default tenant. Multi-tenant infra intact for B2B.
- **Map**: custom hand-drawn SVG of NA regions. NOT Mapbox/Leaflet/Google Maps.
- **Audio cards**: Premium tier only, shipped in Phase 4 (badge as "Coming soon" until then).
- **No XP, no badges** — streaks are the only retention mechanic (per blueprint).
- **Content authoring**: tenant admins author/customize via the CMS in Phase 6. Pre-Phase-6, content is seeded via `pnpm db:seed-content`.

---

## Getting started
The Next.js app lives at `/saas-boilerplate/`. See `saas-boilerplate/README.md` for engine-level setup (Clerk, Stripe, Neon, Inngest, Sentry, env vars, RLS, dev workflow).

```bash
cd saas-boilerplate
pnpm install
# fill .env.local from .env.example
pnpm db:generate && pnpm db:migrate && pnpm db:rls
pnpm db:seed-regions && pnpm db:seed-content
pnpm dev
```

## Repo map
```
/                              ← THIS README (product spec)
├── saas-boilerplate/          ← Next.js app
│   ├── README.md              ← engine docs (auth, RLS, billing, jobs, modules)
│   ├── CHANGELOG.md           ← per-version release notes
│   ├── app/                   ← UI + thin actions + webhooks
│   ├── lib/
│   │   ├── config/            ← white-label core (app, billing, features)
│   │   ├── services/          ← business logic (tenant, user, billing, region, content)
│   │   ├── db/                ← schema, drizzle client, withTenant
│   │   ├── jobs/              ← Inngest functions
│   │   ├── audit/, auth/, email/, billing/
│   ├── drizzle/
│   │   ├── migrations/        ← generated SQL
│   │   └── rls.sql            ← Row-Level Security policies
│   └── scripts/
│       ├── apply-rls.ts
│       ├── seed-regions.ts
│       └── seed-content.ts
└── memory/                    ← PRD + supporting docs
```

## License
Proprietary. All rights reserved.
