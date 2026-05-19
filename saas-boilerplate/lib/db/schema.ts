/**
 * Drizzle schema — single source of truth for the database.
 * RLS policies live in `drizzle/rls.sql` and are applied via `scripts/apply-rls.ts`.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */
export const roleEnum = pgEnum("role", ["owner", "admin", "member"]);
export const planEnum = pgEnum("plan", ["free", "pro", "premium"]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "paused",
]);
export const tenantStatusEnum = pgEnum("tenant_status", [
  "provisioning",
  "active",
  "inactive",
  "suspended",
  "failed",
  "deleted",
]);
export const cardTypeEnum = pgEnum("card_type", ["basic", "image", "audio", "cloze"]);
export const accessTierEnum = pgEnum("access_tier", ["free", "pro", "premium"]);
export const contentSourceEnum = pgEnum("content_source", ["global", "tenant"]);

/* ------------------------------------------------------------------ */
/* users                                                               */
/* ------------------------------------------------------------------ */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkUserId: text("clerk_user_id").notNull(),
    email: text("email").notNull(),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    // Profile / product
    timezone: text("timezone").notNull().default("UTC"),
    dailyGoalMinutes: integer("daily_goal_minutes").notNull().default(10),
    onboardingComplete: boolean("onboarding_complete").notNull().default(false),
    onboardingStep: integer("onboarding_step").notNull().default(0),
    // Streak (cached; reconciled nightly)
    streakCount: integer("streak_count").notNull().default(0),
    lastStudyDate: timestamp("last_study_date", { mode: "date" }),
    // Email preferences
    emailUnsubscribed: boolean("email_unsubscribed").notNull().default(false),
    emailUnsubscribedTypes: jsonb("email_unsubscribed_types").notNull().default(sql`'[]'::jsonb`),
    // System
    welcomeEmailSentAt: timestamp("welcome_email_sent_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_clerk_user_id_idx").on(t.clerkUserId),
    uniqueIndex("users_email_idx").on(t.email),
  ],
);

/* ------------------------------------------------------------------ */
/* tenants                                                             */
/* ------------------------------------------------------------------ */
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clerkOrgId: text("clerk_org_id").notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    subdomain: text("subdomain"),
    customDomain: text("custom_domain"),
    status: tenantStatusEnum("status").notNull().default("active"),
    logoUrl: text("logo_url"),
    primaryColor: text("primary_color"),
    secondaryColor: text("secondary_color"),
    fontFamily: text("font_family"),
    supportEmail: text("support_email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tenants_slug_idx").on(t.slug),
    uniqueIndex("tenants_clerk_org_id_idx").on(t.clerkOrgId),
    uniqueIndex("tenants_subdomain_idx").on(t.subdomain),
    uniqueIndex("tenants_custom_domain_idx").on(t.customDomain),
  ],
);

/* ------------------------------------------------------------------ */
/* tenant_settings — per-tenant runtime configuration                  */
/* ------------------------------------------------------------------ */
export const tenantSettings = pgTable(
  "tenant_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    featureFlags: jsonb("feature_flags").notNull().default(sql`'{}'::jsonb`),
    /** Per-tier Stripe Price IDs override env-level defaults. Shape: { pro: "price_...", premium: "price_..." } */
    subscriptionTiers: jsonb("subscription_tiers").notNull().default(sql`'{}'::jsonb`),
    trialDays: integer("trial_days").notNull().default(14),
    gracePeriodDays: integer("grace_period_days").notNull().default(3),
    storageQuotaMb: integer("storage_quota_mb").notNull().default(1024),
    sessionCardCap: integer("session_card_cap").notNull().default(20),
    /** Array of region UUIDs enabled for this tenant. Empty array = all regions. */
    enabledRegionIds: jsonb("enabled_region_ids").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tenant_settings_tenant_idx").on(t.tenantId)],
);

