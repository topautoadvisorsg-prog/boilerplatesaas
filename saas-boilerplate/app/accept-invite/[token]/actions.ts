"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { invitations, tenantMembers, tenants } from "@/lib/db/schema";
import { and, eq, isNull, gt } from "drizzle-orm";
import { requireAppUser } from "@/lib/auth/current-user";
import { logAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";

export async function acceptInviteAction(token: string): Promise<void> {
  const user = await requireAppUser();

  const [inv] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.token, token),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!inv) throw new Error("Invitation is invalid, expired, or already used.");
  if (inv.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new Error("This invitation is for a different email address.");
  }

  const [tenant] = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, inv.tenantId))
    .limit(1);
  if (!tenant) throw new Error("Workspace no longer exists.");

  await db.transaction(async (tx) => {
    await tx
      .insert(tenantMembers)
      .values({ tenantId: tenant.id, userId: user.id, role: inv.role })
      .onConflictDoNothing();
    await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(invitations.id, inv.id));
  });

  await logAudit({
    tenantId: tenant.id,
    userId: user.id,
    action: AUDIT_ACTIONS.MEMBER_INVITE_ACCEPTED,
    metadata: { invitationId: inv.id },
  });

  const appUrl = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
  appUrl.hostname = `${tenant.slug}.${appUrl.hostname}`;
  appUrl.pathname = "/dashboard";
  redirect(appUrl.toString());
}
