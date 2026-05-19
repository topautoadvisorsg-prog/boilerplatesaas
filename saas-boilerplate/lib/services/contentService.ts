/**
 * contentService — Wilderness Intelligence content layer.
 *
 * Hybrid model (reference-by-default, clone-on-edit):
 *   • `global_decks` / `global_cards` are the platform-owned canonical
 *     catalog. Every tenant reads from them at no cost.
 *   • A tenant fork is created in `tenant_decks` / `tenant_cards` only
 *     when a tenant admin edits a global row, OR authors net-new content.
 *   • `overridden_fields` records which columns have diverged from the
 *     global parent. Non-overridden fields keep inheriting global updates
 *     at read time (resolved here in code).
 *   • Forked rows preserve `global_deck_id` / `global_card_id` lineage so
 *     downstream subsystems (study state, recall pipeline) can follow the
 *     link across forks.
 *
 * Every mutation goes through this module — never edit content tables
 * directly from a server action.
 */
import { db } from "@/lib/db";
import {
  globalDecks,
  globalCards,
  tenantDecks,
  tenantCards,
  regions,
  tenantSettings,
  userRegions,
  subscriptions,
} from "@/lib/db/schema";
import { and, asc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/lib/db/with-tenant";
import { type PlanId } from "@/lib/config/billing";
import { logAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { inngest } from "@/lib/jobs/client";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type AccessTier = "free" | "pro" | "premium";
export type CardType = "basic" | "image" | "audio" | "cloze";
export type ContentSource = "global" | "tenant";

/** Public-facing deck shape, regardless of origin. */
export interface ResolvedDeck {
  /** Stable display id. For globals this is `global_decks.id`; for forks/originals it is `tenant_decks.id`. */
  id: string;
  source: ContentSource;
  /** When `source = "tenant"` and the deck is a fork, this is the upstream global id. */
  globalDeckId: string | null;
  slug: string;
  name: string;
  description: string | null;
  regionId: string;
  accessTier: AccessTier;
  tags: string[];
  coverImageUrl: string | null;
  displayOrder: number;
  isPublished: boolean;
  isArchived: boolean;
  version: number;
}

/** Public-facing card shape. */
export interface ResolvedCard {
  id: string;
  source: ContentSource;
  globalCardId: string | null;
  deckId: string;
  cardType: CardType;
  front: string;
  back: string;
  imageUrl: string | null;
  audioUrl: string | null;
  hints: string[];
  payload: Record<string, unknown>;
  displayOrder: number;
  version: number;
}

export type DeckPatch = Partial<
  Pick<
    ResolvedDeck,
    | "name"
    | "description"
    | "accessTier"
    | "tags"
    | "coverImageUrl"
    | "displayOrder"
    | "isPublished"
    | "isArchived"
  >
>;

export type CardPatch = Partial<
  Pick<
    ResolvedCard,
    | "cardType"
    | "front"
    | "back"
    | "imageUrl"
    | "audioUrl"
    | "hints"
    | "payload"
    | "displayOrder"
  >
>;

export class ContentNotFoundError extends Error {
  constructor(kind: "deck" | "card", id: string) {
    super(`${kind} not found: ${id}`);
    this.name = "ContentNotFoundError";
  }
}

export class ContentAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentAccessError";
  }
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

const DECK_INHERITABLE: Array<keyof DeckPatch> = [
  "name",
  "description",
  "accessTier",
  "tags",
  "coverImageUrl",
  "displayOrder",
];

const CARD_INHERITABLE: Array<keyof CardPatch> = [
  "cardType",
  "front",
  "back",
  "imageUrl",
  "audioUrl",
  "hints",
  "payload",
  "displayOrder",
];

async function getCallerPlan(tenantId: string, userId: string): Promise<PlanId> {
  const [sub] = await db
    .select({ plan: subscriptions.plan, status: subscriptions.status })
    .from(subscriptions)
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.userId, userId)))
    .limit(1);
  if (!sub) return "free";
  const lapsed =
    sub.status === "past_due" ||
    sub.status === "unpaid" ||
    sub.status === "incomplete_expired";
  return lapsed ? "free" : sub.plan;
}

/** Tier ordering used for plan-vs-deck gating. */
const TIER_RANK: Record<AccessTier, number> = { free: 0, pro: 1, premium: 2 };

