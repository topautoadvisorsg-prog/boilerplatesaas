import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import type { AuditAction } from "./actions";

export interface AuditLogInput {
  tenantId: string | null;
  userId: string | null;
  action: AuditAction;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export async function logAudit(input: AuditLogInput): Promise<void> {
  await db.insert(auditLogs).values({
    tenantId: input.tenantId,
    userId: input.userId,
    action: input.action,
    metadata: (input.metadata ?? {}) as Record<string, unknown>,
    ipAddress: input.ipAddress ?? null,
  });
}
