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

  // All user-scoped subscriptions for this tenant.
  const subs = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, id))
    .orderBy(desc(subscriptions.createdAt));
  const paidCount = subs.filter((s) => s.plan !== "free" && (s.status === "active" || s.status === "trialing")).length;
  const trialCount = subs.filter((s) => s.status === "trialing").length;
  const pastDueCount = subs.filter((s) => s.status === "past_due").length;
  const members = await db
    .select({
      id: tenantMembers.id,
      userId: tenantMembers.userId,
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
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{subs.length} subs</span>
            <span>·</span>
            <span>{paidCount} paid</span>
            {trialCount > 0 && <><span>·</span><span>{trialCount} trial</span></>}
            {pastDueCount > 0 && <><span>·</span><span className="text-warning">{pastDueCount} past due</span></>}
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

        {/* Subscriptions */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <CardTitle>Subscriptions</CardTitle>
            </div>
            <CardDescription>Per-user billing state.</CardDescription>
          </CardHeader>
          <CardContent>
            {subs.length === 0 ? (
              <EmptyState
                title="No subscriptions"
                description="Subscription rows are created on the user's first checkout or login."
              />
            ) : (
              <ul className="divide-y divide-border">
                {subs.slice(0, 8).map((s) => {
                  const userMember = members.find((m) => m.userId === s.userId);
                  return (
                    <li key={s.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0 flex items-center gap-2">
                        <Avatar
                          name={userMember?.name ?? null}
                          email={userMember?.email ?? null}
                          src={userMember?.avatarUrl ?? null}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <div className="text-sm truncate">{userMember?.email ?? s.userId.slice(0, 8)}</div>
                          {s.trialEndsAt && (
                            <div className="text-xs text-muted-foreground">
                              Trial: {formatDateTime(s.trialEndsAt)}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <PlanBadge plan={s.plan} />
                        <StatusBadge status={s.status} />
                      </div>
                    </li>
                  );
                })}
                {subs.length > 8 && (
                  <li className="text-xs text-muted-foreground pt-3">
                    + {subs.length - 8} more
                  </li>
                )}
              </ul>
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
