import { Badge } from "@/components/ui/badge";
import type { ComponentProps } from "react";

type Status =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "unpaid"
  | "paused";

type Tone = NonNullable<ComponentProps<typeof Badge>["tone"]>;

const toneByStatus: Record<Status, Tone> = {
  trialing: "info",
  active: "success",
  past_due: "warning",
  canceled: "danger",
  incomplete: "warning",
  incomplete_expired: "danger",
  unpaid: "danger",
  paused: "neutral",
};

const labelByStatus: Record<Status, string> = {
  trialing: "Trial",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
  incomplete: "Incomplete",
  incomplete_expired: "Expired",
  unpaid: "Unpaid",
  paused: "Paused",
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <Badge tone="neutral">—</Badge>;
  const s = (status as Status);
  const tone = toneByStatus[s] ?? "neutral";
  const label = labelByStatus[s] ?? status;
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

const planTone: Record<string, Tone> = {
  free: "neutral",
  pro: "primary",
  enterprise: "info",
};

export function PlanBadge({ plan }: { plan: string | null | undefined }) {
  if (!plan) return <Badge tone="neutral">—</Badge>;
  const tone = planTone[plan] ?? "neutral";
  return (
    <Badge tone={tone} className="capitalize">
      {plan}
    </Badge>
  );
}
