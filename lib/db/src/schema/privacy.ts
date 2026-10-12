import { boolean, index, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
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
