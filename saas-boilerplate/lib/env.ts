import { z } from "zod";

/**
 * Startup environment validation.
 * Imports must happen as side-effects in instrumentation.ts so that a missing
 * variable fails loud at boot rather than silently at request time.
 *
 * Rule (from spec): no secret key may use the NEXT_PUBLIC_ prefix.
 */

const EnvSchema = z.object({
  // Database (Neon)
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required (Neon pooled)."),
  DATABASE_URL_UNPOOLED: z.string().min(1, "DATABASE_URL_UNPOOLED is required (Neon direct, for migrations)."),

  // Clerk
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  CLERK_WEBHOOK_SECRET: z.string().min(1),

  // Stripe
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().min(1),
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRO_PRICE_ID: z.string().min(1),
  STRIPE_ENTERPRISE_PRICE_ID: z.string().min(1),

  // Email (Resend) — stubbed in this boilerplate; keys still validated so prod can't boot without them.
  RESEND_API_KEY: z.string().min(1),
  EMAIL_FROM: z.string().email("EMAIL_FROM must be a valid email verified in Resend."),

  // Inngest
  INNGEST_EVENT_KEY: z.string().min(1),
  INNGEST_SIGNING_KEY: z.string().min(1),

  // App
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_APP_DOMAIN: z.string().min(1, "Root domain only (e.g. ourapp.com), no protocol."),

  // Sentry
  SENTRY_DSN: z.string().min(1),
  NEXT_PUBLIC_SENTRY_DSN: z.string().min(1),

  // Admin
  ADMIN_USER_IDS: z.string().default(""),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid or missing environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

export function getAdminUserIds(): readonly string[] {
  const raw = getEnv().ADMIN_USER_IDS;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
