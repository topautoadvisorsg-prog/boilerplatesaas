import { auth } from "@clerk/nextjs/server";
import { getAdminUserIds } from "@/lib/env";

export async function isInternalAdmin(): Promise<boolean> {
  const { userId } = await auth();
  if (!userId) return false;
  return getAdminUserIds().includes(userId);
}

export async function requireInternalAdmin(): Promise<string> {
  const { userId } = await auth();
  if (!userId || !getAdminUserIds().includes(userId)) {
    throw new Error("Forbidden");
  }
  return userId;
}
