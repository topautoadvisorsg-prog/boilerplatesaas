import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "saas-boilerplate",
  name: "SaaS Boilerplate",
});

/**
 * Centralized event-name registry — any new job event must be added here so
 * the type system catches typos.
 */
export type AppEvents = {
  "user/welcome.email": { data: { userId: string } };
  "tenant/provision": { data: { tenantId: string } };
  "team/invite.email": { data: { invitationId: string } };
  "billing/trial-ending": { data: { subscriptionId: string } };
  "billing/payment-failed": { data: { subscriptionId: string } };
  "stripe/cleanup-events": Record<string, never>;
};
