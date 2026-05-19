import Link from "next/link";
import { Building2, Users, CreditCard, DollarSign, ArrowRight } from "lucide-react";
import { db } from "@/lib/db";
import { tenants, users } from "@/lib/db/schema";
import { desc, sql } from "drizzle-orm";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/admin/stat-card";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { formatRelativeTime } from "@/lib/format";
import { billingConfig } from "@/lib/config/billing";

interface CountsRow {
  [key: string]: unknown;
  tenants: number;
  users: number;
  active_subs: number;
  trialing_subs: number;
  past_due_subs: number;
  pro_count: number;
  premium_count: number;
}

export default async function AdminOverviewPage() {
  const [counts] = await db
    .execute<CountsRow>(sql`
      SELECT
        (SELECT COUNT(*) FROM tenants)::int AS tenants,
        (SELECT COUNT(*) FROM users)::int AS users,
        (SELECT COUNT(*) FROM subscriptions WHERE status = 'active' AND plan <> 'free')::int AS active_subs,
        (SELECT COUNT(*) FROM subscriptions WHERE status = 'trialing')::int AS trialing_subs,
        (SELECT COUNT(*) FROM subscriptions WHERE status = 'past_due')::int AS past_due_subs,
        (SELECT COUNT(*) FROM subscriptions WHERE plan = 'pro' AND status IN ('active','trialing'))::int AS pro_count,
        (SELECT COUNT(*) FROM subscriptions WHERE plan = 'premium' AND status IN ('active','trialing'))::int AS premium_count
    `)
    .then((r) => r.rows);

  const c = counts ?? {
    tenants: 0,
    users: 0,
    active_subs: 0,
    trialing_subs: 0,
    past_due_subs: 0,
    pro_count: 0,
    premium_count: 0,
  };

  const mrr =
    c.pro_count * billingConfig.pro.monthlyPriceUsd +
    c.premium_count * billingConfig.premium.monthlyPriceUsd;

  const recentTenants = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      createdAt: tenants.createdAt,
    })
    .from(tenants)
    .orderBy(desc(tenants.createdAt))
    .limit(5);

  const recentUsers = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      avatarUrl: users.avatarUrl,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt))
    .limit(5);

  return (
    <>
      <PageHeader
        title="Overview"
        description="A snapshot of activity across all tenants on this deployment."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Tenants" value={c.tenants} icon={Building2} hint="Total workspaces" />
        <StatCard label="Users" value={c.users} icon={Users} hint="Across all tenants" />
        <StatCard
          label="Paid subscriptions"
          value={c.active_subs}
          icon={CreditCard}
          hint={`${c.trialing_subs} on trial · ${c.past_due_subs} past due`}
        />
        <StatCard
          label="MRR (est.)"
          value={`$${mrr.toLocaleString()}`}
          icon={DollarSign}
          hint="Pro + Enterprise list price"
        />
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recent tenants</CardTitle>
              <CardDescription>The 5 newest workspaces.</CardDescription>
            </div>
            <Link
              href="/admin/tenants"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {recentTenants.length === 0 ? (
              <EmptyState
                icon={<Building2 className="h-5 w-5" />}
                title="No tenants yet"
                description="The first signup will appear here."
              />
            ) : (
              <ul className="divide-y divide-border">
                {recentTenants.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/admin/tenants/${t.id}`}
                      className="flex items-center justify-between gap-3 py-3 hover:bg-muted/30 -mx-3 px-3 rounded-md transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">{t.name}</div>
                        <div className="text-xs text-muted-foreground truncate">/{t.slug}</div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground tabular-nums w-16 text-right">
                          {formatRelativeTime(t.createdAt)}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recent signups</CardTitle>
              <CardDescription>The 5 newest user accounts.</CardDescription>
            </div>
            <Link
              href="/admin/users"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {recentUsers.length === 0 ? (
              <EmptyState
                icon={<Users className="h-5 w-5" />}
                title="No users yet"
                description="Users will appear here as they sign up."
              />
            ) : (
              <ul className="divide-y divide-border">
                {recentUsers.map((u) => (
                  <li key={u.id} className="flex items-center gap-3 py-3">
                    <Avatar name={u.name} email={u.email} src={u.avatarUrl} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate">{u.name ?? u.email}</div>
                      <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                      {formatRelativeTime(u.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
