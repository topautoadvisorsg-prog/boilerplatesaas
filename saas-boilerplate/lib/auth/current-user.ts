import { auth, currentUser } from "@clerk/nextjs/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "UnauthorizedError";
  }
}

/**
 * Resolve the current Clerk user → our app `users` row.
 * Throws UnauthorizedError if there is no Clerk session.
 */
export async function requireAppUser(): Promise<{
  id: string;
  clerkUserId: string;
  email: string;
  name: string | null;
}> {
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError();

  const rows = await db
    .select({ id: users.id, clerkUserId: users.clerkUserId, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.clerkUserId, userId))
    .limit(1);

  if (rows[0]) return rows[0];

  // First-time login fallback: lazily provision the user row from Clerk.
  const cu = await currentUser();
  if (!cu) throw new UnauthorizedError();
  const email = cu.emailAddresses[0]?.emailAddress ?? "";
  const name =
    [cu.firstName, cu.lastName].filter(Boolean).join(" ") || cu.username || null;

  const inserted = await db
    .insert(users)
    .values({
      clerkUserId: userId,
      email,
      name,
      avatarUrl: cu.imageUrl ?? null,
    })
    .onConflictDoUpdate({
      target: users.clerkUserId,
      set: { email, name },
    })
    .returning({
      id: users.id,
      clerkUserId: users.clerkUserId,
      email: users.email,
      name: users.name,
    });

  const row = inserted[0];
  if (!row) throw new UnauthorizedError();
  return row;
}

export async function getCurrentUserIdOrNull(): Promise<string | null> {
  const { userId } = await auth();
  return userId;
}
