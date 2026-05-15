import { type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "primary";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  dot?: boolean;
}

const toneClasses: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  success: "bg-success-soft text-success border-success/30",
  warning: "bg-warning-soft text-warning border-warning/30",
  danger: "bg-danger-soft text-danger border-danger/30",
  info: "bg-info-soft text-info border-info/30",
  primary: "bg-primary/10 text-primary border-primary/30",
};

const dotClasses: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  primary: "bg-primary",
};

export function Badge({ className, tone = "neutral", dot = false, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium uppercase tracking-wide",
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", dotClasses[tone])} aria-hidden />}
      {children}
    </span>
  );
}
