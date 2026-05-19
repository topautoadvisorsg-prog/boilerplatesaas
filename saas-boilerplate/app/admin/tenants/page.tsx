import { Building2 } from "lucide-react";
import { db } from "@/lib/db";
import { tenants, tenantMembers } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { formatRelativeTime } from "@/lib/format";

interface Row {
  id: string;
  name: string;
  slug: string;
  status: string;
  memberCount: number;
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
    key: "status",
    header: "Status",
    cell: (r) => <span className="text-muted-foreground capitalize">{r.status}</span>,
    searchValue: (r) => r.status,
  },
  {
    key: "members",
    header: "Members",
    align: "right",
    cell: (r) => <span className="tabular-nums">{r.memberCount}</span>,
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
  // Aggregate member count per tenant (subscriptions are per-user now, so we
  // can't get a single "plan" per tenant — show membership size instead).
  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      createdAt: tenants.createdAt,
      memberCount: sql<number>`COUNT(${tenantMembers.id})::int`,
    })
    .from(tenants)
    .leftJoin(tenantMembers, eq(tenantMembers.tenantId, tenants.id))
    .groupBy(tenants.id)
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
