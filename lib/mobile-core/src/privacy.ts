export const PRIVACY_POLICY_VERSION = "2026-10-12";
export const NOTIFICATION_CATEGORIES = ["messages", "interviews", "applications", "eligibility", "documents", "jobAlerts"] as const;
export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[number];
export const DEFAULT_NOTIFICATION_CHOICES = Object.fromEntries(NOTIFICATION_CATEGORIES.map(key => [key, true])) as Record<NotificationCategory, boolean>;
export const PRIVACY_ROLES = ["candidate", "employer", "reviewer", "admin", "marketing", "super_admin"] as const;
