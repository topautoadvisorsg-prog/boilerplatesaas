/**
 * regionService — manages the user's selected regions.
 *
 * Architecture:
 *   • `regions` is a GLOBAL catalog (no tenant_id) — every tenant reads from
 *     the same source. A tenant may restrict the visible set via
 *     `tenant_settings.enabled_region_ids` (empty array = all regions).
 *   • `user_regions` is RLS-scoped — each user's selection is private.
 *   • Plan tier dictates the maximum number of active regions
 *     (`PlanLimits.maxActiveRegions`). Free = 1, Pro/Premium = unlimited.
 */
import { db } from "@/lib/db";
import { regions, userRegions, tenantSettings, subscriptions } from "@/lib/db/schema";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { withTenant, type TenantContext } from "@/lib/db/with-tenant";
import { billingConfig, type PlanId } from "@/lib/config/billing";
import { logAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";

export interface RegionRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  parentRegionId: string | null;
  boundingBox: unknown;
  accentColor: string | null;
  displayOrder: number;
}

export interface UserRegionRow extends RegionRow {
  isPrimary: boolean;
}

export class RegionLimitError extends Error {
  constructor(public readonly allowed: number) {
    super(
      allowed === 1
        ? "Your plan allows only 1 active region. Upgrade to add more."
        : `Your plan allows at most ${allowed} active regions.`,
    );
    this.name = "RegionLimitError";
  }
}

/**
 * Returns regions visible to the current tenant — i.e. the global catalog
 * restricted by `tenant_settings.enabled_region_ids` (empty = all).
 */
export async function listAvailableRegions(tenantId: string): Promise<RegionRow[]> {
  const [settings] = await db
    .select({ enabledRegionIds: tenantSettings.enabledRegionIds })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId))
    .limit(1);

  const enabled = (settings?.enabledRegionIds as string[] | null) ?? [];

  const rows = await db
    .select({
      id: regions.id,
      slug: regions.slug,
      name: regions.name,
      description: regions.description,
      parentRegionId: regions.parentRegionId,
      boundingBox: regions.boundingBox,
      accentColor: regions.accentColor,
      displayOrder: regions.displayOrder,
    })
    .from(regions)
    .where(
      enabled.length === 0
        ? eq(regions.isActive, true)
        : and(eq(regions.isActive, true), inArray(regions.id, enabled)),
    )
    .orderBy(asc(regions.displayOrder), asc(regions.name));
  return rows;
}

/**
 * Returns the user's selected regions, joined with the global catalog.
 * `is_primary` is the user's primary-region flag.
 */
export async function getUserRegions(ctx: TenantContext): Promise<UserRegionRow[]> {
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: regions.id,
        slug: regions.slug,
        name: regions.name,
        description: regions.description,
        parentRegionId: regions.parentRegionId,
        boundingBox: regions.boundingBox,
        accentColor: regions.accentColor,
        displayOrder: regions.displayOrder,
        isPrimary: userRegions.isPrimary,
      })
      .from(userRegions)
      .innerJoin(regions, eq(regions.id, userRegions.regionId))
      .where(eq(userRegions.userId, ctx.userId))
      .orderBy(asc(regions.displayOrder));
    return rows;
  });
}

async function getCallerPlan(tenantId: string, userId: string): Promise<PlanId> {
  const [sub] = await db
    .select({ plan: subscriptions.plan, status: subscriptions.status })
    .from(subscriptions)
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.userId, userId)))
    .limit(1);
  if (!sub) return "free";
  // Lapsed users drop to free entitlements for region capacity.
  const lapsed = sub.status === "past_due" || sub.status === "unpaid" || sub.status === "incomplete_expired";
  return lapsed ? "free" : sub.plan;
}

/**
 * Replace the user's region selection in a single transaction.
 *   • Validates every region id exists in the tenant's enabled set.
 *   • Enforces the plan's `maxActiveRegions` limit.
 *   • Promotes exactly one region to primary (caller's choice or first in list).
 */
