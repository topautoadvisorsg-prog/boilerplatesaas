"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { tenants, tenantMembers, subscriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireAppUser } from "@/lib/auth/current-user";
import { validateSlugFormat } from "@/lib/tenant";
import { logAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { inngest } from "@/lib/jobs/client";

const CreateOrgSchema = z.object({
  name: z.string().min(2).max(64),
  slug: z.string().min(3).max(32),
});

export async function createOrgAction(formData: FormData): Promise<void> {
  const user = await requireAppUser();
  const parsed = CreateOrgSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");
  }
  const slugCheck = validateSlugFormat(parsed.data.slug);
  if (!slugCheck.ok) throw new Error(slugCheck.reason);

  // Collision check (defense-in-depth; DB unique index is the real guard).
  const [existing] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slugCheck.slug))
    .limit(1);
  if (existing) throw new Error("This slug is already taken.");

  // Create org in Clerk first
  const clerk = await clerkClient();
  const org = await clerk.organizations.createOrganization({
    name: parsed.data.name,
    slug: slugCheck.slug,
    createdBy: user.clerkUserId,
  });

  try {
    await db.transaction(async (tx) => {
      const [tRow] = await tx
        .insert(tenants)
        .values({ clerkOrgId: org.id, name: org.name, slug: slugCheck.slug })
        .returning({ id: tenants.id });
      if (!tRow) throw new Error("Failed to insert tenant");
      await tx
        .insert(tenantMembers)
        .values({ tenantId: tRow.id, userId: user.id, role: "owner" });
      await tx
        .insert(subscriptions)
        .values({ tenantId: tRow.id, plan: "free", status: "active" })
        .onConflictDoNothing({ target: subscriptions.tenantId });
      await logAudit({
        tenantId: tRow.id,
        userId: user.id,
        action: AUDIT_ACTIONS.TENANT_CREATED,
        metadata: { name: parsed.data.name, slug: slugCheck.slug },
      });
      await inngest.send({ name: "tenant/provision", data: { tenantId: tRow.id } });
    });
  } catch (err) {
    // Rollback Clerk side if DB write failed
    await clerk.organizations.deleteOrganization(org.id).catch(() => {});
    throw err;
  }

  const appUrl = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
  appUrl.hostname = `${slugCheck.slug}.${appUrl.hostname}`;
  appUrl.pathname = "/dashboard";
  redirect(appUrl.toString());
}
