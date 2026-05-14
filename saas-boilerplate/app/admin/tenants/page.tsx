import { db } from "@/lib/db";
import { tenants, subscriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import Link from "next/link";

export default async function AdminTenantsPage() {
  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      plan: subscriptions.plan,
      status: subscriptions.status,
      createdAt: tenants.createdAt,
    })
    .from(tenants)
    .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .orderBy(tenants.createdAt);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Tenants</h1>
      <table className="w-full text-sm border rounded-lg overflow-hidden">
        <thead className="bg-[var(--color-card)] text-left text-[var(--color-muted)]">
          <tr>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Slug</th>
            <th className="px-4 py-2">Plan</th>
            <th className="px-4 py-2">Status</th>
            <th className="px-4 py-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="px-4 py-2">
                <Link className="underline" href={`/admin/tenants/${r.id}`}>{r.name}</Link>
              </td>
              <td className="px-4 py-2">{r.slug}</td>
              <td className="px-4 py-2 uppercase">{r.plan ?? "—"}</td>
              <td className="px-4 py-2">{r.status ?? "—"}</td>
              <td className="px-4 py-2">{r.createdAt.toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
