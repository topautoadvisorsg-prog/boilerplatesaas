/**
 * Billing config — plan catalog. Override this file per deployment to customize
 * plan names, pricing, limits, and feature gates.
 *
 * Stripe price IDs come from env vars (so dev/staging/prod can share this file).
 */

export type PlanId = "free" | "pro" | "enterprise";

export interface PlanLimits {
  maxTeamMembers: number;
  maxProjects: number;
  trialDays: number;
  hasAdvancedAnalytics: boolean;
  hasPrioritySupport: boolean;
  hasAuditLogExport: boolean;
}

export interface PlanDefinition {
  id: PlanId;
  name: string;
  monthlyPriceUsd: number;
  /** Name of the env var that stores the Stripe price id (null for free). */
  stripePriceIdEnv: string | null;
  limits: PlanLimits;
}

export const billingConfig: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    monthlyPriceUsd: 0,
    stripePriceIdEnv: null,
    limits: {
      maxTeamMembers: 3,
      maxProjects: 1,
      trialDays: 0,
      hasAdvancedAnalytics: false,
      hasPrioritySupport: false,
      hasAuditLogExport: false,
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyPriceUsd: 49,
    stripePriceIdEnv: "STRIPE_PRO_PRICE_ID",
    limits: {
      maxTeamMembers: 10,
      maxProjects: 25,
      trialDays: 14,
      hasAdvancedAnalytics: true,
      hasPrioritySupport: false,
      hasAuditLogExport: false,
    },
  },
  enterprise: {
    id: "enterprise",
    name: "Enterprise",
    monthlyPriceUsd: 199,
    stripePriceIdEnv: "STRIPE_ENTERPRISE_PRICE_ID",
    limits: {
      maxTeamMembers: Number.POSITIVE_INFINITY,
      maxProjects: Number.POSITIVE_INFINITY,
      trialDays: 14,
      hasAdvancedAnalytics: true,
      hasPrioritySupport: true,
      hasAuditLogExport: true,
    },
  },
};

export function getPlan(id: PlanId): PlanDefinition {
  return billingConfig[id];
}

export function canUseFeature(plan: PlanId, status: string, feature: keyof PlanLimits): boolean {
  const limits = billingConfig[plan].limits;
  const v = limits[feature];
  const lapsed = status === "past_due" || status === "unpaid" || status === "incomplete_expired";
  if (lapsed) return false;
  return typeof v === "boolean" ? v : v > 0;
}

export function isWithinLimit(plan: PlanId, limit: keyof PlanLimits, currentCount: number): boolean {
  const v = billingConfig[plan].limits[limit];
  if (typeof v !== "number") return false;
  return currentCount < v;
}
