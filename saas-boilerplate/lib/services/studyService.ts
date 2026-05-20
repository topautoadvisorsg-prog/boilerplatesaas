/**
 * studyService — Wilderness Intelligence study engine.
 *
 * Responsibilities:
 *   • Open / close study sessions (one active session per user at a time).
 *   • Pull the next card for a user (due reviews first, then new cards).
 *   • Apply a rating: FSRS schedule → optimistic-CAS write → append a
 *     `study_review` row → bump the session's tally.
 *   • Enforce the Free-tier daily card cap (20). Cap is read from the
 *     billing config (`PlanLimits.dailyCardLimit`).
 *
 * Persistence design:
 *   `user_card_state` carries a `version` column; every update writes
 *   `WHERE id = $id AND version = $old`. On mismatch we re-read and
 *   retry once. This protects against double-tap from the UI.
 *
 *   `study_review` is append-only — never updated, never deleted — so
 *   it doubles as an audit trail for the scheduler.
 */
import { db } from "@/lib/db";
import {
  userCardState,
  studySession,
  studyReview,
  globalCards,
  tenantCards,
  tenantDecks,
  subscriptions,
  userRegions,
} from "@/lib/db/schema";
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/lib/db/with-tenant";
import { billingConfig, type PlanId } from "@/lib/config/billing";
import { logAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import {
  emptyState,
  rate as fsrsRate,
  type PersistedCardState,
  type ReviewRating,
} from "@/lib/study/fsrs";
import {
  getDeckForUser,
  listCardsForDeck,
  type ResolvedCard,
} from "./contentService";

/* ------------------------------------------------------------------ */
/* Types & errors                                                      */
/* ------------------------------------------------------------------ */

export interface SessionRow {
  id: string;
  startedAt: Date;
  endedAt: Date | null;
  cardsReviewed: number;
  cardsCorrect: number;
  ratings: Record<ReviewRating, number>;
}

export interface NextCardResult {
  card: ResolvedCard;
  state: PersistedCardState | null; // null = brand new
  cardStateId: string | null;
  dailyUsage: DailyUsage;
}

export interface DailyUsage {
  reviewedToday: number;
  /** Per-day cap; `Infinity` for unlimited plans. */
  limit: number;
  /** Either `limit - reviewedToday` or `Infinity`. */
  remaining: number;
  capped: boolean;
}

export interface RateCardInput {
  sessionId: string;
  /** The id returned in `NextCardResult.card.id`. */
  cardId: string;
  rating: ReviewRating;
  /** Wall-clock ms the user spent on this card. */
  elapsedMs: number;
}

export interface RateCardResult {
  cardStateId: string;
  prevState: string;
  nextState: string;
  due: Date;
  dailyUsage: DailyUsage;
}

export class DailyLimitReachedError extends Error {
  constructor(public readonly limit: number) {
    super(`Daily card limit reached (${limit}). Upgrade for unlimited reviews.`);
    this.name = "DailyLimitReachedError";
  }
}

export class NoActiveSessionError extends Error {
  constructor() {
    super("No active study session.");
    this.name = "NoActiveSessionError";
  }
}

export class StudyConcurrencyError extends Error {
  constructor() {
    super("Card state changed during this review. Refresh and try again.");
    this.name = "StudyConcurrencyError";
  }
}

/* ------------------------------------------------------------------ */
/* Plan + usage helpers                                                */
/* ------------------------------------------------------------------ */

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

/** UTC day boundary — Phase 4 simplification. Phase 9 streak service uses tz. */
function startOfUtcDay(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Read the user's review count for the current UTC day. */
export async function getDailyUsage(ctx: TenantContext): Promise<DailyUsage> {
  const plan = await getCallerPlan(ctx.tenantId, ctx.userId);
  const limit = billingConfig[plan].limits.dailyCardLimit;
  const dayStart = startOfUtcDay();

  const reviewedToday = await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(studyReview)
      .where(
        and(
          eq(studyReview.tenantId, ctx.tenantId),
          eq(studyReview.userId, ctx.userId),
          gte(studyReview.reviewedAt, dayStart),
        ),
      );
    return row?.count ?? 0;
  });

  const remaining = Number.isFinite(limit) ? Math.max(0, limit - reviewedToday) : Infinity;
  return {
    reviewedToday,
    limit,
    remaining,
    capped: remaining === 0,
  };
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

/** Open a new study session OR resume the currently-active one. */
export async function startSession(ctx: TenantContext): Promise<SessionRow> {
  const primaryRegionId = await withTenant(ctx, async (tx) => {
    const [r] = await tx
      .select({ regionId: userRegions.regionId })
      .from(userRegions)
      .where(
        and(
          eq(userRegions.tenantId, ctx.tenantId),
          eq(userRegions.userId, ctx.userId),
          eq(userRegions.isPrimary, true),
        ),
      )
      .limit(1);
    return r?.regionId ?? null;
  });

  const row = await withTenant(ctx, async (tx) => {
    // Resume any active session first.
    const [active] = await tx
      .select()
      .from(studySession)
      .where(
        and(
          eq(studySession.tenantId, ctx.tenantId),
          eq(studySession.userId, ctx.userId),
          isNull(studySession.endedAt),
        ),
      )
      .orderBy(desc(studySession.startedAt))
      .limit(1);
    if (active) return active;

    const [inserted] = await tx
      .insert(studySession)
      .values({ tenantId: ctx.tenantId, userId: ctx.userId, regionId: primaryRegionId })
      .returning();
    if (!inserted) throw new Error("Failed to start session.");
    return inserted;
  });

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: AUDIT_ACTIONS.STUDY_SESSION_STARTED,
    metadata: { sessionId: row.id, regionId: primaryRegionId },
  });
  return toSessionRow(row);
}

