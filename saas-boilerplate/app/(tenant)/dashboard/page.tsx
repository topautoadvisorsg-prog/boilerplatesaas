export default function DashboardPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-[var(--color-muted)]">
        Your tenant context is resolved via the <code>withTenant()</code> helper and protected
        by Row-Level Security on tenant-scoped tables.
      </p>
    </div>
  );
}