function planCanAccessTier(plan: PlanId, tier: AccessTier): boolean {
  return TIER_RANK[plan] >= TIER_RANK[tier];
}

/** Resolve the tenant's visible region ids for a user (intersection of tenant + user). */
async function resolveVisibleRegionIds(ctx: TenantContext): Promise<string[]> {
  const [settings] = await db
    .select({ enabledRegionIds: tenantSettings.enabledRegionIds })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, ctx.tenantId))
    .limit(1);
  const tenantEnabled = (settings?.enabledRegionIds as string[] | null) ?? [];

  const userRows = await db
    .select({ regionId: userRegions.regionId })
    .from(userRegions)
    .where(and(eq(userRegions.tenantId, ctx.tenantId), eq(userRegions.userId, ctx.userId)));
  const userSelected = userRows.map((r) => r.regionId);

  if (userSelected.length === 0) {
    // Until the user picks regions, fall back to the tenant's enabled set
    // (or the full catalog if the tenant hasn't restricted anything).
    if (tenantEnabled.length === 0) {
      const all = await db.select({ id: regions.id }).from(regions).where(eq(regions.isActive, true));
      return all.map((r) => r.id);
    }
    return tenantEnabled;
  }

  if (tenantEnabled.length === 0) return userSelected;
  const allow = new Set(tenantEnabled);
  return userSelected.filter((id) => allow.has(id));
}

/* ------------------------------------------------------------------ */
/* READ: decks                                                         */
/* ------------------------------------------------------------------ */

/**
 * Decks visible to the current user, hybrid-resolved:
 *   • tenant forks + tenant-original decks (RLS-scoped)
 *   • PLUS global decks not yet forked by this tenant
 *   • filtered to the user's visible regions
 *   • filtered by plan tier
 */
export async function listDecksForUser(ctx: TenantContext): Promise<ResolvedDeck[]> {
  const [visibleRegionIds, plan] = await Promise.all([
    resolveVisibleRegionIds(ctx),
    getCallerPlan(ctx.tenantId, ctx.userId),
  ]);
  if (visibleRegionIds.length === 0) return [];

  return withTenant(ctx, async (tx) => {
    const tenantRows = await tx
      .select()
      .from(tenantDecks)
      .where(
        and(
          eq(tenantDecks.isArchived, false),
          eq(tenantDecks.isPublished, true),
          inArray(tenantDecks.regionId, visibleRegionIds),
        ),
      );

    const forkedGlobalIds = tenantRows
      .map((r) => r.globalDeckId)
      .filter((v): v is string => Boolean(v));

    const globalCondition =
      forkedGlobalIds.length === 0
        ? and(eq(globalDecks.isActive, true), inArray(globalDecks.regionId, visibleRegionIds))
        : and(
            eq(globalDecks.isActive, true),
            inArray(globalDecks.regionId, visibleRegionIds),
            notInArray(globalDecks.id, forkedGlobalIds),
          );

    const globalRows = await tx.select().from(globalDecks).where(globalCondition);

    // Build a global lookup so forks can inherit non-overridden fields.
    const globalMap = new Map<string, typeof globalRows[number]>();
    if (forkedGlobalIds.length > 0) {
      const sources = await tx
        .select()
        .from(globalDecks)
        .where(inArray(globalDecks.id, forkedGlobalIds));
      for (const g of sources) globalMap.set(g.id, g);
    }

    const merged: ResolvedDeck[] = [];

    for (const g of globalRows) {
      if (!planCanAccessTier(plan, g.accessTier)) continue;
      merged.push({
        id: g.id,
        source: "global",
        globalDeckId: null,
        slug: g.slug,
        name: g.name,
        description: g.description,
        regionId: g.regionId,
        accessTier: g.accessTier,
        tags: (g.tags as string[] | null) ?? [],
        coverImageUrl: g.coverImageUrl,
        displayOrder: g.displayOrder,
        isPublished: true,
        isArchived: false,
        version: g.version,
      });
    }

    for (const t of tenantRows) {
      const source = t.globalDeckId ? globalMap.get(t.globalDeckId) ?? null : null;
      const overridden = new Set((t.overriddenFields as string[] | null) ?? []);
      const pick = <K extends keyof DeckPatch>(field: K, fallback: ResolvedDeck[K]): ResolvedDeck[K] => {
        if (!source) return fallback;
        if (overridden.has(field as string)) return fallback;
        // Inherit from global.
        switch (field) {
          case "name":
            return source.name as ResolvedDeck[K];
          case "description":
            return source.description as ResolvedDeck[K];
          case "accessTier":
            return source.accessTier as ResolvedDeck[K];
          case "tags":
            return ((source.tags as string[] | null) ?? []) as ResolvedDeck[K];
          case "coverImageUrl":
            return source.coverImageUrl as ResolvedDeck[K];
          case "displayOrder":
            return source.displayOrder as ResolvedDeck[K];
          default:
            return fallback;
        }
      };

      const accessTier = pick("accessTier", t.accessTier);
      if (!planCanAccessTier(plan, accessTier)) continue;

      merged.push({
        id: t.id,
        source: "tenant",
        globalDeckId: t.globalDeckId,
        slug: t.slug,
        name: pick("name", t.name),
        description: pick("description", t.description),
        regionId: t.regionId,
        accessTier,
        tags: pick("tags", (t.tags as string[] | null) ?? []),
        coverImageUrl: pick("coverImageUrl", t.coverImageUrl),
        displayOrder: pick("displayOrder", t.displayOrder),
        isPublished: t.isPublished,
        isArchived: t.isArchived,
        version: source?.version ?? 1,
      });
    }

    merged.sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name));
    return merged;
  });
}

