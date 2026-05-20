import { inngest } from "./client";
import { db } from "@/lib/db";
import {
  users,
  tenants,
  invitations,
  subscriptions,
  tenantCards,
  tenantDecks,
} from "@/lib/db/schema";
import { eq, and, isNull, lt, sql, inArray } from "drizzle-orm";
import { sendEmail } from "@/lib/email/client";
import {
  welcomeEmail,
  inviteEmail,
  trialEndingEmail,
  paymentFailedEmail,
} from "@/lib/email/templates";
import { getEnv } from "@/lib/env";
import { listUsersNeedingReconcile, reconcileStreak } from "@/lib/services/streakService";

const concurrency = { limit: 10 };
const retries = 3;

/* ------------------------------------------------------------------ */
/* user/welcome.email — idempotent via users.welcome_email_sent_at     */
/* ------------------------------------------------------------------ */
export const sendWelcomeEmail = inngest.createFunction(
  { id: "send-welcome-email", concurrency, retries },
  { event: "user/welcome.email" },
  async ({ event, step }) => {
    const { userId } = event.data;

    const user = await step.run("load-user", async () => {
      const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      return rows[0] ?? null;
    });
    if (!user) return { skipped: "user-not-found" };
    if (user.welcomeEmailSentAt) return { skipped: "already-sent" };

    const tpl = welcomeEmail({ name: user.name, appUrl: getEnv().NEXT_PUBLIC_APP_URL });
    await step.run("send", () => sendEmail({ to: user.email, ...tpl, tag: "welcome" }));

    await step.run("mark-sent", async () => {
      await db
        .update(users)
        .set({ welcomeEmailSentAt: new Date() })
        .where(and(eq(users.id, userId), isNull(users.welcomeEmailSentAt)));
    });
    return { sent: true };
  },
);

/* ------------------------------------------------------------------ */
/* tenant/provision                                                    */
/* ------------------------------------------------------------------ */
export const provisionTenant = inngest.createFunction(
  { id: "provision-tenant", concurrency, retries },
  { event: "tenant/provision" },
  async ({ event, step }) => {
    const { tenantId } = event.data;
    // Phase 1.5: subscriptions are now user-scoped (seeded inside the
    // tenantService.createTenant transaction). This job is reserved for any
    // additional async provisioning side effects (content cloning, analytics
    // bootstrap, etc.) — kept as a no-op success-stub for now.
    return step.run("noop", async () => ({ tenantId, ok: true }));
  },
);

/* ------------------------------------------------------------------ */
/* team/invite.email — idempotent via invitations.invite_email_sent_at */
/* ------------------------------------------------------------------ */
export const sendInviteEmail = inngest.createFunction(
  { id: "send-invite-email", concurrency, retries },
  { event: "team/invite.email" },
  async ({ event, step }) => {
    const { invitationId } = event.data;

    const data = await step.run("load", async () => {
      const rows = await db
        .select({
          inv: invitations,
          tenantName: tenants.name,
          tenantSlug: tenants.slug,
          inviterName: users.name,
        })
        .from(invitations)
        .innerJoin(tenants, eq(invitations.tenantId, tenants.id))
        .innerJoin(users, eq(invitations.invitedById, users.id))
        .where(eq(invitations.id, invitationId))
        .limit(1);
      return rows[0] ?? null;
    });
    if (!data) return { skipped: "not-found" };
    if (data.inv.inviteEmailSentAt) return { skipped: "already-sent" };

    const acceptUrl = `${getEnv().NEXT_PUBLIC_APP_URL}/accept-invite/${data.inv.token}`;
    const tpl = inviteEmail({
      tenantName: data.tenantName,
      inviterName: data.inviterName ?? "A teammate",
      acceptUrl,
    });
    await step.run("send", () => sendEmail({ to: data.inv.email, ...tpl, tag: "invite" }));
    await step.run("mark-sent", async () => {
      await db
        .update(invitations)
        .set({ inviteEmailSentAt: new Date() })
        .where(and(eq(invitations.id, invitationId), isNull(invitations.inviteEmailSentAt)));
    });
    return { sent: true };
  },
);

