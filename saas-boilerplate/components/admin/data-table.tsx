"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, THead, TBody, Tr, Th, Td } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Plain-text accessor for search. Required for fields you want included in search. */
  searchValue?: (row: T) => string;
  className?: string;
  align?: "left" | "right";
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  searchPlaceholder?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: ReactNode;
  rowHref?: (row: T) => string;
  rowKey: (row: T) => string;
}

export function DataTable<T>({
  rows,
  columns,
  searchPlaceholder = "Search…",
  emptyTitle = "Nothing here yet",
  emptyDescription,
  emptyIcon,
  rowHref,
  rowKey,
}: DataTableProps<T>) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      columns.some((col) => col.searchValue?.(row).toLowerCase().includes(q) ?? false),
    );
  }, [rows, columns, query]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="pl-8 pr-8"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="text-xs text-muted-foreground tabular-nums">
          {filtered.length} of {rows.length}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={emptyIcon}
          title={query ? "No matches" : emptyTitle}
          description={query ? `No results for "${query}".` : emptyDescription}
        />
      ) : (
        <Table>
          <THead>
            <Tr>
              {columns.map((col) => (
                <Th key={col.key} className={col.align === "right" ? "text-right" : undefined}>
                  {col.header}
                </Th>
              ))}
            </Tr>
          </THead>
          <TBody>
            {filtered.map((row) => {
              const href = rowHref?.(row);
              return (
                <Tr
                  key={rowKey(row)}
                  className={cn(href && "cursor-pointer")}
                  onClick={href ? () => router.push(href) : undefined}
                >
                  {columns.map((col) => (
                    <Td
                      key={col.key}
                      className={cn(col.align === "right" && "text-right", col.className)}
                    >
                      {col.cell(row)}
                    </Td>
                  ))}
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </div>
  );
}
