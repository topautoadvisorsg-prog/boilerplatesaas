/**
 * userService — app user lifecycle, decoupled from Clerk specifics.
 */
import { db } from "@/lib/db";
import { users, tenantMembers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { inngest } from "@/lib/jobs/client";

export interface UpsertUserInput {
  clerkUserId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  isCreate: boolean;
}

export async function upsertUserFromClerk(input: UpsertUserInput): Promise<{ id: string }> {
  const inserted = await db
    .insert(users)
    .values({
      clerkUserId: input.clerkUserId,
      email: input.email,
      name: input.name,
      avatarUrl: input.avatarUrl,
    })
    .onConflictDoUpdate({
      target: users.clerkUserId,
      set: {
        email: input.email,
        name: input.name,
        avatarUrl: input.avatarUrl,
        updatedAt: new Date(),
      },
    })
    .returning({ id: users.id });
  const row = inserted[0];
  if (!row) throw new Error("upsertUserFromClerk: insert returned no rows");

  if (input.isCreate) {
    await inngest.send({ name: "user/welcome.email", data: { userId: row.id } });
  }
  return row;
}

export async function deleteUserByClerkId(clerkUserId: string): Promise<void> {
  await db.delete(users).where(eq(users.clerkUserId, clerkUserId));
}

/**
 * Membership lifecycle from Clerk webhook events. Scoped strictly by (tenantId, userId).
 */
export async function addMembershipByClerk(args: {
  clerkOrgId: string;
  clerkUserId: string;
  role: "admin" | "member";
}): Promise<void> {
  const [tenantRow, userRow] = await Promise.all([
    db.query.tenants.findFirst({
      where: (t, { eq }) => eq(t.clerkOrgId, args.clerkOrgId),
      columns: { id: true },
    }),
    db.query.users.findFirst({
      where: (u, { eq }) => eq(u.clerkUserId, args.clerkUserId),
      columns: { id: true },
    }),
  ]);
  if (!tenantRow || !userRow) return;
  await db
    .insert(tenantMembers)
    .values({ tenantId: tenantRow.id, userId: userRow.id, role: args.role })
    .onConflictDoNothing();
}

export async function removeMembershipByClerk(args: {
  clerkOrgId: string;
  clerkUserId: string;
}): Promise<void> {
  const [tenantRow, userRow] = await Promise.all([
    db.query.tenants.findFirst({
      where: (t, { eq }) => eq(t.clerkOrgId, args.clerkOrgId),
      columns: { id: true },
    }),
    db.query.users.findFirst({
      where: (u, { eq }) => eq(u.clerkUserId, args.clerkUserId),
      columns: { id: true },
    }),
  ]);
  if (!tenantRow || !userRow) return;
  // Scoped by BOTH tenantId AND userId.
  await db
    .delete(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenantId, tenantRow.id),
        eq(tenantMembers.userId, userRow.id),
      ),
    );
}