/** Close the active session. Idempotent if already closed. */
export async function endSession(ctx: TenantContext, sessionId: string): Promise<SessionRow> {
  const row = await withTenant(ctx, async (tx) => {
    const [existing] = await tx
      .select()
      .from(studySession)
      .where(
        and(
          eq(studySession.id, sessionId),
          eq(studySession.tenantId, ctx.tenantId),
          eq(studySession.userId, ctx.userId),
        ),
      )
      .limit(1);
    if (!existing) throw new NoActiveSessionError();
    if (existing.endedAt) return existing;

    const [updated] = await tx
      .update(studySession)
      .set({ endedAt: new Date() })
      .where(eq(studySession.id, sessionId))
      .returning();
    return updated ?? existing;
  });
  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: AUDIT_ACTIONS.STUDY_SESSION_ENDED,
    metadata: {
      sessionId: row.id,
      cardsReviewed: row.cardsReviewed,
      cardsCorrect: row.cardsCorrect,
    },
  });
  return toSessionRow(row);
}

/* ------------------------------------------------------------------ */
/* Next-card pick                                                      */
/* ------------------------------------------------------------------ */

/**
 * Resolve the next card for the user from a given deck. Order:
 *   1. Cards already in `user_card_state` whose `due <= now` (oldest first).
 *   2. Cards in the deck not yet seen — pick by `displayOrder`.
 *
 * Returns `null` (via `card: undefined`-like shape) is not possible — we
 * always return a card unless the deck is empty, in which case we throw.
 */
export async function getNextCardForDeck(
  ctx: TenantContext,
  deckId: string,
): Promise<NextCardResult> {
  const dailyUsage = await getDailyUsage(ctx);
  if (dailyUsage.capped) throw new DailyLimitReachedError(dailyUsage.limit);

  const cards = await listCardsForDeck(ctx, deckId);
  if (cards.length === 0) throw new Error("Deck has no cards.");

  // 1) Are any of these cards already due?
  const cardIds = cards.map((c) => c.id);
  const now = new Date();
  const dueStates = await withTenant(ctx, async (tx) => {
    return tx
      .select()
      .from(userCardState)
      .where(
        and(
          eq(userCardState.tenantId, ctx.tenantId),
          eq(userCardState.userId, ctx.userId),
          inArray(userCardState.cardRef, cardIds),
          lte(userCardState.due, now),
        ),
      )
      .orderBy(asc(userCardState.due))
      .limit(1);
  });

  if (dueStates[0]) {
    const state = dueStates[0];
    const card = cards.find((c) => c.id === state.cardRef);
    if (!card) throw new Error("Due card resolved to missing content row.");
    return {
      card,
      state: toPersistedState(state),
      cardStateId: state.id,
      dailyUsage,
    };
  }

  // 2) Pick the lowest-display-order card without state yet.
  const seenIds = await withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({ cardRef: userCardState.cardRef })
      .from(userCardState)
      .where(
        and(
          eq(userCardState.tenantId, ctx.tenantId),
          eq(userCardState.userId, ctx.userId),
          inArray(userCardState.cardRef, cardIds),
        ),
      );
    return new Set(rows.map((r) => r.cardRef));
  });

  const next = cards.find((c) => !seenIds.has(c.id));
  if (!next) {
    // Everything in this deck has state but nothing is due yet.
    throw new Error("No cards due. Come back later.");
  }
  return { card: next, state: null, cardStateId: null, dailyUsage };
}