/* ------------------------------------------------------------------ */
/* tenant_members                                                      */
/* ------------------------------------------------------------------ */
export const tenantMembers = pgTable(
  "tenant_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("member"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tenant_members_tenant_user_idx").on(t.tenantId, t.userId),
    index("tenant_members_user_idx").on(t.userId),
    index("tenant_members_tenant_idx").on(t.tenantId),
  ],
);

/* ------------------------------------------------------------------ */
/* subscriptions — Phase 1.5 model:                                    */
/*   • tenant = scope/billing-container                                */
/*   • user   = entitlement holder                                     */
/* Each user has at most one subscription row per tenant.              */
/* ------------------------------------------------------------------ */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    stripePriceId: text("stripe_price_id"),
    plan: planEnum("plan").notNull().default("free"),
    status: subscriptionStatusEnum("status").notNull().default("active"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    gracePeriodEnd: timestamp("grace_period_end", { withTimezone: true }),
    /** Decks the user has unlocked previously; preserved across cancel for re-subscribe UX. */
    previouslyUnlockedDeckIds: jsonb("previously_unlocked_deck_ids").notNull().default(sql`'[]'::jsonb`),
    trialReminderSentAt: timestamp("trial_reminder_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("subscriptions_tenant_user_idx").on(t.tenantId, t.userId),
    index("subscriptions_user_idx").on(t.userId),
    index("subscriptions_stripe_subscription_id_idx").on(t.stripeSubscriptionId),
    index("subscriptions_stripe_customer_id_idx").on(t.stripeCustomerId),
  ],
);

/* ------------------------------------------------------------------ */
/* regions — GLOBAL catalog. Tenants opt into a subset via              */
/* tenant_settings.enabled_region_ids. Users pick from the allowed set. */
/* ------------------------------------------------------------------ */
export const regions = pgTable(
  "regions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    parentRegionId: uuid("parent_region_id"),
    /** Geographic bounding box for the SVG map. Shape: { north,south,east,west } in decimal degrees. */
    boundingBox: jsonb("bounding_box"),
    /** Hex color used to tint the region on the map. */
    accentColor: text("accent_color"),
    displayOrder: integer("display_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("regions_slug_idx").on(t.slug),
    index("regions_parent_idx").on(t.parentRegionId),
    index("regions_active_order_idx").on(t.isActive, t.displayOrder),
  ],
);

