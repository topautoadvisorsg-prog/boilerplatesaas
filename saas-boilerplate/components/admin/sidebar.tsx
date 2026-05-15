"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Building2, Users, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { appConfig } from "@/lib/config/app";

const items = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/tenants", label: "Tenants", icon: Building2 },
  { href: "/admin/users", label: "Users", icon: Users },
];

export function AdminSidebar() {
  const pathname = usePathname();
  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border bg-card/30">
      <div className="px-6 py-5 border-b border-border">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
          Admin
        </div>
        <div className="mt-1 text-base font-semibold truncate">{appConfig.name}</div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1">
        {items.map((item) => {
          const active =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors",
                active
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
              )}
            >
              <Icon className={cn("h-4 w-4", active ? "text-primary" : "")} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-border">
        <Link
          href="/"
          className="flex items-center gap-2 px-3 py-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to app
        </Link>
      </div>
    </aside>
  );
}
