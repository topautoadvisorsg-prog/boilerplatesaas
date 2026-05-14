/**
 * Tenant slug utilities.
 * Reserved words must never be assignable; collision checks happen in onboarding.
 */
const RESERVED_SLUGS = new Set<string>([
  "www", "app", "api", "admin", "auth", "login", "signin", "signup", "register",
  "logout", "dashboard", "settings", "billing", "team", "support", "help",
  "status", "blog", "docs", "about", "pricing", "terms", "privacy", "legal",
  "security", "contact", "marketing", "static", "assets", "public",
  "onboarding", "accept-invite", "sentry", "monitoring", "inngest", "stripe",
  "clerk", "webhooks", "internal", "system", "root", "host",
]);

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;

export type SlugValidation =
  | { ok: true; slug: string }
  | { ok: false; reason: string };

export function validateSlugFormat(input: string): SlugValidation {
  const slug = input.trim().toLowerCase();
  if (slug.length < 3) return { ok: false, reason: "Slug must be at least 3 characters." };
  if (slug.length > 32) return { ok: false, reason: "Slug must be at most 32 characters." };
  if (!SLUG_REGEX.test(slug)) {
    return { ok: false, reason: "Use lowercase letters, numbers, and hyphens; cannot start/end with a hyphen." };
  }
  if (RESERVED_SLUGS.has(slug)) return { ok: false, reason: "This slug is reserved." };
  return { ok: true, slug };
}

export function suggestSlugFromName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}
