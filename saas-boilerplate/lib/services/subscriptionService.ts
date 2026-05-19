/**
 * subscriptionService — handles Stripe subscription state changes per-user.
 * Called from the Stripe webhook (post-idempotency-gate).
 *
 * Phase 1.5 model: subscriptions are scoped by (tenant_id, user_id).
 * Stripe webhook metadata must contain both tenant_id and user_id.
 */
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { logAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";
import { inngest } from "@/lib/jobs/client";
import type { PlanId } from "@/lib/config/billing";

type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused";

function priceToPlan(priceId: string | null | undefined): PlanId {
  const env = getEnv();
  if (priceId === env.STRIPE_PRO_PRICE_ID) return "pro";
  if (priceId === env.STRIPE_PREMIUM_PRICE_ID) return "premium";
  return "free";
}

export async function applySubscriptionUpsert(args: {
  tenantId: string;
  userId: string;
  sub: Stripe.Subscription;
  source: "created" | "updated";
}): Promise<void> {
  const { tenantId, userId, sub } = args;
  const priceId = sub.items.data[0]?.price.id ?? null;
  const values = {
    tenantId,
    userId,
    stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId,
    plan: priceToPlan(priceId),
    status: sub.status as SubscriptionStatus,
    trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
    currentPeriodStart: sub.current_period_start ? new Date(sub.current_period_start * 1000) : null,
    currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
  };
  await db
    .insert(subscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: [subscriptions.tenantId, subscriptions.userId],
      set: { ...values, updatedAt: new Date() },
    });
  await logAudit({
    tenantId,
    userId,
    action:
      args.source === "created"
        ? AUDIT_ACTIONS.SUBSCRIPTION_CREATED
        : AUDIT_ACTIONS.SUBSCRIPTION_UPDATED,
    metadata: { status: sub.status, plan: priceToPlan(priceId) },
  });
}

export async function markSubscriptionCanceled(args: {
  tenantId: string;
  userId: string;
}): Promise<void> {
  await db
    .update(subscriptions)
    .set({
      plan: "free",
      status: "canceled",
      canceledAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(eq(subscriptions.tenantId, args.tenantId), eq(subscriptions.userId, args.userId)),
    );
  await logAudit({
    tenantId: args.tenantId,
    userId: args.userId,
    action: AUDIT_ACTIONS.SUBSCRIPTION_CANCELED,
    metadata: {},
  });
}

export async function markPastDueByStripeId(stripeSubId: string, invoiceId: string | null): Promise<void> {
  const [row] = await db
    .select({
      id: subscriptions.id,
      tenantId: subscriptions.tenantId,
      userId: subscriptions.userId,
    })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, stripeSubId))
    .limit(1);
  if (!row) return;
  await db
    .update(subscriptions)
    .set({ status: "past_due", updatedAt: new Date() })
    .where(eq(subscriptions.id, row.id));
  await inngest.send({
    name: "billing/payment-failed",
    data: { subscriptionId: row.id },
  });
  await logAudit({
    tenantId: row.tenantId,
    userId: row.userId,
    action: AUDIT_ACTIONS.PAYMENT_FAILED,
    metadata: { invoiceId },
  });
}

/**
 * Look up the active subscription row for a (tenant, user) pair.
 * Returns `null` for users with no row yet (treat as free, lazy-create on first checkout).
 */
export async function getUserSubscription(
  tenantId: string,
  userId: string,
): Promise<typeof subscriptions.$inferSelect | null> {
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.tenantId, tenantId), eq(subscriptions.userId, userId)))
    .limit(1);
  return row ?? null;
}

/**
 * Ensure a free-plan subscription row exists for this user in this tenant.
 * Called at tenant onboarding / first login. Idempotent.
 */
export async function ensureFreeSubscription(tenantId: string, userId: string): Promise<void> {
  await db
    .insert(subscriptions)
    .values({ tenantId, userId, plan: "free", status: "active" })
    .onConflictDoNothing({ target: [subscriptions.tenantId, subscriptions.userId] });
}
