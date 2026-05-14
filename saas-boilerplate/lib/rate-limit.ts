/**
 * Invite rate limit — 10 invites per tenant per rolling hour.
 * Postgres-backed (no Redis dependency).
 */
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

const WINDOW_MS = 60 * 60 * 1000; // 1 hour
const MAX_PER_WINDOW = 10;

export class RateLimitError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Rate limit exceeded. Retry after ${retryAfterSeconds}s.`);
    this.name = "RateLimitError";
  }
}

/**
 * Atomically check & increment. Throws RateLimitError if the bucket is full.
 */
export async function checkInviteRateLimit(tenantId: string): Promise<void> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - WINDOW_MS);

  // Upsert + atomic increment using ON CONFLICT.
  const result = await db.execute<{ count: number; window_start: Date }>(sql`
    INSERT INTO invite_rate_limit (tenant_id, window_start, count)
    VALUES (${tenantId}, ${now.toISOString()}, 1)
    ON CONFLICT (tenant_id) DO UPDATE
      SET
        window_start = CASE
          WHEN invite_rate_limit.window_start < ${windowStart.toISOString()}
          THEN EXCLUDED.window_start
          ELSE invite_rate_limit.window_start
        END,
        count = CASE
          WHEN invite_rate_limit.window_start < ${windowStart.toISOString()}
          THEN 1
          ELSE invite_rate_limit.count + 1
        END
    RETURNING count, window_start;
  `);

  const row = result.rows[0];
  if (!row) return;
  if (row.count > MAX_PER_WINDOW) {
    const elapsed = now.getTime() - new Date(row.window_start).getTime();
    const retryAfter = Math.ceil((WINDOW_MS - elapsed) / 1000);
    throw new RateLimitError(retryAfter);
  }
}
