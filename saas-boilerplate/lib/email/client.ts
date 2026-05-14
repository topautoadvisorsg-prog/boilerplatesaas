/**
 * Email sender — STUBBED for boilerplate. Logs the email and records the
 * send timestamp in DB-bound `*_sent_at` columns so idempotency works.
 *
 * Swap `sendEmail` to call Resend when you're ready:
 *   const resend = new Resend(getEnv().RESEND_API_KEY);
 *   await resend.emails.send({ from, to, subject, react: template });
 */
import { getEnv } from "@/lib/env";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  tag?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const { EMAIL_FROM } = getEnv();
  console.log("[email:stub]", {
    from: EMAIL_FROM,
    to: input.to,
    subject: input.subject,
    tag: input.tag ?? null,
    preview: input.text ?? input.html.slice(0, 120),
  });
  return { id: `stub_${Date.now()}` };
}
