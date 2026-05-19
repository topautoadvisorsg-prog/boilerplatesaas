import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { requireAppUser } from "@/lib/auth/current-user";
import { resolveTenantForUser } from "@/lib/db/with-tenant";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { billingConfig, type PlanId } from "@/lib/config/billing";
import { startCheckoutAction, openBillingPortalAction } from "./actions";

export default async function BillingPage() {
  const slug = (await headers()).get("x-tenant-slug")!;
  const user = await requireAppUser();
  const ctx = await resolveTenantForUser(slug, user.id);

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.tenantId, ctx.tenantId), eq(subscriptions.userId, ctx.userId)))
    .limit(1);

  const currentPlan: PlanId = sub?.plan ?? "free";
  const status = sub?.status ?? "active";
  const trialEnd = sub?.trialEndsAt;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Billing</h1>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="text-sm text-muted-foreground">Current plan</div>
        <div className="text-xl font-semibold uppercase">{currentPlan}</div>
        <div className="text-xs text-muted-foreground mt-1">Status: {status}</div>
        {trialEnd && (
          <div className="text-xs text-muted-foreground">Trial ends: {trialEnd.toLocaleDateString()}</div>
        )}
        {sub?.stripeCustomerId && (
          <form action={openBillingPortalAction} className="mt-3">
            <button className="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-muted">
              Manage billing
            </button>
          </form>
        )}
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        {(["free", "pro", "premium"] as const).map((id) => {
          const p = billingConfig[id];
          const active = currentPlan === id;
          return (
            <div key={id} className="rounded-lg border border-border p-5 bg-card space-y-3">
              <div className="text-lg font-semibold">{p.name}</div>
              <div className="text-3xl">
                ${p.monthlyPriceUsd}
                <span className="text-sm text-muted-foreground">/mo</span>
              </div>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>Decks: {p.limits.maxDecks === Infinity ? "Unlimited" : p.limits.maxDecks}</li>
                <li>Daily cards: {p.limits.dailyCardLimit === Infinity ? "Unlimited" : p.limits.dailyCardLimit}</li>
                <li>Regions: {p.limits.maxActiveRegions === Infinity ? "Unlimited" : p.limits.maxActiveRegions}</li>
                {p.limits.hasAudioCards && <li>Audio cards</li>}
                {p.limits.hasAdvancedProgress && <li>Advanced progress</li>}
                {p.limits.hasPrioritySupport && <li>Priority support</li>}
                {p.limits.hasAiCardGeneration && <li>AI card generation</li>}
              </ul>
              {id !== "free" && !active && (
                <form action={startCheckoutAction.bind(null, id)}>
                  <button className="w-full px-3 py-2 rounded-md bg-primary text-primary-foreground font-medium">
                    {currentPlan === "free" ? "Start 14-day trial" : "Switch plan"}
                  </button>
                </form>
              )}
              {active && <div className="text-xs text-center text-muted-foreground">Current plan</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