/* ------------------------------------------------------------------ */
/* user_regions — which regions a user has selected (RLS-scoped).      */
/* Exactly one row per user may have is_primary = true (enforced via   */
/* partial unique index).                                              */
/* ------------------------------------------------------------------ */
export const userRegions = pgTable(
  "user_regions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    regionId: uuid("region_id")
      .notNull()
      .references(() => regions.id, { onDelete: "restrict" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("user_regions_unique_idx").on(t.tenantId, t.userId, t.regionId),
    index("user_regions_user_idx").on(t.tenantId, t.userId),
    index("user_regions_region_idx").on(t.regionId),
    // Enforce "one primary region per user per tenant" at the DB level.
    uniqueIndex("user_regions_one_primary_idx")
      .on(t.tenantId, t.userId)
      .where(sql`is_primary = true`),
  ],
);

/* ------------------------------------------------------------------ */
/* GLOBAL CONTENT CATALOG — `global_decks` and `global_cards` are the   */
/* canonical, platform-owned source of truth. They live OUTSIDE tenant  */
/* RLS and are readable by every tenant. Tenants reference them by      */
/* default and only fork (clone) when they need to customize a row.     */
/* ------------------------------------------------------------------ */
export const globalDecks = pgTable(
  "global_decks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** Region this deck belongs to. Cards inherit the deck's region. */
    regionId: uuid("region_id")
      .notNull()
      .references(() => regions.id, { onDelete: "restrict" }),
    accessTier: accessTierEnum("access_tier").notNull().default("free"),
    /** Surface attribution / category labels on the customer UI. */
    tags: jsonb("tags").notNull().default(sql`'[]'::jsonb`),
    coverImageUrl: text("cover_image_url"),
    displayOrder: integer("display_order").notNull().default(0),
    /** Monotonic version bumped on every published change. Used by recall pipeline. */
    version: integer("version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("global_decks_slug_idx").on(t.slug),
    index("global_decks_region_idx").on(t.regionId),
    index("global_decks_active_order_idx").on(t.isActive, t.displayOrder),
  ],
);

export const globalCards = pgTable(
  "global_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    globalDeckId: uuid("global_deck_id")
      .notNull()
      .references(() => globalDecks.id, { onDelete: "cascade" }),
    cardType: cardTypeEnum("card_type").notNull().default("basic"),
    /** Prompt side. Markdown allowed. */
    front: text("front").notNull(),
    /** Answer side. Markdown allowed. */
    back: text("back").notNull(),
    /** Optional supporting media URLs. */
    imageUrl: text("image_url"),
    audioUrl: text("audio_url"),
    /** Optional progressive hint stack, displayed in order. */
    hints: jsonb("hints").notNull().default(sql`'[]'::jsonb`),
    /** Optional structured fields for cloze/quiz variants. */
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    displayOrder: integer("display_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("global_cards_deck_idx").on(t.globalDeckId, t.displayOrder),
    index("global_cards_active_idx").on(t.isActive),
  ],
);

/*
 * TENANT CONTENT FORKS — created lazily when a tenant admin edits a
 * global row, OR authored from scratch by a tenant admin.
 *   - global_deck_id IS NULL  -> tenant-original deck
 *   - global_deck_id NOT NULL -> fork of a global deck
 *
 * overridden_fields records which JSON keys the tenant has diverged
 * on. Any field NOT listed there continues to inherit the global row
 * at read time. This is the hybrid "reference-by-default, clone-on-edit"
 * model.
 */
export const tenantDecks = pgTable(
  "tenant_decks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Nullable: NULL = tenant-original, non-null = fork of a global deck. */
    globalDeckId: uuid("global_deck_id").references(() => globalDecks.id, { onDelete: "set null" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    regionId: uuid("region_id")
      .notNull()
      .references(() => regions.id, { onDelete: "restrict" }),
    accessTier: accessTierEnum("access_tier").notNull().default("free"),
    tags: jsonb("tags").notNull().default(sql`'[]'::jsonb`),
    coverImageUrl: text("cover_image_url"),
    displayOrder: integer("display_order").notNull().default(0),
    /** Array of column names (string[]) the tenant has overridden. */
    overriddenFields: jsonb("overridden_fields").notNull().default(sql`'[]'::jsonb`),
    isPublished: boolean("is_published").notNull().default(true),
    isArchived: boolean("is_archived").notNull().default(false),
    /** Snapshot of the global deck version at the time of fork. */
    sourceVersion: integer("source_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tenant_decks_tenant_slug_idx").on(t.tenantId, t.slug),
    // One fork per (tenant, global deck) — prevents accidental duplicate forks.
    uniqueIndex("tenant_decks_tenant_global_idx")
      .on(t.tenantId, t.globalDeckId)
      .where(sql`global_deck_id IS NOT NULL`),
    index("tenant_decks_tenant_region_idx").on(t.tenantId, t.regionId),
  ],
);

export const tenantCards = pgTable(
  "tenant_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    tenantDeckId: uuid("tenant_deck_id")
      .notNull()
      .references(() => tenantDecks.id, { onDelete: "cascade" }),
    /** Nullable: NULL = tenant-original card, non-null = fork of a global card. */
    globalCardId: uuid("global_card_id").references(() => globalCards.id, { onDelete: "set null" }),
    cardType: cardTypeEnum("card_type").notNull().default("basic"),
    front: text("front").notNull(),
    back: text("back").notNull(),
    imageUrl: text("image_url"),
    audioUrl: text("audio_url"),
    hints: jsonb("hints").notNull().default(sql`'[]'::jsonb`),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    displayOrder: integer("display_order").notNull().default(0),
    overriddenFields: jsonb("overridden_fields").notNull().default(sql`'[]'::jsonb`),
    sourceVersion: integer("source_version"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tenant_cards_deck_idx").on(t.tenantDeckId, t.displayOrder),
    uniqueIndex("tenant_cards_tenant_global_idx")
      .on(t.tenantId, t.globalCardId)
      .where(sql`global_card_id IS NOT NULL`),
    index("tenant_cards_tenant_idx").on(t.tenantId),
  ],
);

/* ------------------------------------------------------------------ */
/* invitations                                                         */
/* ------------------------------------------------------------------ */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: roleEnum("role").notNull().default("member"),
    token: text("token").notNull(),
    invitedById: uuid("invited_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    inviteEmailSentAt: timestamp("invite_email_sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invitations_token_idx").on(t.token),
    index("invitations_tenant_email_idx").on(t.tenantId, t.email),
  ],
);

/* ------------------------------------------------------------------ */
/* audit_logs                                                          */
/* ------------------------------------------------------------------ */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_tenant_idx").on(t.tenantId),
    index("audit_logs_action_idx").on(t.action),
    index("audit_logs_created_at_idx").on(t.createdAt),
  ],
);

