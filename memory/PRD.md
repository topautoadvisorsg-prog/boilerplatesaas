# PRD — White-Label SaaS Engine

## Original problem statement
> Create a boilerplate from the v1.2 spec. Eventual product on top will be flash-cards, but the boilerplate itself must be product-agnostic.

## Architecture (v1.3 — hardened)

Three-layer separation:

```
app/          ← interface layer (pages, server actions, webhook routes)
lib/services/ ← business logic (tenant, user, invite, billing, subscription)
lib/config/   ← product identity (app, billing, features) — ONE place to fork
lib/db/       ← schema, withTenant(), Drizzle client
```

### Hard rules enforced
1. `app/` contains no business logic — only request parsing, response shaping, and redirects.
2. `lib/services/` owns every DB mutation and every external-API call.
3. `lib/config/` is the only place product identity exists. Branding, plan catalog, and feature toggles all live here.
4. No file under `app/` or `lib/` references "SaaS Boilerplate" or any product-specific term (grep verified).
5. Every tenant-scoped mutation runs inside `withTenant()`; RLS enforces it at the DB.

## Implemented

### v1.3.0 — White-label hardening (current)
- `lib/config/{app,billing,features}.ts` — identity, plan catalog, runtime flags
- `lib/services/{tenant,user,invite,billing,subscription}Service.ts` — business logic extracted from actions/webhooks
- Server actions reduced to ~15-30-line thin wrappers
- Webhook routes reduced to signature-verify + idempotency-gate + delegate
- Feature flags applied: admin can 404, billing tab hides, invite UI hides, email can stay stubbed
- Email transport: real Resend when `FEATURE_EMAIL_ENABLED=1`, stub otherwise (SDK lazy-imported)
- Branding read from `appConfig` everywhere (layout metadata, marketing page, Inngest app id)

### v1.2.1 — Critical fixes
- Clerk `organizationMembership.deleted` properly scoped by `(tenantId, userId)`
- Admin page placeholder JSX cleaned
- Trial-ending reminder cron registered (daily 09:00 UTC)

### v1.2.0 — Initial cut
- Full Drizzle schema with v1.2 idempotency columns
- `withTenant()` + `drizzle/rls.sql` + `scripts/apply-rls.ts`
- Stripe atomic-idempotent webhook via `processed_stripe_events`
- Clerk webhook with Svix verification
- 7 Inngest jobs (welcome, provision, invite, trial-ending + cron, payment-failed, cleanup)
- Pages: marketing root, sign-in/up, onboarding (atomic Clerk+DB rollback), tenant dashboard/team/billing/settings, admin (overview/tenants/users/detail), accept-invite
- Sentry across client/server/edge + onRequestError
- Postgres-backed invite rate limit (10/tenant/hr)

## Quality gates
- `tsc --noEmit` → **0 errors**
- `eslint` → **0 errors, 0 warnings**
- Branding grep → clean
- Raw-DB-in-pages grep → clean (pages either use services or `withTenant()`)

## Forking for a new product

To start any new SaaS on top of this engine:

1. Set `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_DESCRIPTION`, `NEXT_PUBLIC_APP_HEADLINE`, `NEXT_PUBLIC_APP_SUBHEAD`, `NEXT_PUBLIC_APP_SLUG`, `NEXT_PUBLIC_SUPPORT_EMAIL` in `.env.local`.
2. (Optional) Edit `lib/config/billing.ts` for custom plan catalog.
3. (Optional) Toggle features in `lib/config/features.ts`.
4. Build product features as new routes under `app/(tenant)/<feature>/` + new services under `lib/services/<feature>Service.ts`. Never touch the core auth/tenant/billing/webhook surface.

## Next tasks
- **P0**: User provisions Clerk, Neon, Stripe (test), Inngest, Sentry; fills `.env.local`; runs `pnpm db:migrate && pnpm db:rls`.
- **P1**: Replay-test Stripe + Clerk webhooks against the dev instance.
- **P1**: Inngest dry-run via `inngest-cli dev`.
- **P2**: Build flash-cards product layer (separate concern; reuses everything above).
- **P3**: Transfer-ownership action, leave-workspace action, audit-log export (Enterprise gate).
- **P3**: Playwright E2E for the Phase-0 checklist.

## Notes
- Boilerplate lives in `/app/saas-boilerplate/`. Treat it as the root of a fresh repo when cloning to GitHub/Vercel.
- Will not run in the Emergent preview environment (Next.js+Postgres+Clerk vs. the supervisor's React+FastAPI).