/* ------------------------------------------------------------------ */
/* READ: a single deck (+ access checks)                               */
/* ------------------------------------------------------------------ */

/**
 * Look up a deck for the current tenant by its display id.
 * Resolves tenant forks first, then falls back to globals.
 */
export async function getDeckForUser(
  ctx: TenantContext,
  deckId: string,
): Promise<ResolvedDeck> {
  const plan = await getCallerPlan(ctx.tenantId, ctx.userId);

  // Try tenant first (RLS-scoped).
  const tenantRow = await withTenant(ctx, async (tx) => {
    const [row] = await tx.select().from(tenantDecks).where(eq(tenantDecks.id, deckId)).limit(1);
    return row ?? null;
  });

  if (tenantRow) {
    const source = tenantRow.globalDeckId
      ? (
          await db
            .select()
            .from(globalDecks)
            .where(eq(globalDecks.id, tenantRow.globalDeckId))
            .limit(1)
        )[0] ?? null
      : null;
    const overridden = new Set((tenantRow.overriddenFields as string[] | null) ?? []);
    const resolved: ResolvedDeck = {
      id: tenantRow.id,
      source: "tenant",
      globalDeckId: tenantRow.globalDeckId,
      slug: tenantRow.slug,
      name: source && !overridden.has("name") ? source.name : tenantRow.name,
      description:
        source && !overridden.has("description") ? source.description : tenantRow.description,
      regionId: tenantRow.regionId,
      accessTier:
        source && !overridden.has("accessTier") ? source.accessTier : tenantRow.accessTier,
      tags:
        source && !overridden.has("tags")
          ? ((source.tags as string[] | null) ?? [])
          : ((tenantRow.tags as string[] | null) ?? []),
      coverImageUrl:
        source && !overridden.has("coverImageUrl")
          ? source.coverImageUrl
          : tenantRow.coverImageUrl,
      displayOrder:
        source && !overridden.has("displayOrder") ? source.displayOrder : tenantRow.displayOrder,
      isPublished: tenantRow.isPublished,
      isArchived: tenantRow.isArchived,
      version: source?.version ?? 1,
    };
    if (!planCanAccessTier(plan, resolved.accessTier)) {
      throw new ContentAccessError("This deck requires a higher plan.");
    }
    return resolved;
  }

  // Fall back to global. Must not be forked by this tenant.
  const [g] = await db
    .select()
    .from(globalDecks)
    .where(and(eq(globalDecks.id, deckId), eq(globalDecks.isActive, true)))
    .limit(1);
  if (!g) throw new ContentNotFoundError("deck", deckId);

  // Confirm the tenant hasn't forked it (the fork would have surfaced above).
  if (!planCanAccessTier(plan, g.accessTier)) {
    throw new ContentAccessError("This deck requires a higher plan.");
  }
  return {
    id: g.id,
    source: "global",
    globalDeckId: null,
    slug: g.slug,
    name: g.name,
    description: g.description,
    regionId: g.regionId,
    accessTier: g.accessTier,
    tags: (g.tags as string[] | null) ?? [],
    coverImageUrl: g.coverImageUrl,
    displayOrder: g.displayOrder,
    isPublished: true,
    isArchived: false,
    version: g.version,
  };
}

