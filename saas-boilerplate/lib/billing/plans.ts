/**
 * Back-compat shim. New code should import from `@/lib/config/billing`.
 * Existing imports continue to work.
 */
export {
  billingConfig as PLANS,
  getPlan,
  canUseFeature,
  isWithinLimit,
  type PlanId,
  type PlanDefinition,
  type PlanLimits,
} from "@/lib/config/billing";
