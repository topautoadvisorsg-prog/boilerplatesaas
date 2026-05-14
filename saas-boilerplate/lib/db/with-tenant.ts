/**
 * withTenant — the ONE way to perform tenant-scoped reads/writes.
 *
 * Spec rules:
 *  1. Every tenant-scoped query MUST run inside withTenant().
 *  2. Sets a transaction-local PG variable `app.current_tenant_id` so RLS
 *     policies (see drizzle/rls.sql) restrict rows automatically.
 *  3. Re-validates the slug→tenantId mapping against the DB (host header is untrusted).
 *  4. Nesting withTenant inside another withTenant is disallowed — use the
 *     low-level db client with manual set_config inside the outer txn.
 */
import { db } from "./index";
import { sql, eq } from "drizzle-orm";
import { tenantMembers, tenants } from "./schema";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type { NeonQueryResultHKT } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

export type TenantTx = PgTransaction<
  NeonQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

export interface TenantContext {
  tenantId: string;
  tenantSlug: string;
  userId: string;
  role: "owner" | "admin" | "member";
}

/**
 * Resolve a slug → tenantId and verify the caller is a member.
 * Throws if the tenant doesn't exist or the user isn't a member.
 */
export async function resolveTenantForUser(
  tenantSlug: string,
  userId: string,
): Promise<TenantContext> {
  const rows = await db
    .select({
      tenantId: tenants.id,
      slug: tenants.slug,
      role: tenantMembers.role,
    })
    .from(tenants)
    .innerJoin(tenantMembers, eq(tenantMembers.tenantId, tenants.id))
    .where(sql`${tenants.slug} = ${tenantSlug} AND ${tenantMembers.userId} = ${userId}`)
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new TenantAccessError(`No membership for slug "${tenantSlug}"`);
  }
  return { tenantId: row.tenantId, tenantSlug: row.slug, userId, role: row.role };
}

export class TenantAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantAccessError";
  }
}

/**
 * Run a callback inside a transaction with app.current_tenant_id set.
 * RLS policies will then constrain every query in the txn.
 */
export async function withTenant<T>(
  ctx: TenantContext,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${ctx.tenantId}, true)`);
    return fn(tx as TenantTx);
  });
}