/* ------------------------------------------------------------------ */
/* READ: cards for a deck                                              */
/* ------------------------------------------------------------------ */

export async function listCardsForDeck(
  ctx: TenantContext,
  deckId: string,
): Promise<ResolvedCard[]> {
  const deck = await getDeckForUser(ctx, deckId);

  // Global deck (no fork yet): cards are global only.
  if (deck.source === "global") {
    const rows = await db
      .select()
      .from(globalCards)
      .where(and(eq(globalCards.globalDeckId, deck.id), eq(globalCards.isActive, true)))
      .orderBy(asc(globalCards.displayOrder));
    return rows.map((c) => ({
      id: c.id,
      source: "global" as const,
      globalCardId: null,
      deckId: deck.id,
      cardType: c.cardType,
      front: c.front,
      back: c.back,
      imageUrl: c.imageUrl,
      audioUrl: c.audioUrl,
      hints: (c.hints as string[] | null) ?? [],
      payload: (c.payload as Record<string, unknown> | null) ?? {},
      displayOrder: c.displayOrder,
      version: c.version,
    }));
  }

  // Tenant deck: tenant cards + (if forked) inherited global cards not yet forked.
  return withTenant(ctx, async (tx) => {
    const tenantRows = await tx
      .select()
      .from(tenantCards)
      .where(and(eq(tenantCards.tenantDeckId, deck.id), eq(tenantCards.isActive, true)));

    const forkedGlobalCardIds = tenantRows
      .map((r) => r.globalCardId)
      .filter((v): v is string => Boolean(v));

    let globalRows: Array<typeof globalCards.$inferSelect> = [];
    if (deck.globalDeckId) {
      const cond =
        forkedGlobalCardIds.length === 0
          ? and(eq(globalCards.globalDeckId, deck.globalDeckId), eq(globalCards.isActive, true))
          : and(
              eq(globalCards.globalDeckId, deck.globalDeckId),
              eq(globalCards.isActive, true),
              notInArray(globalCards.id, forkedGlobalCardIds),
            );
      globalRows = await tx.select().from(globalCards).where(cond);
    }

    // Index global rows for inheritance lookup on forks.
    const globalMap = new Map<string, typeof globalCards.$inferSelect>();
    if (forkedGlobalCardIds.length > 0) {
      const sources = await tx
        .select()
        .from(globalCards)
        .where(inArray(globalCards.id, forkedGlobalCardIds));
      for (const g of sources) globalMap.set(g.id, g);
    }

    const out: ResolvedCard[] = [];
    for (const g of globalRows) {
      out.push({
        id: g.id,
        source: "global",
        globalCardId: null,
        deckId: deck.id,
        cardType: g.cardType,
        front: g.front,
        back: g.back,
        imageUrl: g.imageUrl,
        audioUrl: g.audioUrl,
        hints: (g.hints as string[] | null) ?? [],
        payload: (g.payload as Record<string, unknown> | null) ?? {},
        displayOrder: g.displayOrder,
        version: g.version,
      });
    }
    for (const t of tenantRows) {
      const source = t.globalCardId ? globalMap.get(t.globalCardId) ?? null : null;
      const overridden = new Set((t.overriddenFields as string[] | null) ?? []);
      const pick = <K extends keyof CardPatch>(field: K, fallback: ResolvedCard[K]): ResolvedCard[K] => {
        if (!source) return fallback;
        if (overridden.has(field as string)) return fallback;
        switch (field) {
          case "cardType":
            return source.cardType as ResolvedCard[K];
          case "front":
            return source.front as ResolvedCard[K];
          case "back":
            return source.back as ResolvedCard[K];
          case "imageUrl":
            return source.imageUrl as ResolvedCard[K];
          case "audioUrl":
            return source.audioUrl as ResolvedCard[K];
          case "hints":
            return ((source.hints as string[] | null) ?? []) as ResolvedCard[K];
          case "payload":
            return ((source.payload as Record<string, unknown> | null) ?? {}) as ResolvedCard[K];
          case "displayOrder":
            return source.displayOrder as ResolvedCard[K];
          default:
            return fallback;
        }
      };
      out.push({
        id: t.id,
        source: "tenant",
        globalCardId: t.globalCardId,
        deckId: deck.id,
        cardType: pick("cardType", t.cardType),
        front: pick("front", t.front),
        back: pick("back", t.back),
        imageUrl: pick("imageUrl", t.imageUrl),
        audioUrl: pick("audioUrl", t.audioUrl),
        hints: pick("hints", (t.hints as string[] | null) ?? []),
        payload: pick("payload", (t.payload as Record<string, unknown> | null) ?? {}),
        displayOrder: pick("displayOrder", t.displayOrder),
        version: source?.version ?? 1,
      });
    }
    out.sort((a, b) => a.displayOrder - b.displayOrder);
    return out;
  });
}

