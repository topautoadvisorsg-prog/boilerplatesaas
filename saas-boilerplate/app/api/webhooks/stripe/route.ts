/**
 * Stripe webhook — atomic idempotency: every event is recorded in
 * `processed_stripe_events` *before* business logic runs. Duplicates short-circuit.
 *
 * No business logic lives in this route beyond the DB write that captures
 * subscription state; long-running side effects (emails, etc.) are dispatched
 * to Inngest.
 */
import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { headers } from "next/headers";
import { stripe } from "@/lib/billing/stripe";
import { db } from "@/lib/db";
import { processedStripeEvents, subscriptions, tenants } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { inngest } from "@/lib/jobs/client";
import { logAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";

export const runtime = "nodejs";

type PlanId = "free" | "pro" | "enterprise";
function priceToPlan(priceId: string | null | undefined): PlanId {
  const env = getEnv();
  if (priceId === env.STRIPE_PRO_PRICE_ID) return "pro";
  if (priceId === env.STRIPE_ENTERPRISE_PRICE_ID) return "enterprise";
  return "free";
}

export async function POST(req: Request) {
  const sig = (await headers()).get("stripe-signature");
  if (!sig) return new NextResponse("Missing signature", { status: 400 });
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, sig, getEnv().STRIPE_WEBHOOK_SECRET);
  } catch {
    return new NextResponse("Invalid signature", { status: 400 });
  }

  // Atomic idempotency: insert event id; if it already exists, skip.
  try {
    await db.insert(processedStripeEvents).values({ stripeEventId: event.id });
  } catch {
    return NextResponse.json({ duplicate: true });
  }

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const sub = event.data.object;
      const tenantId = sub.metadata?.tenant_id;
      if (!tenantId) break;
      const priceId = sub.items.data[0]?.price.id ?? null;
      await db
        .insert(subscriptions)
        .values({
          tenantId,
          stripeCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
          stripeSubscriptionId: sub.id,
          stripePriceId: priceId,
          plan: priceToPlan(priceId),
          status: sub.status as "trialing" | "active" | "past_due" | "canceled" | "incomplete" | "incomplete_expired" | "unpaid" | "paused",
          trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
          currentPeriodStart: sub.current_period_start ? new Date(sub.current_period_start * 1000) : null,
          currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
        })
        .onConflictDoUpdate({
          target: subscriptions.tenantId,
          set: {
            stripeSubscriptionId: sub.id,
            stripePriceId: priceId,
            plan: priceToPlan(priceId),
            status: sub.status as "trialing" | "active" | "past_due" | "canceled" | "incomplete" | "incomplete_expired" | "unpaid" | "paused",
            trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
            currentPeriodStart: sub.current_period_start ? new Date(sub.current_period_start * 1000) : null,
            currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
            updatedAt: new Date(),
          },
        });
      await logAudit({
        tenantId,
        userId: null,
        action:
          event.type === "customer.subscription.created"
            ? AUDIT_ACTIONS.SUBSCRIPTION_CREATED
            : AUDIT_ACTIONS.SUBSCRIPTION_UPDATED,
        metadata: { status: sub.status, plan: priceToPlan(priceId) },
      });
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const tenantId = sub.metadata?.tenant_id;
      if (!tenantId) break;
      await db
        .update(subscriptions)
        .set({
          plan: "free",
          status: "canceled",
          canceledAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.tenantId, tenantId));
      await logAudit({
        tenantId,
        userId: null,
        action: AUDIT_ACTIONS.SUBSCRIPTION_CANCELED,
        metadata: {},
      });
      break;
    }
    case "invoice.payment_failed": {
      const inv = event.data.object;
      const subId = typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;
      if (!subId) break;
      const [row] = await db
        .select({ id: subscriptions.id, tenantId: subscriptions.tenantId })
        .from(subscriptions)
        .where(eq(subscriptions.stripeSubscriptionId, subId))
        .limit(1);
      if (!row) break;
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
        userId: null,
        action: AUDIT_ACTIONS.PAYMENT_FAILED,
        metadata: { invoiceId: inv.id },
      });
      break;
    }
    default:
      break;
  }

  // Touch tenants table to keep TS happy with unused import in some builds
  void tenants;
  void sql;

  return NextResponse.json({ received: true });
}
