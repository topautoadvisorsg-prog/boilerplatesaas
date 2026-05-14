/**
 * Next.js instrumentation hook — runs once at server boot.
 * 1. Validates env vars (loud failure if missing).
 * 2. Initializes Sentry for the matching runtime.
 */
import { getEnv } from "@/lib/env";

export async function register() {
  // Fail fast if env is missing.
  getEnv();

  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  } else if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = async (
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | undefined> },
  context: { routerKind: "Pages Router" | "App Router"; routePath: string; routeType: "render" | "route" | "action" | "middleware" },
) => {
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(err, request, context);
};
