import { forwardRef, type HTMLAttributes, type TableHTMLAttributes, type ThHTMLAttributes, type TdHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Table = forwardRef<HTMLTableElement, TableHTMLAttributes<HTMLTableElement>>(function Table(
  { className, ...props },
  ref,
) {
  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-card">
      <table ref={ref} className={cn("w-full text-sm", className)} {...props} />
    </div>
  );
});

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn(
        "bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground border-b border-border",
        className,
      )}
      {...props}
    />
  );
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-border", className)} {...props} />;
}

export function Tr({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("transition-colors hover:bg-muted/30", className)}
      {...props}
    />
  );
}

export function Th({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn("px-4 py-3 text-left font-medium whitespace-nowrap", className)}
      {...props}
    />
  );
}

export function Td({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={cn("px-4 py-3 align-middle whitespace-nowrap", className)} {...props} />
  );
}
