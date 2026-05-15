/**
 * App identity — the ONE place to brand this engine for a new product.
 * Everything user-visible (titles, headers, Inngest app id) reads from here.
 *
 * Override in `.env.local` or fork this file per deployment.
 */

export const appConfig = {
  /** Used in <title>, page headers, and the Inngest app id. */
  name: process.env.NEXT_PUBLIC_APP_NAME ?? "SaaS Engine",
  /** Short tagline / metadata description. */
  description:
    process.env.NEXT_PUBLIC_APP_DESCRIPTION ??
    "Multi-tenant SaaS foundation.",
  /** Marketing root-page copy. */
  marketing: {
    headline: process.env.NEXT_PUBLIC_APP_HEADLINE ?? "Build your SaaS faster.",
    subhead:
      process.env.NEXT_PUBLIC_APP_SUBHEAD ??
      "Sign in to access your workspace.",
  },
  /** Inngest app identifier (kebab-case). */
  inngestAppId: process.env.NEXT_PUBLIC_APP_SLUG ?? "saas-engine",
  /** Support email shown in footers / payment-failed templates. */
  supportEmail: process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@example.com",
} as const;

export type AppConfig = typeof appConfig;
