"use server";

import { z } from "zod";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAppUser } from "@/lib/auth/current-user";
import { resolveTenantForUser, withTenant } from "@/lib/db/with-tenant";
import { invitations, tenantMembers } from "@/lib/db/schema";
import { and, eq, gt } from "drizzle-orm";
import { generateInviteToken } from "@/lib/utils";
import { checkInviteRateLimit } from "@/lib/rate-limit";
import { inngest } from "@/lib/jobs/client";
import { logAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";

const InviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]),
});

async function tenantCtx() {
  const slug = (await headers()).get("x-tenant-slug");
  if (!slug) throw new Error("No tenant context");
  const user = await requireAppUser();
  return { ctx: await resolveTenantForUser(slug, user.id), user };
}

export async function inviteMemberAction(formData: FormData): Promise<void> {
  const { ctx, user } = await tenantCtx();
  if (ctx.role === "member") throw new Error("Forbidden");

  const parsed = InviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) throw new Error("Invalid input");

  await checkInviteRateLimit(ctx.tenantId);

  await withTenant(ctx, async (tx) => {
    const token = generateInviteToken();
    const expiresAt = new Date(Date.now() + 7 * 86400 * 1000);

    const [inv] = await tx
      .insert(invitations)
      .values({
        tenantId: ctx.tenantId,
        email: parsed.data.email.toLowerCase(),
        role: parsed.data.role,
        token,
        invitedById: user.id,
        expiresAt,
      })
      .returning({ id: invitations.id });

    if (inv) {
      await inngest.send({ name: "team/invite.email", data: { invitationId: inv.id } });
      await logAudit({
        tenantId: ctx.tenantId,
        userId: user.id,
        action: AUDIT_ACTIONS.MEMBER_INVITED,
        metadata: { email: parsed.data.email, role: parsed.data.role },
      });
    }
  });

  revalidatePath("/team");
}

export async function removeMemberAction(memberId: string): Promise<void> {
  const { ctx, user } = await tenantCtx();
  if (ctx.role === "member") throw new Error("Forbidden");

  await withTenant(ctx, async (tx) => {
    // Prevent removing the last owner
    const [member] = await tx
      .select({ role: tenantMembers.role, userId: tenantMembers.userId })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.id, memberId), eq(tenantMembers.tenantId, ctx.tenantId)))
      .limit(1);
    if (!member) throw new Error("Member not found");

    if (member.role === "owner") {
      throw new Error("Cannot remove the workspace owner. Transfer ownership first.");
    }
    if (member.userId === user.id) {
      throw new Error("Use 'Leave workspace' to remove yourself.");
    }

    await tx
      .delete(tenantMembers)
      .where(and(eq(tenantMembers.id, memberId), eq(tenantMembers.tenantId, ctx.tenantId)));

    await logAudit({
      tenantId: ctx.tenantId,
      userId: user.id,
      action: AUDIT_ACTIONS.MEMBER_REMOVED,
      metadata: { memberId },
    });
  });

  revalidatePath("/team");
}

// Silence unused `gt`; reserved for future filters.
void gt;
