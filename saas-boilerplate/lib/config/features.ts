/**
 * Feature flags — enable/disable subsystems per deployment.
 * Read at request time (not cached) so a deploy with different flags takes effect immediately.
 */

function flag(name: string, defaultValue: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return defaultValue;
  return v === "1" || v.toLowerCase() === "true";
}

export const features = {
  /** Internal /admin dashboard. When false the routes 404. */
  get adminEnabled() {
    return flag("FEATURE_ADMIN_ENABLED", true);
  },
  /** Stripe billing surface (checkout, portal, plan selector). When false the tab is hidden and actions reject. */
  get billingEnabled() {
    return flag("FEATURE_BILLING_ENABLED", true);
  },
  /** Team invites. When false the invite UI hides and actions reject. */
  get invitesEnabled() {
    return flag("FEATURE_INVITES_ENABLED", true);
  },
  /** When true, actually send via the email transport. When false, log only (boilerplate default). */
  get emailEnabled() {
    return flag("FEATURE_EMAIL_ENABLED", false);
  },
} as const;

export type FeatureFlags = typeof features;
