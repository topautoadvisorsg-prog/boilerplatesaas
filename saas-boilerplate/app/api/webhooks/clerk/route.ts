/**
 * Clerk webhook — verifies signature, delegates to services.
 * No business logic lives here.
 */
import { Webhook } from "svix";
import { headers } from "next/headers";
import type { WebhookEvent } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import {
  upsertUserFromClerk,
  deleteUserByClerkId,
  addMembershipByClerk,
  removeMembershipByClerk,
} from "@/lib/services/userService";
import { upsertTenantFromClerk } from "@/lib/services/tenantService";

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
      await upsertUserFromClerk({
        clerkUserId: u.id,
        email: u.email_addresses[0]?.email_address ?? "",
        name: [u.first_name, u.last_name].filter(Boolean).join(" ") || null,
        avatarUrl: u.image_url ?? null,
        isCreate: evt.type === "user.created",
      });
      break;
    }
    case "user.deleted": {
      if (evt.data.id) await deleteUserByClerkId(evt.data.id);
      break;
    }
    case "organization.created":
    case "organization.updated": {
      const o = evt.data;
      if (!o.id) break;
      await upsertTenantFromClerk({
        clerkOrgId: o.id,
        name: o.name,
        slug: o.slug ?? o.id,
        logoUrl: o.image_url ?? null,
        isCreate: evt.type === "organization.created",
      });
      break;
    }
    case "organizationMembership.created": {
      const m = evt.data;
      if (!m.organization?.id || !m.public_user_data?.user_id) break;
      await addMembershipByClerk({
        clerkOrgId: m.organization.id,
        clerkUserId: m.public_user_data.user_id,
        role: m.role === "org:admin" ? "admin" : "member",
      });
      break;
    }
    case "organizationMembership.deleted": {
      const m = evt.data;
      if (!m.organization?.id || !m.public_user_data?.user_id) break;
      await removeMembershipByClerk({
        clerkOrgId: m.organization.id,
        clerkUserId: m.public_user_data.user_id,
      });
      break;
    }
    default:
      break;
  }

  return NextResponse.json({ received: true });
}
