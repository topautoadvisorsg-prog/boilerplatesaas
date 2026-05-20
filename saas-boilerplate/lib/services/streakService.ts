/**
 * streakService — reconciles each user's `streak_count` + `last_study_date`
 * using *their own* timezone, not naive UTC.
 *
 * Why a nightly cron and not on every `rateCard`?
 *   - Per-review streak bumps require a tz-aware "did I review yesterday?"
 *     check on every hot-path call. Cheap to defer to a cron.
 *   - The cron is idempotent; running it twice is a no-op.
 *
 * Streak rules (locked):
 *   - Reviewed today in your local tz → streak += 1 if last_study_date was
 *     yesterday in your local tz; streak stays at 1 if last_study_date is
 *     today; resets to 1 if last_study_date is older than yesterday.
 *   - No reviews yesterday OR today → streak resets to 0.
 *   - "Day" is interpreted in the user's `timezone` column (IANA tz id).
 */
import { db } from "@/lib/db";
import { studyReview, users } from "@/lib/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { logAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import type { AuditAction } from "@/lib/audit/actions";

export interface StreakOutcome {
  userId: string;
  prevStreak: number;
  nextStreak: number;
  reviewedToday: boolean;
  reviewedYesterday: boolean;
}

/**
 * Compute "local day" (YYYY-MM-DD) for a given Date in the user's tz.
 * Uses `Intl.DateTimeFormat` so it works for every IANA zone Node supports.
 */
function localDate(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${day}`;
}

/** ISO date string (YYYY-MM-DD) minus one day. */
function yesterday(localToday: string): string {
  const d = new Date(`${localToday}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Reconcile a single user's streak. Safe to call any number of times.
 */
export async function reconcileStreak(userId: string): Promise<StreakOutcome | null> {
  const [user] = await db
    .select({
      id: users.id,
      timezone: users.timezone,
      streakCount: users.streakCount,
      lastStudyDate: users.lastStudyDate,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return null;

  const tz = user.timezone || "UTC";
  const now = new Date();
  const today = localDate(now, tz);
  const ystd = yesterday(today);

  // Did they review today / yesterday (in their own tz)?
  // We query a 48-hour UTC window, then bucket by local day in JS.
  const windowStart = new Date(now);
  windowStart.setUTCHours(0, 0, 0, 0);
  windowStart.setUTCDate(windowStart.getUTCDate() - 2);

  const rows = await db
    .select({ reviewedAt: studyReview.reviewedAt })
    .from(studyReview)
    .where(and(eq(studyReview.userId, userId), gte(studyReview.reviewedAt, windowStart)));

  let reviewedToday = false;
  let reviewedYesterday = false;
  for (const r of rows) {
    const day = localDate(r.reviewedAt, tz);
    if (day === today) reviewedToday = true;
    else if (day === ystd) reviewedYesterday = true;
    if (reviewedToday && reviewedYesterday) break;
  }

  const prev = user.streakCount;
  let next = prev;
  let auditAction: AuditAction | null = null;

  if (reviewedToday) {
    if (user.lastStudyDate && localDate(user.lastStudyDate, tz) === today) {
      // Already counted today.
      next = prev;
    } else if (reviewedYesterday || (user.lastStudyDate && localDate(user.lastStudyDate, tz) === ystd)) {
      next = prev + 1;
      auditAction = AUDIT_ACTIONS.STREAK_INCREMENTED;
    } else {
      next = 1;
      auditAction = AUDIT_ACTIONS.STREAK_INCREMENTED;
    }
  } else if (prev > 0 && !reviewedYesterday) {
    next = 0;
    auditAction = AUDIT_ACTIONS.STREAK_BROKEN;
  }

  // Persist only if something changed (or if today's review needs `last_study_date` set).
  const newLastStudyDate = reviewedToday ? now : user.lastStudyDate;
  if (next !== prev || (reviewedToday && (!user.lastStudyDate || localDate(user.lastStudyDate, tz) !== today))) {
    await db
      .update(users)
      .set({
        streakCount: next,
        lastStudyDate: newLastStudyDate ?? null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  if (auditAction) {
    await logAudit({
      tenantId: null,
      userId,
      action: auditAction,
      metadata: { prev, next, tz, today, reviewedToday, reviewedYesterday },
    });
  }

  return { userId, prevStreak: prev, nextStreak: next, reviewedToday, reviewedYesterday };
}

/**
 * Return user ids that may need reconciliation today: anyone who either
 *   - has a non-zero streak (needs to be broken if no review yesterday/today)
 *   - reviewed in the last 36 hours (needs to be bumped)
 *
 * 36 hours is a generous window that covers any IANA timezone offset.
 */
export async function listUsersNeedingReconcile(): Promise<string[]> {
  const cutoff = new Date(Date.now() - 36 * 60 * 60 * 1000);
  const rows = await db.execute<{ user_id: string }>(sql`
    SELECT DISTINCT user_id FROM (
      SELECT id AS user_id FROM users WHERE streak_count > 0
      UNION
      SELECT user_id FROM study_review WHERE reviewed_at >= ${cutoff}
    ) AS u
  `);
  return rows.rows.map((r) => r.user_id);
}
