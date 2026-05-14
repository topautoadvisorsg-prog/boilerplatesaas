/**
 * AUDIT_ACTIONS — frozen enum of every action that may be logged.
 * Adding a new action here is the only way to introduce a new audit type.
 */
export const AUDIT_ACTIONS = {
  // Tenant lifecycle
  TENANT_CREATED: "tenant.created",
  TENANT_UPDATED: "tenant.updated",
  TENANT_DELETED: "tenant.deleted",

  // Member lifecycle
  MEMBER_INVITED: "member.invited",
  MEMBER_INVITE_ACCEPTED: "member.invite_accepted",
  MEMBER_REMOVED: "member.removed",
  MEMBER_ROLE_CHANGED: "member.role_changed",

  // Billing
  SUBSCRIPTION_CREATED: "subscription.created",
  SUBSCRIPTION_UPDATED: "subscription.updated",
  SUBSCRIPTION_CANCELED: "subscription.canceled",
  PAYMENT_FAILED: "payment.failed",

  // Admin
  ADMIN_TENANT_ACCESSED: "admin.tenant_accessed",
  ADMIN_USER_ACCESSED: "admin.user_accessed",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
