import { headers } from "next/headers";
import { requireAppUser } from "@/lib/auth/current-user";
import { resolveTenantForUser, withTenant } from "@/lib/db/with-tenant";
import { tenantMembers, users, invitations } from "@/lib/db/schema";
import { eq, isNull, and, gt } from "drizzle-orm";
import { features } from "@/lib/config/features";
import { inviteMemberAction, removeMemberAction } from "./actions";

export default async function TeamPage() {
  const slug = (await headers()).get("x-tenant-slug")!;
  const user = await requireAppUser();
  const ctx = await resolveTenantForUser(slug, user.id);

  const data = await withTenant(ctx, async (tx) => {
    const members = await tx
      .select({
        id: tenantMembers.id,
        userId: users.id,
        email: users.email,
        name: users.name,
        role: tenantMembers.role,
        joinedAt: tenantMembers.joinedAt,
      })
      .from(tenantMembers)
      .innerJoin(users, eq(users.id, tenantMembers.userId))
      .where(eq(tenantMembers.tenantId, ctx.tenantId));

    const pending = await tx
      .select({ id: invitations.id, email: invitations.email, role: invitations.role, expiresAt: invitations.expiresAt })
      .from(invitations)
      .where(
        and(
          eq(invitations.tenantId, ctx.tenantId),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      );

    return { members, pending };
  });

  const canInvite = ctx.role !== "member" && features.invitesEnabled;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Team</h1>

      {canInvite && (
        <form action={inviteMemberAction} className="flex gap-2 items-end bg-[var(--color-card)] p-4 rounded-lg border">
          <label className="flex-1">
            <span className="text-xs text-[var(--color-muted)]">Email</span>
            <input name="email" type="email" required className="mt-1 w-full bg-transparent border rounded-md px-3 py-2" />
          </label>
          <label>
            <span className="text-xs text-[var(--color-muted)]">Role</span>
            <select name="role" defaultValue="member" className="mt-1 bg-transparent border rounded-md px-3 py-2">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button type="submit" className="px-4 py-2 rounded-md bg-[var(--color-accent)] text-black font-medium">
            Invite
          </button>
        </form>
      )}

      <section>
        <h2 className="text-sm uppercase tracking-wide text-[var(--color-muted)] mb-3">Members</h2>
        <ul className="divide-y border rounded-lg overflow-hidden">
          {data.members.map((m) => (
            <li key={m.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div>{m.name ?? m.email}</div>
                <div className="text-xs text-[var(--color-muted)]">{m.email} · {m.role}</div>
              </div>
              {canInvite && m.role !== "owner" && m.userId !== user.id && (
                <form action={removeMemberAction.bind(null, m.id)}>
                  <button className="text-xs text-red-400 hover:underline">Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>

      {data.pending.length > 0 && (
        <section>
          <h2 className="text-sm uppercase tracking-wide text-[var(--color-muted)] mb-3">Pending invitations</h2>
          <ul className="divide-y border rounded-lg overflow-hidden">
            {data.pending.map((i) => (
              <li key={i.id} className="px-4 py-3 text-sm flex justify-between">
                <span>{i.email} · {i.role}</span>
                <span className="text-[var(--color-muted)]">expires {i.expiresAt.toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
