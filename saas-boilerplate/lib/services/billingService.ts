/**
 * billingService — Stripe customer / checkout / portal lifecycle.
 */
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/billing/stripe";
import { getEnv } from "@/lib/env";
import { features } from "@/lib/config/features";
import type { TenantContext } from "@/lib/db/with-tenant";

async function ensureCustomer(tenantId: string, tenantName: string, email: string): Promise<string> {
  const [row] = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .limit(1);
  if (row?.stripeCustomerId) return row.stripeCustomerId;

  const customer = await stripe().customers.create({
    email,
    name: tenantName,
    metadata: { tenant_id: tenantId },
  });
  await db
    .update(subscriptions)
    .set({ stripeCustomerId: customer.id })
    .where(eq(subscriptions.tenantId, tenantId));
  return customer.id;
}

export async function startCheckout(args: {
  ctx: TenantContext;
  plan: "pro" | "enterprise";
  callerEmail: string;
  tenantName: string;
}): Promise<{ url: string }> {
  if (!features.billingEnabled) throw new Error("Billing is disabled for this deployment.");
  if (args.ctx.role !== "owner" && args.ctx.role !== "admin") throw new Error("Forbidden");

  const env = getEnv();
  const priceId = args.plan === "pro" ? env.STRIPE_PRO_PRICE_ID : env.STRIPE_ENTERPRISE_PRICE_ID;
  const customerId = await ensureCustomer(args.ctx.tenantId, args.tenantName, args.callerEmail);

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: 14,
      metadata: { tenant_id: args.ctx.tenantId },
    },
    success_url: `${env.NEXT_PUBLIC_APP_URL}/billing?success=1`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/billing?canceled=1`,
    metadata: { tenant_id: args.ctx.tenantId },
  });
  if (!session.url) throw new Error("Stripe session has no URL");
  return { url: session.url };
}

export async function openBillingPortal(ctx: TenantContext): Promise<{ url: string }> {
  if (!features.billingEnabled) throw new Error("Billing is disabled for this deployment.");
  if (ctx.role !== "owner" && ctx.role !== "admin") throw new Error("Forbidden");
  const [row] = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, ctx.tenantId))
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
