/**
 * Middleware: subdomain → tenant slug, plus Clerk auth.
 * Trust boundary: Vercel Edge normalizes the host header at the CDN; we never
 * trust client-supplied `x-tenant-slug`. Downstream server components MUST
 * re-validate the slug against the DB.
 */
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/accept-invite/(.*)",
  "/api/webhooks/(.*)",
  "/api/inngest(.*)",
  "/monitoring(.*)",
]);

function extractTenantSlug(req: NextRequest, rootDomain: string): string | null {
  const host = req.headers.get("host")?.split(":")[0]?.toLowerCase();
  if (!host) return null;
  const root = rootDomain.split(":")[0]?.toLowerCase() ?? "";
  if (host === root || host === `www.${root}`) return null;
  if (!host.endsWith(`.${root}`)) return null;
  const sub = host.slice(0, -1 - root.length);
  if (!sub || sub === "www") return null;
  return sub;
}

export default clerkMiddleware(async (clerkAuth, req) => {
  const rootDomain = process.env.NEXT_PUBLIC_APP_DOMAIN ?? "";
  const slug = extractTenantSlug(req as NextRequest, rootDomain);

  // Protect non-public routes
  if (!isPublicRoute(req as NextRequest)) {
    const { userId, redirectToSignIn } = await clerkAuth();
    if (!userId) {
      return redirectToSignIn({ returnBackUrl: req.url });
    }
  }

  const requestHeaders = new Headers(req.headers);
  if (slug) {
    requestHeaders.set("x-tenant-slug", slug);
  } else {
    requestHeaders.delete("x-tenant-slug");
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
});

export const config = {
  // Exclude static assets and Next internals.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)",
    "/(api|trpc)(.*)",
  ],
};