/* ------------------------------------------------------------------ */
/* billing/trial-ending                                                */
/* ------------------------------------------------------------------ */
export const trialEndingReminder = inngest.createFunction(
  { id: "trial-ending-reminder", concurrency, retries },
  { event: "billing/trial-ending" },
  async ({ event, step }) => {
    const { subscriptionId } = event.data;

    const sub = await step.run("load", async () => {
      const rows = await db
        .select({ sub: subscriptions, tenantName: tenants.name, tenantSlug: tenants.slug })
        .from(subscriptions)
        .innerJoin(tenants, eq(subscriptions.tenantId, tenants.id))
        .where(eq(subscriptions.id, subscriptionId))
        .limit(1);
      return rows[0] ?? null;
    });
    if (!sub) return { skipped: "not-found" };
    if (sub.sub.trialReminderSentAt) return { skipped: "already-sent" };
    if (!sub.sub.trialEndsAt) return { skipped: "no-trial" };

    // step.run returns JSON-serialized data, so Date became string.
    const trialEndsAt = new Date(sub.sub.trialEndsAt as unknown as string);
    const daysLeft = Math.max(
      0,
      Math.ceil((trialEndsAt.getTime() - Date.now()) / 86400000),
    );
    const billingUrl = `${getEnv().NEXT_PUBLIC_APP_URL}/billing`;
    const tpl = trialEndingEmail({ tenantName: sub.tenantName, daysLeft, billingUrl });

    // Send to all owners/admins
    const recipients = await step.run("recipients", async () => {
      const rows = await db.execute<{ email: string }>(sql`
        SELECT u.email FROM tenant_members tm
        JOIN users u ON u.id = tm.user_id
        WHERE tm.tenant_id = ${sub.sub.tenantId}
          AND tm.role IN ('owner','admin')`);
      return rows.rows.map((r) => r.email);
    });

    for (const to of recipients) {
      await step.run(`send-${to}`, () => sendEmail({ to, ...tpl, tag: "trial-ending" }));
    }
    await step.run("mark-sent", async () => {
      await db
        .update(subscriptions)
        .set({ trialReminderSentAt: new Date() })
        .where(and(eq(subscriptions.id, subscriptionId), isNull(subscriptions.trialReminderSentAt)));
    });
    return { sent: recipients.length };
  },
);

/* ------------------------------------------------------------------ */
/* billing/payment-failed                                              */
/* ------------------------------------------------------------------ */
export const handlePaymentFailed = inngest.createFunction(
  { id: "handle-payment-failed", concurrency, retries },
  { event: "billing/payment-failed" },
  async ({ event, step }) => {
    const { subscriptionId } = event.data;
    const sub = await step.run("load", async () => {
      const rows = await db
        .select({ sub: subscriptions, tenantName: tenants.name })
        .from(subscriptions)
        .innerJoin(tenants, eq(subscriptions.tenantId, tenants.id))
        .where(eq(subscriptions.id, subscriptionId))
        .limit(1);
      return rows[0] ?? null;
    });
    if (!sub) return { skipped: "not-found" };

    const billingUrl = `${getEnv().NEXT_PUBLIC_APP_URL}/billing`;
    const tpl = paymentFailedEmail({ tenantName: sub.tenantName, billingUrl });

    const recipients = await step.run("recipients", async () => {
      const rows = await db.execute<{ email: string }>(sql`
        SELECT u.email FROM tenant_members tm
        JOIN users u ON u.id = tm.user_id
        WHERE tm.tenant_id = ${sub.sub.tenantId} AND tm.role = 'owner'`);
      return rows.rows.map((r) => r.email);
    });
    for (const to of recipients) {
      await step.run(`send-${to}`, () => sendEmail({ to, ...tpl, tag: "payment-failed" }));
    }
    return { sent: recipients.length };
  },
);

/* ------------------------------------------------------------------ */
/* stripe/cleanup-events — purge processed events > 30 days            */
/* ------------------------------------------------------------------ */
export const cleanupStripeEvents = inngest.createFunction(
  { id: "cleanup-stripe-events", concurrency: { limit: 1 }, retries: 1 },
  { cron: "0 3 * * *" }, // daily 03:00 UTC
  async ({ step }) => {
    return step.run("purge", async () => {
      const cutoff = new Date(Date.now() - 30 * 86400000);
      await db.execute(
        sql`DELETE FROM processed_stripe_events WHERE processed_at < ${cutoff.toISOString()}`,
      );
      return { ok: true };
    });
  },
);

