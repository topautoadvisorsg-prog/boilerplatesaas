import { headers } from "next/headers";
import { requireAppUser } from "@/lib/auth/current-user";
import { resolveTenantForUser } from "@/lib/db/with-tenant";

export default async function SettingsPage() {
  const slug = (await headers()).get("x-tenant-slug")!;
  const user = await requireAppUser();
  const ctx = await resolveTenantForUser(slug, user.id);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <div className="text-sm text-[var(--color-muted)]">
        Workspace: <strong>{ctx.tenantSlug}</strong> · Your role: <strong>{ctx.role}</strong>
      </div>
      <p className="text-sm text-[var(--color-muted)]">
        Extend this page to expose workspace name, logo upload, danger zone, etc.
      </p>
    </div>
  );
}
