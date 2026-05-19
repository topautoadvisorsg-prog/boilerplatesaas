/**
 * Billing config — plan catalog. Override this file per deployment to customize
 * plan names, pricing, limits, and feature gates.
 *
 * Stripe price IDs come from env vars (so dev/staging/prod can share this file).
 *
 * Phase 1.5 (Wilderness): tiers are now free / pro / premium and represent USER
 * entitlement, not tenant entitlement. Each user can have their own subscription.
 */

export type PlanId = "free" | "pro" | "premium";

export interface PlanLimits {
  /** Decks visible to the user. Infinity = unlimited. */
  maxDecks: number;
  /** Daily card ratings allowed. Infinity = unlimited. */
  dailyCardLimit: number;
  /** How many regions a user can have active simultaneously. Infinity = unlimited. */
  maxActiveRegions: number;
  /** Free trial length in days. */
  trialDays: number;
  hasAudioCards: boolean;
  hasAdvancedProgress: boolean;
  hasPrioritySupport: boolean;
  hasAiCardGeneration: boolean;
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
      maxDecks: 3,
      dailyCardLimit: 20,
      maxActiveRegions: 1,
      trialDays: 0,
      hasAudioCards: false,
      hasAdvancedProgress: false,
      hasPrioritySupport: false,
      hasAiCardGeneration: false,
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    monthlyPriceUsd: 4.99,
    stripePriceIdEnv: "STRIPE_PRO_PRICE_ID",
    limits: {
      maxDecks: Number.POSITIVE_INFINITY,
      dailyCardLimit: Number.POSITIVE_INFINITY,
      maxActiveRegions: Number.POSITIVE_INFINITY,
      trialDays: 14,
      hasAudioCards: false,
      hasAdvancedProgress: true,
      hasPrioritySupport: false,
      hasAiCardGeneration: false,
    },
  },
  premium: {
    id: "premium",
    name: "Premium",
    monthlyPriceUsd: 9.99,
    stripePriceIdEnv: "STRIPE_PREMIUM_PRICE_ID",
    limits: {
      maxDecks: Number.POSITIVE_INFINITY,
      dailyCardLimit: Number.POSITIVE_INFINITY,
      maxActiveRegions: Number.POSITIVE_INFINITY,
      trialDays: 14,
      hasAudioCards: true,
      hasAdvancedProgress: true,
      hasPrioritySupport: true,
      hasAiCardGeneration: true,
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