/* ------------------------------------------------------------------ */
/* WRITE: fork a global deck (lazy / explicit)                          */
/* ------------------------------------------------------------------ */

/**
 * Create the tenant-side shell for a global deck. Cards remain global
 * until individually forked. Idempotent on (tenant_id, global_deck_id).
 */
export async function forkGlobalDeck(
  ctx: TenantContext,
  globalDeckId: string,
): Promise<{ tenantDeckId: string; createdNew: boolean }> {
  if (ctx.role === "member") {
    throw new ContentAccessError("Only owners and admins can customize decks.");
  }
  const [g] = await db
    .select()
    .from(globalDecks)
    .where(and(eq(globalDecks.id, globalDeckId), eq(globalDecks.isActive, true)))
    .limit(1);
  if (!g) throw new ContentNotFoundError("deck", globalDeckId);

  const result = await withTenant(ctx, async (tx) => {
    const [existing] = await tx
      .select({ id: tenantDecks.id })
      .from(tenantDecks)
      .where(
        and(eq(tenantDecks.tenantId, ctx.tenantId), eq(tenantDecks.globalDeckId, globalDeckId)),
      )
      .limit(1);
    if (existing) return { tenantDeckId: existing.id, createdNew: false };

    const [inserted] = await tx
      .insert(tenantDecks)
      .values({
        tenantId: ctx.tenantId,
        globalDeckId: g.id,
        slug: g.slug,
        name: g.name,
        description: g.description,
        regionId: g.regionId,
        accessTier: g.accessTier,
        tags: (g.tags as string[] | null) ?? [],
        coverImageUrl: g.coverImageUrl,
        displayOrder: g.displayOrder,
        overriddenFields: [],
        isPublished: true,
        isArchived: false,
        sourceVersion: g.version,
      })
      .returning({ id: tenantDecks.id });
    if (!inserted) throw new Error("Failed to fork deck.");
    return { tenantDeckId: inserted.id, createdNew: true };
  });

  if (result.createdNew) {
    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: AUDIT_ACTIONS.CONTENT_DECK_FORKED,
      metadata: { globalDeckId, tenantDeckId: result.tenantDeckId },
    });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* WRITE: fork a global card under an existing/forked tenant deck      */
/* ------------------------------------------------------------------ */

async function forkGlobalCardInternal(
  ctx: TenantContext,
  args: { globalCardId: string; tenantDeckId: string },
): Promise<{ tenantCardId: string; createdNew: boolean }> {
  const [g] = await db
    .select()
    .from(globalCards)
    .where(and(eq(globalCards.id, args.globalCardId), eq(globalCards.isActive, true)))
    .limit(1);
  if (!g) throw new ContentNotFoundError("card", args.globalCardId);

  const result = await withTenant(ctx, async (tx) => {
    const [existing] = await tx
      .select({ id: tenantCards.id })
      .from(tenantCards)
      .where(
        and(eq(tenantCards.tenantId, ctx.tenantId), eq(tenantCards.globalCardId, args.globalCardId)),
      )
      .limit(1);
    if (existing) return { tenantCardId: existing.id, createdNew: false };

    const [inserted] = await tx
      .insert(tenantCards)
      .values({
        tenantId: ctx.tenantId,
        tenantDeckId: args.tenantDeckId,
        globalCardId: g.id,
        cardType: g.cardType,
        front: g.front,
        back: g.back,
        imageUrl: g.imageUrl,
        audioUrl: g.audioUrl,
        hints: (g.hints as string[] | null) ?? [],
        payload: (g.payload as Record<string, unknown> | null) ?? {},
        displayOrder: g.displayOrder,
        overriddenFields: [],
        sourceVersion: g.version,
      })
      .returning({ id: tenantCards.id });
    if (!inserted) throw new Error("Failed to fork card.");
    return { tenantCardId: inserted.id, createdNew: true };
  });

  if (result.createdNew) {
    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: AUDIT_ACTIONS.CONTENT_CARD_FORKED,
      metadata: {
        globalCardId: args.globalCardId,
        tenantCardId: result.tenantCardId,
        tenantDeckId: args.tenantDeckId,
      },
    });
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* WRITE: edit a deck (clones lazily on first edit)                    */
/* ------------------------------------------------------------------ */

