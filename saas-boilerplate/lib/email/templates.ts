/**
 * Plain, mobile-readable HTML templates. Single CTA per email.
 */
export function welcomeEmail(args: { name: string | null; appUrl: string }): { subject: string; html: string; text: string } {
  const display = args.name ?? "there";
  return {
    subject: "Welcome — let's get you set up",
    text: `Hi ${display},\n\nWelcome aboard. Get started: ${args.appUrl}/onboarding\n`,
    html: `<p>Hi ${display},</p><p>Welcome aboard.</p><p><a href="${args.appUrl}/onboarding">Get started</a></p>`,
  };
}

export function inviteEmail(args: { tenantName: string; inviterName: string; acceptUrl: string }): { subject: string; html: string; text: string } {
  return {
    subject: `You're invited to ${args.tenantName}`,
    text: `${args.inviterName} invited you to ${args.tenantName}. Accept: ${args.acceptUrl}`,
    html: `<p><strong>${args.inviterName}</strong> invited you to <strong>${args.tenantName}</strong>.</p><p><a href="${args.acceptUrl}">Accept invitation</a></p>`,
  };
}

export function trialEndingEmail(args: { tenantName: string; daysLeft: number; billingUrl: string }): { subject: string; html: string; text: string } {
  return {
    subject: `Your trial ends in ${args.daysLeft} days`,
    text: `Your ${args.tenantName} trial ends in ${args.daysLeft} days. Add payment: ${args.billingUrl}`,
    html: `<p>Your <strong>${args.tenantName}</strong> trial ends in <strong>${args.daysLeft} days</strong>.</p><p><a href="${args.billingUrl}">Add payment method</a></p>`,
  };
}

export function paymentFailedEmail(args: { tenantName: string; billingUrl: string }): { subject: string; html: string; text: string } {
  return {
    subject: `Payment failed for ${args.tenantName}`,
    text: `We couldn't charge your card. Update billing: ${args.billingUrl}`,
    html: `<p>We couldn't charge your card for <strong>${args.tenantName}</strong>.</p><p><a href="${args.billingUrl}">Update billing</a></p>`,
  };
}

export function subscriptionCanceledEmail(args: { tenantName: string; periodEnd: string }): { subject: string; html: string; text: string } {
  return {
    subject: `Subscription canceled for ${args.tenantName}`,
    text: `Your subscription will end on ${args.periodEnd}.`,
    html: `<p>Your <strong>${args.tenantName}</strong> subscription will end on <strong>${args.periodEnd}</strong>.</p>`,
  };
}