/* ------------------------------------------------------------------ */
/* schedule-trial-ending-reminders — daily cron emits per-sub events   */
/* ------------------------------------------------------------------ */
export const scheduleTrialEndingReminders = inngest.createFunction(
  { id: "schedule-trial-ending-reminders", concurrency: { limit: 1 }, retries: 2 },
  { cron: "0 9 * * *" }, // daily 09:00 UTC
  async ({ step }) => {
    const ids = await step.run("find-subs", async () => {
      const rows = await db.execute<{ id: string }>(sql`
        SELECT id FROM subscriptions
        WHERE trial_ends_at IS NOT NULL
          AND trial_ends_at > NOW()
          AND trial_ends_at < NOW() + INTERVAL '3 days'
          AND trial_reminder_sent_at IS NULL
      `);
      return rows.rows.map((r) => r.id);
    });
    if (ids.length === 0) return { dispatched: 0 };
    await step.sendEvent(
      "fan-out",
      ids.map((subscriptionId) => ({
        name: "billing/trial-ending" as const,
        data: { subscriptionId },
      })),
    );
    return { dispatched: ids.length };
  },
);

// Silence unused import warning while keeping `lt` available for future scheduled queries.
void lt;

/* ------------------------------------------------------------------ */
/* content/global.deck-changed — recall propagation for deck edits.    */
/*                                                                     */
/* Strategy: tenants that have NOT forked the deck inherit the update  */
/* automatically at read time (the listDecks resolver UNIONs globals + */
/* forks). Tenants WITH a fork have their own row; non-overridden      */
/* fields still inherit at read time. So at the data layer there is no */
/* per-tenant DB write needed for a global edit. This function exists  */
/* to (a) bump the fork's `source_version` so admins can see how stale */
/* their fork is, and (b) provide a fan-out hook for downstream cache  */
/* invalidation (study recs, search indexes) when we add them.         */
/* ------------------------------------------------------------------ */
export const propagateGlobalDeckChange = inngest.createFunction(
  { id: "propagate-global-deck-change", concurrency, retries },
  { event: "content/global.deck-changed" },
  async ({ event, step }) => {
    const { globalDeckId, version } = event.data;
    const updated = await step.run("bump-fork-versions", async () => {
      const rows = await db
        .update(tenantDecks)
        .set({ sourceVersion: version })
        .where(eq(tenantDecks.globalDeckId, globalDeckId))
        .returning({ tenantId: tenantDecks.tenantId });
      return rows.length;
    });
    return { globalDeckId, version, forksUpdated: updated };
  },
);

/* ------------------------------------------------------------------ */
/* content/global.card-changed — same idea for individual cards.       */
/* ------------------------------------------------------------------ */
export const propagateGlobalCardChange = inngest.createFunction(
  { id: "propagate-global-card-change", concurrency, retries },
  { event: "content/global.card-changed" },
  async ({ event, step }) => {
    const { globalCardId, version } = event.data;
    const updated = await step.run("bump-fork-versions", async () => {
      const rows = await db
        .update(tenantCards)
        .set({ sourceVersion: version })
        .where(eq(tenantCards.globalCardId, globalCardId))
        .returning({ id: tenantCards.id });
      return rows.length;
    });
    return { globalCardId, version, forksUpdated: updated };
  },
);

/* ------------------------------------------------------------------ */
/* study/streak.cron — nightly fan-out, one event per active user.      */
/* ------------------------------------------------------------------ */
export const scheduleStreakReconcile = inngest.createFunction(
  { id: "schedule-streak-reconcile", concurrency: { limit: 1 }, retries: 2 },
  { cron: "0 4 * * *" }, // 04:00 UTC — covers all NA timezones near local midnight
  async ({ step }) => {
    const ids = await step.run("collect", () => listUsersNeedingReconcile());
    if (ids.length === 0) return { dispatched: 0 };
    await step.sendEvent(
      "fan-out",
      ids.map((userId) => ({ name: "study/streak.reconcile" as const, data: { userId } })),
    );
    return { dispatched: ids.length };
  },
);

/* ------------------------------------------------------------------ */
/* study/streak.reconcile — single user reconciliation.                */
/* ------------------------------------------------------------------ */
export const runStreakReconcile = inngest.createFunction(
  { id: "run-streak-reconcile", concurrency, retries },
  { event: "study/streak.reconcile" },
  async ({ event, step }) => {
    const { userId } = event.data;
    return step.run("reconcile", () => reconcileStreak(userId));
  },
);

export const functions = [
  sendWelcomeEmail,
  provisionTenant,
  sendInviteEmail,
  trialEndingReminder,
  scheduleTrialEndingReminders,
  handlePaymentFailed,
  cleanupStripeEvents,
  propagateGlobalDeckChange,
  propagateGlobalCardChange,
  scheduleStreakReconcile,
  runStreakReconcile,
];

// Silence unused import warning while keeping `inArray` available for future fan-out jobs.
void inArray;
