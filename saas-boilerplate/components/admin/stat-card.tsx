import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  trend?: { direction: "up" | "down" | "flat"; label: string };
  className?: string;
}

export function StatCard({ label, value, hint, icon: Icon, trend, className }: StatCardProps) {
  return (
    <Card className={cn("relative overflow-hidden", className)}>
      <CardContent className="p-5 pt-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
            <div className="text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
            {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
            {trend && (
              <div
                className={cn(
                  "inline-flex items-center gap-1 text-xs font-medium",
                  trend.direction === "up" && "text-success",
                  trend.direction === "down" && "text-danger",
                  trend.direction === "flat" && "text-muted-foreground",
                )}
              >
                {trend.direction === "up" && "▲"}
                {trend.direction === "down" && "▼"}
                {trend.direction === "flat" && "—"}
                <span>{trend.label}</span>
              </div>
            )}
          </div>
          {Icon && (
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Icon className="h-4 w-4" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
