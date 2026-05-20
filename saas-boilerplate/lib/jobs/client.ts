import { Inngest } from "inngest";
import { appConfig } from "@/lib/config/app";

export const inngest = new Inngest({
  id: appConfig.inngestAppId,
  name: appConfig.name,
});

export type AppEvents = {
  "user/welcome.email": { data: { userId: string } };
  "tenant/provision": { data: { tenantId: string } };
  "team/invite.email": { data: { invitationId: string } };
  "billing/trial-ending": { data: { subscriptionId: string } };
  "billing/payment-failed": { data: { subscriptionId: string } };
  "stripe/cleanup-events": Record<string, never>;
  /** Fired when the platform updates a `global_decks` row. */
  "content/global.deck-changed": { data: { globalDeckId: string; version: number } };
  /** Fired when the platform updates a `global_cards` row. */
  "content/global.card-changed": { data: { globalCardId: string; version: number } };
  /** Fan-out: reconcile a single user's streak. */
  "study/streak.reconcile": { data: { userId: string } };
  /** Nightly cron — emits one `study/streak.reconcile` per active user. */
  "study/streak.cron": Record<string, never>;
};
