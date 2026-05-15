"use server";

import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/auth/current-user";
import { acceptInvite } from "@/lib/services/inviteService";

export async function acceptInviteAction(token: string): Promise<void> {
  const user = await requireAppUser();
  const { tenantSlug } = await acceptInvite({
    token,
    acceptingUserId: user.id,
    acceptingEmail: user.email,
  });
  const appUrl = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
  appUrl.hostname = `${tenantSlug}.${appUrl.hostname}`;
  appUrl.pathname = "/dashboard";
  redirect(appUrl.toString());
}
