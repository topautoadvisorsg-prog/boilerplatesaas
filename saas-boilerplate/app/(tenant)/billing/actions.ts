"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/auth/current-user";
import { resolveTenantForUser } from "@/lib/db/with-tenant";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/billing/stripe";
import { getEnv } from "@/lib/env";

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

export async function startCheckoutAction(plan: "pro" | "enterprise"): Promise<void> {
  const slug = (await headers()).get("x-tenant-slug")!;
  const user = await requireAppUser();
  const ctx = await resolveTenantForUser(slug, user.id);
  if (ctx.role !== "owner" && ctx.role !== "admin") throw new Error("Forbidden");

  const env = getEnv();
  const priceId = plan === "pro" ? env.STRIPE_PRO_PRICE_ID : env.STRIPE_ENTERPRISE_PRICE_ID;
  const customerId = await ensureCustomer(ctx.tenantId, slug, user.email);

  const session = await stripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    subscription_data: {
      trial_period_days: 14,
      metadata: { tenant_id: ctx.tenantId },
    },
    success_url: `${env.NEXT_PUBLIC_APP_URL}/billing?success=1`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/billing?canceled=1`,
    metadata: { tenant_id: ctx.tenantId },
  });
  if (!session.url) throw new Error("Stripe session has no URL");
  redirect(session.url);
}

export async function openBillingPortalAction(): Promise<void> {
  const slug = (await headers()).get("x-tenant-slug")!;
  const user = await requireAppUser();
  const ctx = await resolveTenantForUser(slug, user.id);
  if (ctx.role !== "owner" && ctx.role !== "admin") throw new Error("Forbidden");

  const [row] = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, ctx.tenantId))
    .limit(1);
  if (!row?.stripeCustomerId) throw new Error("No Stripe customer yet — start a subscription first.");

  const portal = await stripe().billingPortal.sessions.create({
    customer: row.stripeCustomerId,
    return_url: `${getEnv().NEXT_PUBLIC_APP_URL}/billing`,
  });
  redirect(portal.url);
}
