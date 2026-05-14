import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/auth/current-user";
import { resolveTenantForUser, type TenantContext } from "@/lib/db/with-tenant";
import { db } from "@/lib/db";
import { subscriptions, tenants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import Link from "next/link";

export interface TenantLayoutProps {
  children: React.ReactNode;
}

async function loadTenant(): Promise<{ ctx: TenantContext; plan: string; status: string; name: string } | null> {
  const h = await headers();
  const slug = h.get("x-tenant-slug");
  if (!slug) return null;
  const user = await requireAppUser();
  try {
    const ctx = await resolveTenantForUser(slug, user.id);
    const [sub] = await db
      .select({ plan: subscriptions.plan, status: subscriptions.status, name: tenants.name })
      .from(subscriptions)
      .innerJoin(tenants, eq(tenants.id, subscriptions.tenantId))
      .where(eq(subscriptions.tenantId, ctx.tenantId))
      .limit(1);
    return {
      ctx,
      plan: sub?.plan ?? "free",
      status: sub?.status ?? "active",
      name: sub?.name ?? slug,
    };
  } catch {
    return null;
  }
}

export default async function TenantLayout({ children }: TenantLayoutProps) {
  const data = await loadTenant();
  if (!data) {
    redirect("/onboarding");
  }
  return (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <div className="font-semibold">{data.name}</div>
            <div className="text-xs text-[var(--color-muted)]">
              Plan: <span className="uppercase">{data.plan}</span> · {data.status}
            </div>
          </div>
          <nav className="flex gap-4 text-sm">
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/team">Team</Link>
            <Link href="/billing">Billing</Link>
            <Link href="/settings">Settings</Link>
          </nav>
        </div>
      </header>
      <div className="max-w-6xl mx-auto px-6 py-8">{children}</div>
    </div>
  );
}
