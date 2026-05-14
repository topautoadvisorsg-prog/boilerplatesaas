import { db } from "@/lib/db";
import { tenants, subscriptions, tenantMembers, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { logAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { requireInternalAdmin } from "@/lib/auth/admin";

export default async function AdminTenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const adminUserId = await requireInternalAdmin();
  const { id } = await params;

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  if (!tenant) notFound();

  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, id)).limit(1);
  const members = await db
    .select({ email: users.email, name: users.name, role: tenantMembers.role })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(eq(tenantMembers.tenantId, id));

  await logAudit({
    tenantId: id,
    userId: null,
    action: AUDIT_ACTIONS.ADMIN_TENANT_ACCESSED,
    metadata: { adminClerkUserId: adminUserId },
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{tenant.name}</h1>
      <div className="text-sm text-[var(--color-muted)]">slug: {tenant.slug}</div>

      <section>
        <h2 className="font-medium mb-2">Subscription</h2>
        <pre className="text-xs bg-[var(--color-card)] border rounded p-3 overflow-auto">
          {JSON.stringify(sub ?? null, null, 2)}
        </pre>
      </section>

      <section>
        <h2 className="font-medium mb-2">Members</h2>
        <ul className="text-sm space-y-1">
          {members.map((m) => (
            <li key={m.email}>
              {m.name ?? m.email} <span className="text-[var(--color-muted)]">· {m.role}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
