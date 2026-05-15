import { Users } from "lucide-react";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/admin/data-table";
import { Avatar } from "@/components/ui/avatar";
import { formatRelativeTime } from "@/lib/format";

interface Row {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: Date;
}

const columns: Column<Row>[] = [
  {
    key: "user",
    header: "User",
    cell: (r) => (
      <div className="flex items-center gap-3">
        <Avatar name={r.name} email={r.email} src={r.avatarUrl} size="sm" />
        <div className="min-w-0">
          <div className="font-medium truncate">{r.name ?? r.email}</div>
          <div className="text-xs text-muted-foreground truncate">{r.email}</div>
        </div>
      </div>
    ),
    searchValue: (r) => `${r.name ?? ""} ${r.email}`,
  },
  {
    key: "id",
    header: "ID",
    cell: (r) => <code className="text-xs text-muted-foreground">{r.id.slice(0, 8)}…</code>,
    searchValue: (r) => r.id,
  },
  {
    key: "created",
    header: "Joined",
    align: "right",
    cell: (r) => (
      <span className="text-muted-foreground tabular-nums">{formatRelativeTime(r.createdAt)}</span>
    ),
  },
];

export default async function AdminUsersPage() {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt));

  return (
    <>
      <PageHeader
        title="Users"
        description={`${rows.length} account${rows.length === 1 ? "" : "s"} across the platform.`}
      />
      <DataTable<Row>
        rows={rows}
        columns={columns}
        searchPlaceholder="Search by name, email or ID…"
        rowKey={(r) => r.id}
        emptyIcon={<Users className="h-5 w-5" />}
        emptyTitle="No users yet"
        emptyDescription="As people sign up, their accounts will appear here."
      />
    </>
  );
}
