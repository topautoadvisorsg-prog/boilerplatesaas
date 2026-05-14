import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";

export default async function AdminUsersPage() {
  const rows = await db.select().from(users).orderBy(users.createdAt);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Users</h1>
      <table className="w-full text-sm border rounded-lg overflow-hidden">
        <thead className="bg-[var(--color-card)] text-left text-[var(--color-muted)]">
          <tr>
            <th className="px-4 py-2">Email</th>
            <th className="px-4 py-2">Name</th>
            <th className="px-4 py-2">Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-t">
              <td className="px-4 py-2">{r.email}</td>
              <td className="px-4 py-2">{r.name ?? "—"}</td>
              <td className="px-4 py-2">{r.createdAt.toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
