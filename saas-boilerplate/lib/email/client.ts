/**
 * Email sender.
 *
 * When FEATURE_EMAIL_ENABLED=true and RESEND_API_KEY is set, real send via Resend.
 * Otherwise logs and returns a stub id.
 *
 * Idempotency is enforced by callers via `*_sent_at` columns; this transport
 * is intentionally dumb.
 */
import { getEnv } from "@/lib/env";
import { features } from "@/lib/config/features";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
  tag?: string;
}

export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const { EMAIL_FROM, RESEND_API_KEY } = getEnv();

  if (features.emailEnabled) {
    // Lazy import so the SDK isn't bundled when the flag is off.
    const { Resend } = await import("resend");
    const resend = new Resend(RESEND_API_KEY);
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text ?? "",
      tags: input.tag ? [{ name: "category", value: input.tag }] : undefined,
    });
    if (error) throw error;
    return { id: data?.id ?? "unknown" };
  }

  console.log("[email:stub]", {
    from: EMAIL_FROM,
    to: input.to,
    subject: input.subject,
    tag: input.tag ?? null,
    preview: input.text ?? input.html.slice(0, 120),
  });
  return { id: `stub_${Date.now()}` };
}
