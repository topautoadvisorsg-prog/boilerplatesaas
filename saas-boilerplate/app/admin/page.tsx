import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export default async function AdminOverviewPage() {
  const [counts] = await db
    .execute<{ tenants: number; users: number; paid: number }>(sql`
      SELECT
        (SELECT COUNT(*) FROM tenants)::int AS tenants,
        (SELECT COUNT(*) FROM users)::int AS users,
        (SELECT COUNT(*) FROM subscriptions WHERE plan <> 'free')::int AS paid
    `)
    .then((r) => r.rows);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Overview</h1>
      <div className="grid sm:grid-cols-3 gap-4">
        <Stat label="Tenants" value={counts?.tenants ?? 0} />
        <Stat label="Users" value={counts?.users ?? 0} />
        <Stat label="Paid subscriptions" value={counts?.paid ?? 0} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-[var(--color-card)] p-5">
      <div className="text-xs uppercase text-[var(--color-muted)] tracking-wide">{label}</div>
      <div className="text-3xl font-semibold mt-1">{value}</div>
    </div>
  );
}
