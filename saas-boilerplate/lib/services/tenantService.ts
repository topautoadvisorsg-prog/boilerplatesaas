/**
 * tenantService — all business logic around tenant (organization) lifecycle.
 *
 * Server actions and webhook handlers MUST go through these functions rather
 * than touching the DB directly. This keeps tenant rules in one place.
 */
import { db } from "@/lib/db";
import { tenants, tenantMembers, subscriptions, tenantSettings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { validateSlugFormat } from "@/lib/tenant";
import { clerkClient } from "@clerk/nextjs/server";
import { logAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { inngest } from "@/lib/jobs/client";

export interface CreateTenantInput {
  name: string;
  slug: string;
  ownerUserId: string;
  ownerClerkUserId: string;
}

export interface CreatedTenant {
  id: string;
  slug: string;
  clerkOrgId: string;
}

/**
 * Create a tenant in Clerk + DB atomically. On DB failure, Clerk org is rolled back.
 * Validates slug, checks collision, seeds free subscription, audits, dispatches provision job.
 */
export async function createTenant(input: CreateTenantInput): Promise<CreatedTenant> {
  const check = validateSlugFormat(input.slug);
  if (!check.ok) throw new Error(check.reason);

  const [existing] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, check.slug))
    .limit(1);
  if (existing) throw new Error("This slug is already taken.");

  const clerk = await clerkClient();
  const org = await clerk.organizations.createOrganization({
    name: input.name,
    slug: check.slug,
    createdBy: input.ownerClerkUserId,
  });

  try {
    const tenantId = await db.transaction(async (tx) => {
      const [tRow] = await tx
        .insert(tenants)
        .values({ clerkOrgId: org.id, name: org.name, slug: check.slug })
        .returning({ id: tenants.id });
      if (!tRow) throw new Error("Failed to insert tenant");
      await tx
        .insert(tenantMembers)
        .values({ tenantId: tRow.id, userId: input.ownerUserId, role: "owner" });
      // Seed the owner's free subscription (user-scoped).
      await tx
        .insert(subscriptions)
        .values({ tenantId: tRow.id, userId: input.ownerUserId, plan: "free", status: "active" })
        .onConflictDoNothing({ target: [subscriptions.tenantId, subscriptions.userId] });
      // Seed default tenant_settings row.
      await tx
        .insert(tenantSettings)
        .values({ tenantId: tRow.id })
        .onConflictDoNothing({ target: tenantSettings.tenantId });
      return tRow.id;
    });
    await logAudit({
      tenantId,
      userId: input.ownerUserId,
      action: AUDIT_ACTIONS.TENANT_CREATED,
      metadata: { name: input.name, slug: check.slug },
    });
    await inngest.send({ name: "tenant/provision", data: { tenantId } });
    return { id: tenantId, slug: check.slug, clerkOrgId: org.id };
  } catch (err) {
    await clerk.organizations.deleteOrganization(org.id).catch(() => {});
    throw err;
  }
}

/**
 * Upsert a tenant from a Clerk webhook event. Idempotent via `clerk_org_id` unique index.
 */
export async function upsertTenantFromClerk(args: {
  clerkOrgId: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  isCreate: boolean;
}): Promise<{ id: string } | null> {
  const inserted = await db
    .insert(tenants)
    .values({
      clerkOrgId: args.clerkOrgId,
      name: args.name,
      slug: args.slug,
      logoUrl: args.logoUrl,
    })
    .onConflictDoUpdate({
      target: tenants.clerkOrgId,
      set: { name: args.name, slug: args.slug, logoUrl: args.logoUrl, updatedAt: new Date() },
    })
    .returning({ id: tenants.id });
  const row = inserted[0] ?? null;
  if (row && args.isCreate) {
    await inngest.send({ name: "tenant/provision", data: { tenantId: row.id } });
    await logAudit({
      tenantId: row.id,
      userId: null,
      action: AUDIT_ACTIONS.TENANT_CREATED,
      metadata: { source: "clerk" },
    });
  }
  return row;
}
