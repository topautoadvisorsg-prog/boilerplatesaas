import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div>
      <div className="pb-6 border-b border-border mb-8 space-y-2">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-9 w-72" />
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="bg-muted/40 px-4 py-3 border-b border-border">
            <Skeleton className="h-3 w-24" />
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-border last:border-0 flex items-center gap-3">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-16 ml-auto" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