export async function updateDeck(
  ctx: TenantContext,
  deckId: string,
  patch: DeckPatch,
): Promise<ResolvedDeck> {
  if (ctx.role === "member") {
    throw new ContentAccessError("Only owners and admins can edit decks.");
  }

  // Resolve which side the caller is editing.
  const tenantRow = await withTenant(ctx, async (tx) => {
    const [row] = await tx.select().from(tenantDecks).where(eq(tenantDecks.id, deckId)).limit(1);
    return row ?? null;
  });

  let tenantDeckId: string;
  if (tenantRow) {
    tenantDeckId = tenantRow.id;
  } else {
    // Try as global → fork it.
    const [g] = await db
      .select({ id: globalDecks.id })
      .from(globalDecks)
      .where(eq(globalDecks.id, deckId))
      .limit(1);
    if (!g) throw new ContentNotFoundError("deck", deckId);
    const forked = await forkGlobalDeck(ctx, g.id);
    tenantDeckId = forked.tenantDeckId;
  }

  // Apply patch, append touched fields to overridden_fields.
  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select()
      .from(tenantDecks)
      .where(eq(tenantDecks.id, tenantDeckId))
      .limit(1);
    if (!current) throw new ContentNotFoundError("deck", tenantDeckId);

    const overridden = new Set((current.overriddenFields as string[] | null) ?? []);
    const setValues: Record<string, unknown> = { updatedAt: new Date() };
    for (const field of DECK_INHERITABLE) {
      if (patch[field] !== undefined) {
        setValues[field] = patch[field];
        overridden.add(field);
      }
    }
    if (patch.isPublished !== undefined) setValues.isPublished = patch.isPublished;
    if (patch.isArchived !== undefined) setValues.isArchived = patch.isArchived;
    setValues.overriddenFields = Array.from(overridden);

    await tx.update(tenantDecks).set(setValues).where(eq(tenantDecks.id, tenantDeckId));
  });

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: patch.isArchived
      ? AUDIT_ACTIONS.CONTENT_DECK_ARCHIVED
      : AUDIT_ACTIONS.CONTENT_DECK_UPDATED,
    metadata: { tenantDeckId, fields: Object.keys(patch) },
  });

  return getDeckForUser(ctx, tenantDeckId);
}

/* ------------------------------------------------------------------ */
/* WRITE: edit a card (clones lazily on first edit)                    */
/* ------------------------------------------------------------------ */

