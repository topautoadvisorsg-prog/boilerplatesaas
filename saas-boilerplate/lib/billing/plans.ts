/**
 * Plans — the single source of truth for plan limits and features.
 * Rule: this file describes plans; current plan MUST always be read from DB
 * (never from JWT / cookie / session) before executing a gated operation.
 */

export type PlanId = "free" | "pro" | "enterprise";

export interface PlanLimits {
  maxTeamMembers: number; // Infinity → unlimited
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
  stripePriceIdEnv: string | null; // env var name to read at runtime
  limits: PlanLimits;
}

export const PLANS: Record<PlanId, PlanDefinition> = {
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
  return PLANS[id];
}

/**
 * Returns true if the given plan + status allows the requested feature.
 * Lapsed subscriptions (status="past_due"/"unpaid") drop to read-only.
 */
export function canUseFeature(
  plan: PlanId,
  status: string,
  feature: keyof PlanLimits,
): boolean {
  const limits = PLANS[plan].limits;
  const value = limits[feature];
  const isLapsed = status === "past_due" || status === "unpaid" || status === "incomplete_expired";
  if (isLapsed) return false; // read-only
  return typeof value === "boolean" ? value : value > 0;
}

export function isWithinLimit(
  plan: PlanId,
  limit: keyof PlanLimits,
  currentCount: number,
): boolean {
  const v = PLANS[plan].limits[limit];
  if (typeof v !== "number") return false;
  return currentCount < v;
}
