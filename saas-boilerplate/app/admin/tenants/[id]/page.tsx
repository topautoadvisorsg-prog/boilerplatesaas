import { notFound } from "next/navigation";
import { Building2, Users as UsersIcon, CreditCard, ScrollText } from "lucide-react";
import { db } from "@/lib/db";
import { tenants, subscriptions, tenantMembers, users, auditLogs } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { PageHeader } from "@/components/ui/page-header";
import { Breadcrumb } from "@/components/ui/breadcrumb";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, PlanBadge } from "@/components/admin/status-badges";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { logAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { requireInternalAdmin } from "@/lib/auth/admin";

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-border last:border-0">
      <span className="text-xs uppercase tracking-wide text-muted-foreground pt-0.5">{label}</span>
      <span className="text-sm text-right break-all">{children}</span>
    </div>
  );
}

const roleTone: Record<string, "primary" | "info" | "neutral"> = {
  owner: "primary",
  admin: "info",
  member: "neutral",
};

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
    .select({
      id: tenantMembers.id,
      role: tenantMembers.role,
      joinedAt: tenantMembers.joinedAt,
      email: users.email,
      name: users.name,
      avatarUrl: users.avatarUrl,
    })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(eq(tenantMembers.tenantId, id))
    .orderBy(tenantMembers.joinedAt);

  const recentAudits = await db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.tenantId, id))
    .orderBy(desc(auditLogs.createdAt))
    .limit(10);

  await logAudit({
    tenantId: id,
    userId: null,
    action: AUDIT_ACTIONS.ADMIN_TENANT_ACCESSED,
    metadata: { adminClerkUserId: adminUserId },
  });

  return (
    <>
      <PageHeader
        title={tenant.name}
        description={`/${tenant.slug} · workspace detail`}
        breadcrumb={
          <Breadcrumb
            items={[
              { label: "Admin", href: "/admin" },
              { label: "Tenants", href: "/admin/tenants" },
              { label: tenant.name },
            ]}
          />
        }
        actions={
          <div className="flex items-center gap-2">
            <PlanBadge plan={sub?.plan} />
            <StatusBadge status={sub?.status} />
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Overview */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              <CardTitle>Workspace</CardTitle>
            </div>
            <CardDescription>Identity and provisioning info.</CardDescription>
          </CardHeader>
          <CardContent>
            <DetailRow label="Name">{tenant.name}</DetailRow>
            <DetailRow label="Slug">/{tenant.slug}</DetailRow>
            <DetailRow label="Tenant ID"><code className="text-xs">{tenant.id}</code></DetailRow>
            <DetailRow label="Clerk org"><code className="text-xs">{tenant.clerkOrgId}</code></DetailRow>
            <DetailRow label="Created">{formatDateTime(tenant.createdAt)}</DetailRow>
            <DetailRow label="Updated">{formatDateTime(tenant.updatedAt)}</DetailRow>
          </CardContent>
        </Card>

        {/* Subscription */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <CardTitle>Subscription</CardTitle>
            </div>
            <CardDescription>Current Stripe state.</CardDescription>
          </CardHeader>
          <CardContent>
            {!sub ? (
              <EmptyState
                title="No subscription"
                description="Will be auto-created on the next event."
              />
            ) : (
              <>
                <DetailRow label="Plan"><PlanBadge plan={sub.plan} /></DetailRow>
                <DetailRow label="Status"><StatusBadge status={sub.status} /></DetailRow>
                <DetailRow label="Trial ends">
                  {sub.trialEndsAt ? formatDateTime(sub.trialEndsAt) : "—"}
                </DetailRow>
                <DetailRow label="Period">
                  {sub.currentPeriodStart && sub.currentPeriodEnd
                    ? `${formatDateTime(sub.currentPeriodStart)} → ${formatDateTime(sub.currentPeriodEnd)}`
                    : "—"}
                </DetailRow>
                <DetailRow label="Cancel at end">
                  {sub.cancelAtPeriodEnd ? <Badge tone="warning">Yes</Badge> : <span className="text-muted-foreground">No</span>}
                </DetailRow>
                <DetailRow label="Stripe customer">
                  {sub.stripeCustomerId ? <code className="text-xs">{sub.stripeCustomerId}</code> : "—"}
                </DetailRow>
                <DetailRow label="Stripe subscription">
                  {sub.stripeSubscriptionId ? <code className="text-xs">{sub.stripeSubscriptionId}</code> : "—"}
                </DetailRow>
              </>
            )}
          </CardContent>
        </Card>

        {/* Members */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <div className="flex items-center gap-2">
              <UsersIcon className="h-4 w-4 text-muted-foreground" />
              <CardTitle>Members</CardTitle>
            </div>
            <CardDescription>{members.length} {members.length === 1 ? "person" : "people"}.</CardDescription>
          </CardHeader>
          <CardContent>
            {members.length === 0 ? (
              <EmptyState title="No members" description="This shouldn't happen — every tenant has an owner." />
            ) : (
              <ul className="divide-y divide-border">
                {members.map((m) => (
                  <li key={m.id} className="flex items-center gap-3 py-2.5">
                    <Avatar name={m.name} email={m.email} src={m.avatarUrl} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium truncate text-sm">{m.name ?? m.email}</div>
                      <div className="text-xs text-muted-foreground truncate">{m.email}</div>
                    </div>
                    <Badge tone={roleTone[m.role] ?? "neutral"} className="capitalize">{m.role}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent activity */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <div className="flex items-center gap-2">
              <ScrollText className="h-4 w-4 text-muted-foreground" />
              <CardTitle>Recent activity</CardTitle>
            </div>
            <CardDescription>The 10 newest audit events for this tenant.</CardDescription>
          </CardHeader>
          <CardContent>
            {recentAudits.length === 0 ? (
              <EmptyState title="No activity yet" description="Audit events will appear here as actions happen." />
            ) : (
              <ul className="divide-y divide-border">
                {recentAudits.map((a) => {
                  const meta = a.metadata as Record<string, unknown> | null;
                  const hasMeta = meta && Object.keys(meta).length > 0;
                  return (
                    <li key={a.id} className="flex items-start justify-between gap-4 py-3">
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-foreground">{a.action}</div>
                        {hasMeta && (
                          <div className="mt-1 text-xs text-muted-foreground truncate max-w-xl">
                            {JSON.stringify(meta)}
                          </div>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums shrink-0">
                        {formatRelativeTime(a.createdAt)}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
