import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const privacyPreferencesTable = pgTable("privacy_preferences", {
  userId: varchar("user_id").primaryKey().references(() => usersTable.id, { onDelete: "cascade" }),
  marketing: boolean("marketing").notNull().default(false),
  optionalAnalytics: boolean("optional_analytics").notNull().default(false),
  notifications: jsonb("notifications").$type<Record<string, boolean>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Tokens never appear in read responses or log/audit payloads. */
export const pushDevicesTable = pgTable("push_devices", {
  tokenHash: varchar("token_hash", { length: 64 }).primaryKey(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  tokenCiphertext: varchar("token_ciphertext").notNull(),
  platform: varchar("platform", { enum: ["ios", "android"] }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("push_devices_user_idx").on(t.userId)]);

/** Private, generic push events. Expo payloads must never include message or document contents. */
export const pushNotificationOutboxTable = pgTable("push_notification_outbox", {
  id: varchar("id", { length: 36 }).primaryKey(),
  eventKey: varchar("event_key", { length: 180 }).notNull().unique(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  category: varchar("category", { enum: ["messages", "interviews", "applications", "eligibility", "documents", "jobAlerts"] }).notNull(),
  destination: varchar("destination", { length: 128 }).notNull(),
  state: varchar("state", { enum: ["queued", "sending", "sent", "retry", "skipped", "failed"] }).notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  lastErrorCode: varchar("last_error_code", { length: 80 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("push_outbox_category_check", sql`${t.category} IN ('messages','interviews','applications','eligibility','documents','jobAlerts')`),
  check("push_outbox_state_check", sql`${t.state} IN ('queued','sending','sent','retry','skipped','failed')`),
  index("push_outbox_claim_idx").on(t.state, t.availableAt),
  index("push_outbox_user_idx").on(t.userId, t.createdAt),
]);

export const pushNotificationDeliveriesTable = pgTable("push_notification_deliveries", {
  id: varchar("id", { length: 36 }).primaryKey(),
  notificationId: varchar("notification_id", { length: 36 }).notNull().references(() => pushNotificationOutboxTable.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull(),
  receiptId: varchar("receipt_id", { length: 128 }),
  state: varchar("state", { enum: ["retry", "receipt_pending", "delivered", "invalid", "failed"] }).notNull().default("retry"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  lastErrorCode: varchar("last_error_code", { length: 80 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("push_delivery_state_check", sql`${t.state} IN ('retry','receipt_pending','delivered','invalid','failed')`),
  uniqueIndex("push_delivery_event_token_unique").on(t.notificationId, t.tokenHash),
  index("push_delivery_receipt_idx").on(t.state, t.availableAt),
]);
