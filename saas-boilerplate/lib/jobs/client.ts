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
};
