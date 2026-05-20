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

  // Regions
  REGION_SELECTED: "region.selected",
  REGION_REMOVED: "region.removed",
  REGION_PRIMARY_CHANGED: "region.primary_changed",

  // Content (tenant CMS)
  CONTENT_DECK_FORKED: "content.deck_forked",
  CONTENT_DECK_CREATED: "content.deck_created",
  CONTENT_DECK_UPDATED: "content.deck_updated",
  CONTENT_DECK_ARCHIVED: "content.deck_archived",
  CONTENT_CARD_FORKED: "content.card_forked",
  CONTENT_CARD_CREATED: "content.card_created",
  CONTENT_CARD_UPDATED: "content.card_updated",
  CONTENT_CARD_ARCHIVED: "content.card_archived",

  // Content (global, platform-admin)
  CONTENT_GLOBAL_DECK_UPDATED: "content.global_deck_updated",
  CONTENT_GLOBAL_CARD_UPDATED: "content.global_card_updated",

  // Study (Phase 4)
  STUDY_SESSION_STARTED: "study.session_started",
  STUDY_SESSION_ENDED: "study.session_ended",
  STUDY_CARD_RATED: "study.card_rated",
  STUDY_DAILY_LIMIT_HIT: "study.daily_limit_hit",
  STREAK_INCREMENTED: "study.streak_incremented",
  STREAK_BROKEN: "study.streak_broken",

  // Admin
  ADMIN_TENANT_ACCESSED: "admin.tenant_accessed",
  ADMIN_USER_ACCESSED: "admin.user_accessed",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
