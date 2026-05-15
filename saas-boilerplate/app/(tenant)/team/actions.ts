"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { requireAppUser } from "@/lib/auth/current-user";
import { resolveTenantForUser } from "@/lib/db/with-tenant";
import { createInvite, removeMember } from "@/lib/services/inviteService";

async function tenantCtx() {
  const slug = (await headers()).get("x-tenant-slug");
  if (!slug) throw new Error("No tenant context");
  const user = await requireAppUser();
  return { ctx: await resolveTenantForUser(slug, user.id), user };
}

export async function inviteMemberAction(formData: FormData): Promise<void> {
  const { ctx } = await tenantCtx();
  await createInvite(ctx, {
    email: formData.get("email"),
    role: formData.get("role"),
  });
  revalidatePath("/team");
}

export async function removeMemberAction(memberId: string): Promise<void> {
  const { ctx } = await tenantCtx();
  await removeMember(ctx, memberId);
  revalidatePath("/team");
}
