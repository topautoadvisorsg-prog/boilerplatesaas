"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Admin error:", error);
  }, [error]);

  return (
    <EmptyState
      icon={<AlertTriangle className="h-5 w-5 text-danger" />}
      title="Something went wrong"
      description={error.message || "An unexpected error occurred while loading this page."}
      action={
        <Button variant="outline" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
