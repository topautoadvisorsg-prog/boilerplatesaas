import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-1 text-sm",
        "placeholder:text-muted-foreground transition-colors",
        "focus-visible:outline-none focus-visible:border-border-strong focus-visible:ring-1 focus-visible:ring-border-strong",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
});