export async function setUserRegions(
  ctx: TenantContext,
  args: { regionIds: string[]; primaryRegionId?: string | null },
): Promise<UserRegionRow[]> {
  const ids = Array.from(new Set(args.regionIds));
  if (ids.length === 0) throw new Error("At least one region must be selected.");

  // Plan limit
  const plan = await getCallerPlan(ctx.tenantId, ctx.userId);
  const limit = billingConfig[plan].limits.maxActiveRegions;
  if (Number.isFinite(limit) && ids.length > limit) {
    throw new RegionLimitError(limit);
  }

  // Validate against the tenant's enabled set
  const available = await listAvailableRegions(ctx.tenantId);
  const allowedIds = new Set(available.map((r) => r.id));
  const invalid = ids.filter((id) => !allowedIds.has(id));
  if (invalid.length > 0) {
    throw new Error(`Region(s) not available to this workspace: ${invalid.join(", ")}`);
  }

  const primaryId = args.primaryRegionId && ids.includes(args.primaryRegionId)
    ? args.primaryRegionId
    : ids[0]!;

  await withTenant(ctx, async (tx) => {
    // Drop primary flag before swap to avoid partial-unique-index conflicts.
    await tx
      .update(userRegions)
      .set({ isPrimary: false })
      .where(and(eq(userRegions.tenantId, ctx.tenantId), eq(userRegions.userId, ctx.userId)));

    // Remove regions no longer selected.
    await tx
      .delete(userRegions)
      .where(
        and(
          eq(userRegions.tenantId, ctx.tenantId),
          eq(userRegions.userId, ctx.userId),
          sql`region_id NOT IN ${ids}`,
        ),
      );

    // Insert any new regions; ignore duplicates.
    for (const regionId of ids) {
      await tx
        .insert(userRegions)
        .values({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          regionId,
          isPrimary: regionId === primaryId,
        })
        .onConflictDoUpdate({
          target: [userRegions.tenantId, userRegions.userId, userRegions.regionId],
          set: { isPrimary: regionId === primaryId },
        });
    }
  });

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: AUDIT_ACTIONS.REGION_SELECTED,
    metadata: { regionIds: ids, primaryRegionId: primaryId, plan },
  });

  return getUserRegions(ctx);
}

/** Promote one of the user's already-selected regions to primary. */
export async function setPrimaryRegion(ctx: TenantContext, regionId: string): Promise<void> {
  await withTenant(ctx, async (tx) => {
    const [existing] = await tx
      .select({ id: userRegions.id })
      .from(userRegions)
      .where(
        and(
          eq(userRegions.tenantId, ctx.tenantId),
          eq(userRegions.userId, ctx.userId),
          eq(userRegions.regionId, regionId),
        ),
      )
      .limit(1);
    if (!existing) throw new Error("Region must be selected before it can be primary.");

    await tx
      .update(userRegions)
      .set({ isPrimary: false })
      .where(and(eq(userRegions.tenantId, ctx.tenantId), eq(userRegions.userId, ctx.userId)));
    await tx
      .update(userRegions)
      .set({ isPrimary: true })
      .where(eq(userRegions.id, existing.id));
  });

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: AUDIT_ACTIONS.REGION_PRIMARY_CHANGED,
    metadata: { regionId },
  });
}

/** Remove a single region from the user's selection. Caller cannot remove their last region. */
export async function removeUserRegion(ctx: TenantContext, regionId: string): Promise<void> {
  await withTenant(ctx, async (tx) => {
    const remaining = await tx
      .select({ regionId: userRegions.regionId, isPrimary: userRegions.isPrimary })
      .from(userRegions)
      .where(and(eq(userRegions.tenantId, ctx.tenantId), eq(userRegions.userId, ctx.userId)));
    if (remaining.length <= 1) {
      throw new Error("You must keep at least one active region.");
    }
    const wasPrimary = remaining.find((r) => r.regionId === regionId)?.isPrimary ?? false;

    await tx
      .delete(userRegions)
      .where(
        and(
          eq(userRegions.tenantId, ctx.tenantId),
          eq(userRegions.userId, ctx.userId),
          eq(userRegions.regionId, regionId),
        ),
      );

    // Promote a new primary if needed.
    if (wasPrimary) {
      const [next] = remaining.filter((r) => r.regionId !== regionId);
      if (next) {
        await tx
          .update(userRegions)
          .set({ isPrimary: true })
          .where(
            and(
              eq(userRegions.tenantId, ctx.tenantId),
              eq(userRegions.userId, ctx.userId),
              eq(userRegions.regionId, next.regionId),
            ),
          );
      }
    }
  });

  await logAudit({
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    action: AUDIT_ACTIONS.REGION_REMOVED,
    metadata: { regionId },
  });
}

/** Returns the user's primary region, or null if they haven't picked one yet. */
export async function getPrimaryRegion(ctx: TenantContext): Promise<UserRegionRow | null> {
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({
        id: regions.id,
        slug: regions.slug,
        name: regions.name,
        description: regions.description,
        parentRegionId: regions.parentRegionId,
        boundingBox: regions.boundingBox,
        accentColor: regions.accentColor,
        displayOrder: regions.displayOrder,
        isPrimary: userRegions.isPrimary,
      })
      .from(userRegions)
      .innerJoin(regions, eq(regions.id, userRegions.regionId))
      .where(and(eq(userRegions.userId, ctx.userId), eq(userRegions.isPrimary, true)))
      .limit(1);
    return row ?? null;
  });
}
