/**
 * inviteService — invite lifecycle, rate-limited and tenant-scoped.
 */
import { z } from "zod";
import { invitations, tenantMembers, tenants } from "@/lib/db/schema";
import { and, eq, isNull, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { withTenant, type TenantContext } from "@/lib/db/with-tenant";
import { generateInviteToken } from "@/lib/utils";
import { checkInviteRateLimit } from "@/lib/rate-limit";
import { inngest } from "@/lib/jobs/client";
import { logAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { features } from "@/lib/config/features";

export const InviteInputSchema = z.object({
  email: z.string().email(),
  role: z.enum(["admin", "member"]),
});

export type InviteInput = z.infer<typeof InviteInputSchema>;

const INVITE_TTL_DAYS = 7;

export async function createInvite(ctx: TenantContext, raw: unknown): Promise<{ id: string }> {
  if (!features.invitesEnabled) throw new Error("Invites are disabled for this deployment.");
  if (ctx.role === "member") throw new Error("Forbidden");

  const parsed = InviteInputSchema.parse(raw);
  await checkInviteRateLimit(ctx.tenantId);

  return withTenant(ctx, async (tx) => {
    const token = generateInviteToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86400 * 1000);
    const [inv] = await tx
      .insert(invitations)
      .values({
        tenantId: ctx.tenantId,
        email: parsed.email.toLowerCase(),
        role: parsed.role,
        token,
        invitedById: ctx.userId,
        expiresAt,
      })
      .returning({ id: invitations.id });
    if (!inv) throw new Error("Failed to create invite");

    await inngest.send({ name: "team/invite.email", data: { invitationId: inv.id } });
    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: AUDIT_ACTIONS.MEMBER_INVITED,
      metadata: { email: parsed.email, role: parsed.role },
    });
    return { id: inv.id };
  });
}

export async function removeMember(ctx: TenantContext, memberId: string): Promise<void> {
  if (ctx.role === "member") throw new Error("Forbidden");
  await withTenant(ctx, async (tx) => {
    const [member] = await tx
      .select({ role: tenantMembers.role, userId: tenantMembers.userId })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.id, memberId), eq(tenantMembers.tenantId, ctx.tenantId)))
      .limit(1);
    if (!member) throw new Error("Member not found");
    if (member.role === "owner") {
      throw new Error("Cannot remove the workspace owner. Transfer ownership first.");
    }
    if (member.userId === ctx.userId) {
      throw new Error("Use 'Leave workspace' to remove yourself.");
    }
    await tx
      .delete(tenantMembers)
      .where(and(eq(tenantMembers.id, memberId), eq(tenantMembers.tenantId, ctx.tenantId)));
    await logAudit({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: AUDIT_ACTIONS.MEMBER_REMOVED,
      metadata: { memberId },
    });
  });
}

/**
 * Accept an invite. Validates token, expiry, and email match.
 * Returns the tenant slug for post-accept redirect.
 */
export async function acceptInvite(args: {
  token: string;
  acceptingUserId: string;
  acceptingEmail: string;
}): Promise<{ tenantSlug: string }> {
  const [inv] = await db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.token, args.token),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!inv) throw new Error("Invitation is invalid, expired, or already used.");
  if (inv.email.toLowerCase() !== args.acceptingEmail.toLowerCase()) {
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
      .values({ tenantId: tenant.id, userId: args.acceptingUserId, role: inv.role })
      .onConflictDoNothing();
    await tx
      .update(invitations)
      .set({ acceptedAt: new Date() })
      .where(eq(invitations.id, inv.id));
  });

  await logAudit({
    tenantId: tenant.id,
    userId: args.acceptingUserId,
    action: AUDIT_ACTIONS.MEMBER_INVITE_ACCEPTED,
    metadata: { invitationId: inv.id },
  });
  return { tenantSlug: tenant.slug };
}