export async function updateCard(
  ctx: TenantContext,
  cardId: string,
  patch: CardPatch,
): Promise<ResolvedCard> {
  if (ctx.role === "member") {
    throw new ContentAccessError("Only owners and admins can edit cards.");
  }

  // Tenant card?
  const tenantCard = await withTenant(ctx, async (tx) => {
    const [row] = await tx.select().from(tenantCards).where(eq(tenantCards.id, cardId)).limit(1);
    return row ?? null;
  });

  let tenantCardId: string;
  let tenantDeckId: string;

  if (tenantCard) {
    tenantCardId = tenantCard.id;
    tenantDeckId = tenantCard.tenantDeckId;
  } else {
    // Treat as a global card → must fork the parent deck first.
    const [g] = await db.select().from(globalCards).where(eq(globalCards.id, cardId)).limit(1);
    if (!g) throw new ContentNotFoundError("card", cardId);
    const forkedDeck = await forkGlobalDeck(ctx, g.globalDeckId);
    const forkedCard = await forkGlobalCardInternal(ctx, {
      globalCardId: g.id,
      tenantDeckId: forkedDeck.tenantDeckId,
    });
    tenantCardId = forkedCard.tenantCardId;
    tenantDeckId = forkedDeck.tenantDeckId;
  }

  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select()
      .from(tenantCards)
      .where(eq(tenantCards.id, tenantCardId))
      .limit(1);
    if (!current) throw new ContentNotFoundError("card", tenantCardId);

    const overridden = new Set((current.overriddenFields as string[] | null) ?? []);
    const setValues: Record<string, unknown> = { updatedAt: new Date() };
    for (const field of CARD_INHERITABLE) {
      if (patch[field] !== undefined) {
        setValues[field] = patch[field];
        overridden.add(field);
      }
    }
    setValues.overriddenFields = Array.from(overridden);
    await tx.update(tenantCards).set(setValues).where(eq(tenantCards.id, tenantCardId));
  });

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: AUDIT_ACTIONS.CONTENT_CARD_UPDATED,
    metadata: { tenantCardId, tenantDeckId, fields: Object.keys(patch) },
  });

  // Reload via the deck listing to apply inheritance correctly.
  const cards = await listCardsForDeck(ctx, tenantDeckId);
  const result = cards.find((c) => c.id === tenantCardId);
  if (!result) throw new ContentNotFoundError("card", tenantCardId);
  return result;
}

/* ------------------------------------------------------------------ */
/* WRITE: create a tenant-original deck                                */
/* ------------------------------------------------------------------ */

export interface CreateDeckInput {
  slug: string;
  name: string;
  description?: string | null;
  regionId: string;
  accessTier?: AccessTier;
  tags?: string[];
  coverImageUrl?: string | null;
  displayOrder?: number;
}

export async function createTenantDeck(
  ctx: TenantContext,
  input: CreateDeckInput,
): Promise<ResolvedDeck> {
  if (ctx.role === "member") {
    throw new ContentAccessError("Only owners and admins can create decks.");
  }

  const newId = await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(tenantDecks)
      .values({
        tenantId: ctx.tenantId,
        globalDeckId: null,
        slug: input.slug,
        name: input.name,
        description: input.description ?? null,
        regionId: input.regionId,
        accessTier: input.accessTier ?? "free",
        tags: input.tags ?? [],
        coverImageUrl: input.coverImageUrl ?? null,
        displayOrder: input.displayOrder ?? 0,
        overriddenFields: [],
        isPublished: true,
      })
      .returning({ id: tenantDecks.id });
    if (!row) throw new Error("Failed to create deck.");
    return row.id;
  });

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: AUDIT_ACTIONS.CONTENT_DECK_CREATED,
    metadata: { tenantDeckId: newId, slug: input.slug },
  });
  return getDeckForUser(ctx, newId);
}

/* ------------------------------------------------------------------ */
/* WRITE: create a tenant-original card under a tenant deck            */
/* ------------------------------------------------------------------ */

export interface CreateCardInput {
  tenantDeckId: string;
  cardType?: CardType;
  front: string;
  back: string;
  imageUrl?: string | null;
  audioUrl?: string | null;
  hints?: string[];
  payload?: Record<string, unknown>;
  displayOrder?: number;
}

export async function createTenantCard(
  ctx: TenantContext,
  input: CreateCardInput,
): Promise<ResolvedCard> {
  if (ctx.role === "member") {
    throw new ContentAccessError("Only owners and admins can create cards.");
  }
  const newId = await withTenant(ctx, async (tx) => {
    // Verify deck belongs to this tenant.
    const [deck] = await tx
      .select({ id: tenantDecks.id })
      .from(tenantDecks)
      .where(eq(tenantDecks.id, input.tenantDeckId))
      .limit(1);
    if (!deck) throw new ContentNotFoundError("deck", input.tenantDeckId);

    const [row] = await tx
      .insert(tenantCards)
      .values({
        tenantId: ctx.tenantId,
        tenantDeckId: input.tenantDeckId,
        globalCardId: null,
        cardType: input.cardType ?? "basic",
        front: input.front,
        back: input.back,
        imageUrl: input.imageUrl ?? null,
        audioUrl: input.audioUrl ?? null,
        hints: input.hints ?? [],
        payload: input.payload ?? {},
        displayOrder: input.displayOrder ?? 0,
        overriddenFields: [],
      })
      .returning({ id: tenantCards.id });
    if (!row) throw new Error("Failed to create card.");
    return row.id;
  });

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: AUDIT_ACTIONS.CONTENT_CARD_CREATED,
    metadata: { tenantCardId: newId, tenantDeckId: input.tenantDeckId },
  });

  const cards = await listCardsForDeck(ctx, input.tenantDeckId);
  const result = cards.find((c) => c.id === newId);
  if (!result) throw new ContentNotFoundError("card", newId);
  return result;
}