/* ------------------------------------------------------------------ */
/* Rate (the hot path)                                                 */
/* ------------------------------------------------------------------ */

/** Pull the deck context implied by a card id so we can verify access. */
async function findCardLineage(
  ctx: TenantContext,
  cardId: string,
): Promise<{ source: "global" | "tenant"; globalCardId: string | null; deckId: string }> {
  // Try tenant first (RLS-scoped).
  const tenantHit = await withTenant(ctx, async (tx) => {
    const [t] = await tx
      .select({
        id: tenantCards.id,
        globalCardId: tenantCards.globalCardId,
        deckId: tenantCards.tenantDeckId,
      })
      .from(tenantCards)
      .where(eq(tenantCards.id, cardId))
      .limit(1);
    return t ?? null;
  });
  if (tenantHit) {
    return {
      source: "tenant",
      globalCardId: tenantHit.globalCardId,
      deckId: tenantHit.deckId,
    };
  }

  const [g] = await db
    .select({ id: globalCards.id, deckId: globalCards.globalDeckId })
    .from(globalCards)
    .where(eq(globalCards.id, cardId))
    .limit(1);
  if (!g) throw new Error("Card not found.");
  return { source: "global", globalCardId: g.id, deckId: g.deckId };
}

/**
 * Apply a rating. Single retry on optimistic-lock conflict.
 */
export async function rateCard(
  ctx: TenantContext,
  input: RateCardInput,
): Promise<RateCardResult> {
  // Daily cap
  const usageBefore = await getDailyUsage(ctx);
  if (usageBefore.capped) {
    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: AUDIT_ACTIONS.STUDY_DAILY_LIMIT_HIT,
      metadata: { limit: usageBefore.limit },
    });
    throw new DailyLimitReachedError(usageBefore.limit);
  }

  // Resolve lineage so we can confirm deck access and infer globalCardId.
  const lineage = await findCardLineage(ctx, input.cardId);
  // Confirm the user can access the parent deck (this also runs the plan-tier gate).
  await getDeckForUser(ctx, lineage.deckId);

  let attempt = 0;
  while (attempt < 2) {
    attempt += 1;
    const result = await attemptRate(ctx, input, lineage);
    if (result) {
      const usageAfter = { ...usageBefore, reviewedToday: usageBefore.reviewedToday + 1 };
      usageAfter.remaining = Number.isFinite(usageAfter.limit)
        ? Math.max(0, usageAfter.limit - usageAfter.reviewedToday)
        : Infinity;
      usageAfter.capped = usageAfter.remaining === 0;

      await logAudit({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: AUDIT_ACTIONS.STUDY_CARD_RATED,
        metadata: {
          sessionId: input.sessionId,
          cardId: input.cardId,
          rating: input.rating,
          prevState: result.prevState,
          nextState: result.nextState,
        },
      });
      return { ...result, dailyUsage: usageAfter };
    }
  }
  throw new StudyConcurrencyError();
}

/**
 * One rating attempt — returns null on optimistic-lock conflict so the
 * caller can retry once.
 */
