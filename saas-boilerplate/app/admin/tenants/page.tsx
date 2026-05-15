import { Building2 } from "lucide-react";
import { db } from "@/lib/db";
import { tenants, subscriptions } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { StatusBadge, PlanBadge } from "@/components/admin/status-badges";
import { formatRelativeTime } from "@/lib/format";

interface Row {
  id: string;
  name: string;
  slug: string;
  plan: string | null;
  status: string | null;
  createdAt: Date;
}

const columns: Column<Row>[] = [
  {
    key: "name",
    header: "Name",
    cell: (r) => (
      <div className="flex flex-col">
        <span className="font-medium">{r.name}</span>
        <span className="text-xs text-muted-foreground">/{r.slug}</span>
      </div>
    ),
    searchValue: (r) => `${r.name} ${r.slug}`,
  },
  {
    key: "plan",
    header: "Plan",
    cell: (r) => <PlanBadge plan={r.plan} />,
    searchValue: (r) => r.plan ?? "",
  },
  {
    key: "status",
    header: "Status",
    cell: (r) => <StatusBadge status={r.status} />,
    searchValue: (r) => r.status ?? "",
  },
  {
    key: "created",
    header: "Created",
    align: "right",
    cell: (r) => (
      <span className="text-muted-foreground tabular-nums">{formatRelativeTime(r.createdAt)}</span>
    ),
  },
];

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
    .orderBy(desc(tenants.createdAt));

  return (
    <>
      <PageHeader
        title="Tenants"
        description={`${rows.length} workspace${rows.length === 1 ? "" : "s"} across this deployment.`}
      />
      <DataTable<Row>
        rows={rows}
        columns={columns}
        searchPlaceholder="Search by name or slug…"
        rowKey={(r) => r.id}
        rowHref={(r) => `/admin/tenants/${r.id}`}
        emptyIcon={<Building2 className="h-5 w-5" />}
        emptyTitle="No tenants yet"
        emptyDescription="When users complete onboarding, their workspaces will appear here."
      />
    </>
  );
}
