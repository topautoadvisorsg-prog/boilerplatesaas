import { Webhook } from "svix";
import { headers } from "next/headers";
import type { WebhookEvent } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, tenants, tenantMembers } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { inngest } from "@/lib/jobs/client";
import { logAudit } from "@/lib/audit/log";
import { AUDIT_ACTIONS } from "@/lib/audit/actions";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { CLERK_WEBHOOK_SECRET } = getEnv();
  const h = await headers();
  const svixId = h.get("svix-id");
  const svixTs = h.get("svix-timestamp");
  const svixSig = h.get("svix-signature");
  if (!svixId || !svixTs || !svixSig) {
    return new NextResponse("Missing Svix headers", { status: 400 });
  }
  const body = await req.text();

  let evt: WebhookEvent;
  try {
    evt = new Webhook(CLERK_WEBHOOK_SECRET).verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTs,
      "svix-signature": svixSig,
    }) as WebhookEvent;
  } catch {
    return new NextResponse("Invalid signature", { status: 400 });
  }

  switch (evt.type) {
    case "user.created":
    case "user.updated": {
      const u = evt.data;
      const email = u.email_addresses[0]?.email_address ?? "";
      const name = [u.first_name, u.last_name].filter(Boolean).join(" ") || null;
      const inserted = await db
        .insert(users)
        .values({ clerkUserId: u.id, email, name, avatarUrl: u.image_url ?? null })
        .onConflictDoUpdate({
          target: users.clerkUserId,
          set: { email, name, avatarUrl: u.image_url ?? null, updatedAt: new Date() },
        })
        .returning({ id: users.id });
      const userRow = inserted[0];
      if (evt.type === "user.created" && userRow) {
        await inngest.send({ name: "user/welcome.email", data: { userId: userRow.id } });
      }
      break;
    }
    case "user.deleted": {
      if (evt.data.id) {
        await db.delete(users).where(eq(users.clerkUserId, evt.data.id));
      }
      break;
    }
    case "organization.created":
    case "organization.updated": {
      const o = evt.data;
      const inserted = await db
        .insert(tenants)
        .values({ clerkOrgId: o.id, name: o.name, slug: o.slug ?? o.id, logoUrl: o.image_url ?? null })
        .onConflictDoUpdate({
          target: tenants.clerkOrgId,
          set: { name: o.name, slug: o.slug ?? o.id, logoUrl: o.image_url ?? null, updatedAt: new Date() },
        })
        .returning({ id: tenants.id });
      const tenantRow = inserted[0];
      if (evt.type === "organization.created" && tenantRow) {
        await inngest.send({ name: "tenant/provision", data: { tenantId: tenantRow.id } });
        await logAudit({
          tenantId: tenantRow.id,
          userId: null,
          action: AUDIT_ACTIONS.TENANT_CREATED,
          metadata: { source: "clerk" },
        });
      }
      break;
    }
    case "organizationMembership.created": {
      const m = evt.data;
      const [tenantRow] = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.clerkOrgId, m.organization.id))
        .limit(1);
      const [userRow] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkUserId, m.public_user_data.user_id))
        .limit(1);
      if (tenantRow && userRow) {
        const role = m.role === "org:admin" ? "admin" : "member";
        await db
          .insert(tenantMembers)
          .values({ tenantId: tenantRow.id, userId: userRow.id, role })
          .onConflictDoNothing();
      }
      break;
    }
    case "organizationMembership.deleted": {
      const m = evt.data;
      if (!m.organization?.id || !m.public_user_data?.user_id) break;
      const [tenantRow] = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.clerkOrgId, m.organization.id))
        .limit(1);
      const [userRow] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkUserId, m.public_user_data.user_id))
        .limit(1);
      if (tenantRow && userRow) {
        // Scope by BOTH tenantId AND userId — never cascade-delete a tenant's members.
        await db
          .delete(tenantMembers)
          .where(
            and(
              eq(tenantMembers.tenantId, tenantRow.id),
              eq(tenantMembers.userId, userRow.id),
            ),
          );
      }
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
