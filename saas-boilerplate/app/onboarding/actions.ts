"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAppUser } from "@/lib/auth/current-user";
import { createTenant } from "@/lib/services/tenantService";

const CreateOrgSchema = z.object({
  name: z.string().min(2).max(64),
  slug: z.string().min(3).max(32),
});

export async function createOrgAction(formData: FormData): Promise<void> {
  const user = await requireAppUser();
  const parsed = CreateOrgSchema.safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input");

  const tenant = await createTenant({
    name: parsed.data.name,
    slug: parsed.data.slug,
    ownerUserId: user.id,
    ownerClerkUserId: user.clerkUserId,
  });

  const appUrl = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
  appUrl.hostname = `${tenant.slug}.${appUrl.hostname}`;
  appUrl.pathname = "/dashboard";
  redirect(appUrl.toString());
}
