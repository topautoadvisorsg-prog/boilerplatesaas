"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/auth/current-user";
import { resolveTenantForUser } from "@/lib/db/with-tenant";
import { startCheckout, openBillingPortal } from "@/lib/services/billingService";

export async function startCheckoutAction(plan: "pro" | "premium"): Promise<void> {
  const slug = (await headers()).get("x-tenant-slug")!;
  const user = await requireAppUser();
  const ctx = await resolveTenantForUser(slug, user.id);
  const { url } = await startCheckout({ ctx, plan });
  redirect(url);
}

export async function openBillingPortalAction(): Promise<void> {
  const slug = (await headers()).get("x-tenant-slug")!;
  const user = await requireAppUser();
  const ctx = await resolveTenantForUser(slug, user.id);
  const { url } = await openBillingPortal(ctx);
  redirect(url);
}