async function attemptRate(
  ctx: TenantContext,
  input: Omit<RateCardInput, "elapsedMs"> & { elapsedMs: number },
  lineage: { source: "global" | "tenant"; globalCardId: string | null; deckId: string },
): Promise<Omit<RateCardResult, "dailyUsage"> | null> {
  return withTenant(ctx, async (tx) => {
    // Verify session is active.
    const [session] = await tx
      .select({ id: studySession.id, endedAt: studySession.endedAt })
      .from(studySession)
      .where(
        and(
          eq(studySession.id, input.sessionId),
          eq(studySession.tenantId, ctx.tenantId),
          eq(studySession.userId, ctx.userId),
        ),
      )
      .limit(1);
    if (!session) throw new NoActiveSessionError();
    if (session.endedAt) throw new NoActiveSessionError();

    // Load (or initialise) the card state.
    const [existing] = await tx
      .select()
      .from(userCardState)
      .where(
        and(
          eq(userCardState.tenantId, ctx.tenantId),
          eq(userCardState.userId, ctx.userId),
          eq(userCardState.cardRef, input.cardId),
        ),
      )
      .limit(1);

    const now = new Date();
    const current = existing ? toPersistedState(existing) : emptyState(now);
    const out = fsrsRate(current, input.rating, now);

    let cardStateId: string;
    if (existing) {
      // Optimistic CAS.
      const [updated] = await tx
        .update(userCardState)
        .set({
          state: out.next.state,
          due: out.next.due,
          stability: out.next.stability,
          difficulty: out.next.difficulty,
          elapsedDays: out.next.elapsedDays,
          scheduledDays: out.next.scheduledDays,
          learningSteps: out.next.learningSteps,
          reps: out.next.reps,
          lapses: out.next.lapses,
          lastReview: out.next.lastReview,
          version: existing.version + 1,
          updatedAt: now,
        })
        .where(and(eq(userCardState.id, existing.id), eq(userCardState.version, existing.version)))
        .returning({ id: userCardState.id });
      if (!updated) {
        // Lost race — let caller retry once.
        return null;
      }
      cardStateId = updated.id;
    } else {
      const [inserted] = await tx
        .insert(userCardState)
        .values({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          cardRef: input.cardId,
          cardSource: lineage.source,
          globalCardId: lineage.globalCardId,
          state: out.next.state,
          due: out.next.due,
          stability: out.next.stability,
          difficulty: out.next.difficulty,
          elapsedDays: out.next.elapsedDays,
          scheduledDays: out.next.scheduledDays,
          learningSteps: out.next.learningSteps,
          reps: out.next.reps,
          lapses: out.next.lapses,
          lastReview: out.next.lastReview,
          version: 1,
        })
        .returning({ id: userCardState.id });
      if (!inserted) throw new Error("Failed to insert card state.");
      cardStateId = inserted.id;
    }

    // Append the review log.
    await tx.insert(studyReview).values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      sessionId: input.sessionId,
      cardStateId,
      rating: input.rating,
      prevState: out.prevState,
      nextState: out.next.state,
      elapsedMs: input.elapsedMs,
      reviewedAt: now,
    });

    // Bump session tallies.
    const ratingKey = input.rating;
    const wasCorrect = input.rating !== "again";
    await tx
      .update(studySession)
      .set({
        cardsReviewed: sql`${studySession.cardsReviewed} + 1`,
        cardsCorrect: sql`${studySession.cardsCorrect} + ${wasCorrect ? 1 : 0}`,
        ratings: sql`jsonb_set(${studySession.ratings}, ${`{${ratingKey}}`},
          to_jsonb(COALESCE((${studySession.ratings} ->> ${ratingKey})::int, 0) + 1))`,
      })
      .where(eq(studySession.id, input.sessionId));

    return {
      cardStateId,
      prevState: out.prevState,
      nextState: out.next.state,
      due: out.next.due,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Internal helpers                                                    */
/* ------------------------------------------------------------------ */

function toPersistedState(row: typeof userCardState.$inferSelect): PersistedCardState {
  return {
    state: row.state,
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsedDays,
    scheduledDays: row.scheduledDays,
    learningSteps: row.learningSteps,
    reps: row.reps,
    lapses: row.lapses,
    lastReview: row.lastReview,
  };
}

function toSessionRow(row: typeof studySession.$inferSelect): SessionRow {
  return {
    id: row.id,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
    cardsReviewed: row.cardsReviewed,
    cardsCorrect: row.cardsCorrect,
    ratings: (row.ratings as Record<ReviewRating, number> | null) ?? {
      again: 0,
      hard: 0,
      good: 0,
      easy: 0,
    },
  };
}

// Silence unused-import warnings while keeping the helpers in scope for
// future endpoints (filter-by-archived, lookups against tenant_decks).
void tenantDecks;
void lt;
