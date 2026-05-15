import { redirect, notFound } from "next/navigation";
import { isInternalAdmin } from "@/lib/auth/admin";
import { features } from "@/lib/config/features";
import Link from "next/link";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!features.adminEnabled) notFound();
  if (!(await isInternalAdmin())) redirect("/");
  return (
    <div className="min-h-screen">
      <header className="border-b bg-[var(--color-card)]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="font-semibold">Admin</div>
          <nav className="flex gap-4 text-sm">
            <Link href="/admin">Overview</Link>
            <Link href="/admin/tenants">Tenants</Link>
            <Link href="/admin/users">Users</Link>
          </nav>
        </div>
      </header>
      <div className="max-w-6xl mx-auto px-6 py-8">{children}</div>
    </div>
  );
}