/* ------------------------------------------------------------------ */
/* processed_stripe_events (idempotency)                               */
/* ------------------------------------------------------------------ */
export const processedStripeEvents = pgTable("processed_stripe_events", {
  stripeEventId: text("stripe_event_id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* invite_rate_limit (bucket per tenant)                               */
/* ------------------------------------------------------------------ */
export const inviteRateLimit = pgTable(
  "invite_rate_limit",
  {
    tenantId: uuid("tenant_id").primaryKey(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
    count: integer("count").notNull().default(0),
  },
);

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */
export const tenantsRelations = relations(tenants, ({ many, one }) => ({
  members: many(tenantMembers),
  invitations: many(invitations),
  subscriptions: many(subscriptions),
  settings: one(tenantSettings, {
    fields: [tenants.id],
    references: [tenantSettings.tenantId],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(tenantMembers),
  subscriptions: many(subscriptions),
}));

export const tenantMembersRelations = relations(tenantMembers, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantMembers.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [tenantMembers.userId], references: [users.id] }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  tenant: one(tenants, { fields: [subscriptions.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [subscriptions.userId], references: [users.id] }),
}));

export const regionsRelations = relations(regions, ({ one, many }) => ({
  parent: one(regions, {
    fields: [regions.parentRegionId],
    references: [regions.id],
    relationName: "region_parent",
  }),
  children: many(regions, { relationName: "region_parent" }),
  userRegions: many(userRegions),
}));

export const userRegionsRelations = relations(userRegions, ({ one }) => ({
  tenant: one(tenants, { fields: [userRegions.tenantId], references: [tenants.id] }),
  user: one(users, { fields: [userRegions.userId], references: [users.id] }),
  region: one(regions, { fields: [userRegions.regionId], references: [regions.id] }),
}));

export const globalDecksRelations = relations(globalDecks, ({ one, many }) => ({
  region: one(regions, { fields: [globalDecks.regionId], references: [regions.id] }),
  cards: many(globalCards),
  forks: many(tenantDecks),
}));

export const globalCardsRelations = relations(globalCards, ({ one, many }) => ({
  deck: one(globalDecks, { fields: [globalCards.globalDeckId], references: [globalDecks.id] }),
  forks: many(tenantCards),
}));

export const tenantDecksRelations = relations(tenantDecks, ({ one, many }) => ({
  tenant: one(tenants, { fields: [tenantDecks.tenantId], references: [tenants.id] }),
  region: one(regions, { fields: [tenantDecks.regionId], references: [regions.id] }),
  source: one(globalDecks, { fields: [tenantDecks.globalDeckId], references: [globalDecks.id] }),
  cards: many(tenantCards),
}));

export const tenantCardsRelations = relations(tenantCards, ({ one }) => ({
  tenant: one(tenants, { fields: [tenantCards.tenantId], references: [tenants.id] }),
  deck: one(tenantDecks, { fields: [tenantCards.tenantDeckId], references: [tenantDecks.id] }),
  source: one(globalCards, { fields: [tenantCards.globalCardId], references: [globalCards.id] }),
}));