/* ------------------------------------------------------------------ */
/* PLATFORM ADMIN: edit global rows and fan out recall events          */
/* (These are called from the /admin surface and bypass tenant ctx.)   */
/* ------------------------------------------------------------------ */

export interface GlobalDeckPatch {
  name?: string;
  description?: string | null;
  regionId?: string;
  accessTier?: AccessTier;
  tags?: string[];
  coverImageUrl?: string | null;
  displayOrder?: number;
  isActive?: boolean;
}

export async function updateGlobalDeck(
  globalDeckId: string,
  patch: GlobalDeckPatch,
  actor: { userId: string | null },
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.regionId !== undefined) set.regionId = patch.regionId;
  if (patch.accessTier !== undefined) set.accessTier = patch.accessTier;
  if (patch.tags !== undefined) set.tags = patch.tags;
  if (patch.coverImageUrl !== undefined) set.coverImageUrl = patch.coverImageUrl;
  if (patch.displayOrder !== undefined) set.displayOrder = patch.displayOrder;
  if (patch.isActive !== undefined) set.isActive = patch.isActive;
  set.version = sql`${globalDecks.version} + 1`;

  const [row] = await db
    .update(globalDecks)
    .set(set)
    .where(eq(globalDecks.id, globalDeckId))
    .returning({ id: globalDecks.id, version: globalDecks.version });
  if (!row) throw new ContentNotFoundError("deck", globalDeckId);

  await logAudit({
    tenantId: null,
    userId: actor.userId,
    action: AUDIT_ACTIONS.CONTENT_GLOBAL_DECK_UPDATED,
    metadata: { globalDeckId, fields: Object.keys(patch) },
  });
  await inngest.send({
    name: "content/global.deck-changed",
    data: { globalDeckId, version: row.version },
  });
}

export interface GlobalCardPatch {
  cardType?: CardType;
  front?: string;
  back?: string;
  imageUrl?: string | null;
  audioUrl?: string | null;
  hints?: string[];
  payload?: Record<string, unknown>;
  displayOrder?: number;
  isActive?: boolean;
}

export async function updateGlobalCard(
  globalCardId: string,
  patch: GlobalCardPatch,
  actor: { userId: string | null },
): Promise<void> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.cardType !== undefined) set.cardType = patch.cardType;
  if (patch.front !== undefined) set.front = patch.front;
  if (patch.back !== undefined) set.back = patch.back;
  if (patch.imageUrl !== undefined) set.imageUrl = patch.imageUrl;
  if (patch.audioUrl !== undefined) set.audioUrl = patch.audioUrl;
  if (patch.hints !== undefined) set.hints = patch.hints;
  if (patch.payload !== undefined) set.payload = patch.payload;
  if (patch.displayOrder !== undefined) set.displayOrder = patch.displayOrder;
  if (patch.isActive !== undefined) set.isActive = patch.isActive;
  set.version = sql`${globalCards.version} + 1`;

  const [row] = await db
    .update(globalCards)
    .set(set)
    .where(eq(globalCards.id, globalCardId))
    .returning({ id: globalCards.id, version: globalCards.version });
  if (!row) throw new ContentNotFoundError("card", globalCardId);

  await logAudit({
    tenantId: null,
    userId: actor.userId,
    action: AUDIT_ACTIONS.CONTENT_GLOBAL_CARD_UPDATED,
    metadata: { globalCardId, fields: Object.keys(patch) },
  });
  await inngest.send({
    name: "content/global.card-changed",
    data: { globalCardId, version: row.version },
  });
}
