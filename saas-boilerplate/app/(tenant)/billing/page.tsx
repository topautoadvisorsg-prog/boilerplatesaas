import { headers } from "next/headers";
import { requireAppUser } from "@/lib/auth/current-user";
import { resolveTenantForUser } from "@/lib/db/with-tenant";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { PLANS } from "@/lib/billing/plans";
import { startCheckoutAction, openBillingPortalAction } from "./actions";

export default async function BillingPage() {
  const slug = (await headers()).get("x-tenant-slug")!;
  const user = await requireAppUser();
  const ctx = await resolveTenantForUser(slug, user.id);

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, ctx.tenantId))
    .limit(1);

  const currentPlan = sub?.plan ?? "free";
  const status = sub?.status ?? "active";
  const trialEnd = sub?.trialEndsAt;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Billing</h1>

      <div className="rounded-lg border bg-[var(--color-card)] p-4">
        <div className="text-sm text-[var(--color-muted)]">Current plan</div>
        <div className="text-xl font-semibold uppercase">{currentPlan}</div>
        <div className="text-xs text-[var(--color-muted)] mt-1">Status: {status}</div>
        {trialEnd && <div className="text-xs text-[var(--color-muted)]">Trial ends: {trialEnd.toLocaleDateString()}</div>}
        {sub?.stripeCustomerId && (
          <form action={openBillingPortalAction} className="mt-3">
            <button className="text-sm px-3 py-1.5 rounded-md border">Manage billing</button>
          </form>
        )}
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        {(["free", "pro", "enterprise"] as const).map((id) => {
          const p = PLANS[id];
          const active = currentPlan === id;
          return (
            <div key={id} className="rounded-lg border p-5 bg-[var(--color-card)] space-y-3">
              <div className="text-lg font-semibold">{p.name}</div>
              <div className="text-3xl">${p.monthlyPriceUsd}<span className="text-sm text-[var(--color-muted)]">/mo</span></div>
              <ul className="text-sm text-[var(--color-muted)] space-y-1">
                <li>Team: {p.limits.maxTeamMembers === Infinity ? "Unlimited" : p.limits.maxTeamMembers}</li>
                <li>Projects: {p.limits.maxProjects === Infinity ? "Unlimited" : p.limits.maxProjects}</li>
                {p.limits.hasAdvancedAnalytics && <li>Advanced analytics</li>}
                {p.limits.hasPrioritySupport && <li>Priority support</li>}
                {p.limits.hasAuditLogExport && <li>Audit log export</li>}
              </ul>
              {id !== "free" && !active && (
                <form action={startCheckoutAction.bind(null, id)}>
                  <button className="w-full px-3 py-2 rounded-md bg-[var(--color-accent)] text-black font-medium">
                    {currentPlan === "free" ? "Start 14-day trial" : "Switch plan"}
                  </button>
                </form>
              )}
              {active && <div className="text-xs text-center text-[var(--color-muted)]">Current plan</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
