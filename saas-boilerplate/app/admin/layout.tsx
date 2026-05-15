import { redirect, notFound } from "next/navigation";
import { isInternalAdmin } from "@/lib/auth/admin";
import { features } from "@/lib/config/features";
import { AdminSidebar } from "@/components/admin/sidebar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!features.adminEnabled) notFound();
  if (!(await isInternalAdmin())) redirect("/");
  return (
    <div className="min-h-screen flex bg-background">
      <AdminSidebar />
      <main className="flex-1 min-w-0">
        <div className="mx-auto w-full max-w-7xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
