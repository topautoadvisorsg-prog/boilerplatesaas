/**
 * Stripe webhook — atomic idempotency, then delegates to subscriptionService.
 * No business logic lives here.
 *
 * Phase 1.5: every subscription event metadata MUST contain both
 * `tenant_id` AND `user_id`. Events missing either are dropped.
 */
import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { stripe } from "@/lib/billing/stripe";
import { db } from "@/lib/db";
import { processedStripeEvents, subscriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import {
  applySubscriptionUpsert,
  markSubscriptionCanceled,
  markPastDueByStripeId,
} from "@/lib/services/subscriptionService";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const sig = (await headers()).get("stripe-signature");
  if (!sig) return new NextResponse("Missing signature", { status: 400 });
  const body = await req.text();

  let event;
  try {
    event = stripe().webhooks.constructEvent(body, sig, getEnv().STRIPE_WEBHOOK_SECRET);
  } catch {
    return new NextResponse("Invalid signature", { status: 400 });
  }

  // Atomic idempotency gate.
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
      const userId = sub.metadata?.user_id;
      if (!tenantId || !userId) break;
      await applySubscriptionUpsert({
        tenantId,
        userId,
        sub,
        source: event.type === "customer.subscription.created" ? "created" : "updated",
      });
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const tenantId = sub.metadata?.tenant_id;
      const userId = sub.metadata?.user_id;
      if (!tenantId || !userId) {
        // Fallback: locate the row by stripe id so we can still cancel safely.
        const [row] = await db
          .select({ tenantId: subscriptions.tenantId, userId: subscriptions.userId })
          .from(subscriptions)
          .where(eq(subscriptions.stripeSubscriptionId, sub.id))
          .limit(1);
        if (!row) break;
        await markSubscriptionCanceled({ tenantId: row.tenantId, userId: row.userId });
        break;
      }
      await markSubscriptionCanceled({ tenantId, userId });
      break;
    }
    case "invoice.payment_failed": {
      const inv = event.data.object;
      const subId = typeof inv.subscription === "string" ? inv.subscription : inv.subscription?.id;
      if (!subId) break;
      await markPastDueByStripeId(subId, inv.id ?? null);
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
