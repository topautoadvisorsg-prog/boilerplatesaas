/**
 * billingService — Stripe customer / checkout / portal lifecycle.
 *
 * Phase 1.5 model: subscriptions are USER-scoped within a tenant.
 *   - Stripe Customer is per-user (each user enters their own card)
 *   - Subscription rows are keyed by (tenant_id, user_id)
 *   - Checkout/portal sessions are always called by a specific user
 */
import { db } from "@/lib/db";
import { subscriptions, users } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { stripe } from "@/lib/billing/stripe";
import { getEnv } from "@/lib/env";
import { features } from "@/lib/config/features";
import type { TenantContext } from "@/lib/db/with-tenant";

async function ensureCustomer(args: {
  tenantId: string;
  userId: string;
  email: string;
  name: string | null;
}): Promise<string> {
  const [row] = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(and(eq(subscriptions.tenantId, args.tenantId), eq(subscriptions.userId, args.userId)))
    .limit(1);
  if (row?.stripeCustomerId) return row.stripeCustomerId;

  const customer = await stripe().customers.create({
    email: args.email,
    name: args.name ?? args.email,
    metadata: { tenant_id: args.tenantId, user_id: args.userId },
  });
  await db
    .insert(subscriptions)
    .values({
      tenantId: args.tenantId,
      userId: args.userId,
      stripeCustomerId: customer.id,
      plan: "free",
      status: "active",
    })
    .onConflictDoUpdate({
      target: [subscriptions.tenantId, subscriptions.userId],
      set: { stripeCustomerId: customer.id, updatedAt: new Date() },
    });
  return customer.id;
}

export async function startCheckout(args: {
  ctx: TenantContext;
  plan: "pro" | "premium";
}): Promise<{ url: string }> {
  if (!features.billingEnabled) throw new Error("Billing is disabled for this deployment.");

  const env = getEnv();
  const priceId = args.plan === "pro" ? env.STRIPE_PRO_PRICE_ID : env.STRIPE_PREMIUM_PRICE_ID;

  const [u] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, args.ctx.userId))
    .limit(1);
  if (!u) throw new Error("User not found");

  const customerId = await ensureCustomer({
    tenantId: args.ctx.tenantId,
    userId: args.ctx.userId,
    email: u.email,
    name: u.name,
  });

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: 14,
      metadata: { tenant_id: args.ctx.tenantId, user_id: args.ctx.userId },
    },
    success_url: `${env.NEXT_PUBLIC_APP_URL}/billing?success=1`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/billing?canceled=1`,
    metadata: { tenant_id: args.ctx.tenantId, user_id: args.ctx.userId },
  });
  if (!session.url) throw new Error("Stripe session has no URL");
  return { url: session.url };
}

export async function openBillingPortal(ctx: TenantContext): Promise<{ url: string }> {
  if (!features.billingEnabled) throw new Error("Billing is disabled for this deployment.");
  const [row] = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(and(eq(subscriptions.tenantId, ctx.tenantId), eq(subscriptions.userId, ctx.userId)))
    .limit(1);
  if (!row?.stripeCustomerId) {
    throw new Error("No Stripe customer yet — start a subscription first.");
  }
  const portal = await stripe().billingPortal.sessions.create({
    customer: row.stripeCustomerId,
    return_url: `${getEnv().NEXT_PUBLIC_APP_URL}/billing`,
  });
  return { url: portal.url };
}
