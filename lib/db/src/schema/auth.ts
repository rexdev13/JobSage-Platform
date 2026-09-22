import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const sessionsTable = pgTable(
  "user_sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

export const usersTable = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: varchar("email").unique(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  calendlyUrl: varchar("calendly_url"),
  googleBookingSlug: varchar("google_booking_slug"),
  googleBookingEnabled: boolean("google_booking_enabled").notNull().default(true),
  googleBookingTimezone: varchar("google_booking_timezone").notNull().default("Europe/London"),
  googleCalendarRefreshToken: text("google_calendar_refresh_token"),
  googleCalendarAccountEmail: varchar("google_calendar_account_email"),
  googleCalendarConnectedAt: timestamp("google_calendar_connected_at", { withTimezone: true }),
  role: varchar("role", { enum: ["candidate", "admin", "reviewer", "employer", "super_admin", "marketing"] }).notNull().default("candidate"),
  passwordHash: varchar("password_hash"),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerifyToken: varchar("email_verify_token"),
  emailVerifyTokenExpires: timestamp("email_verify_token_expires", { withTimezone: true }),
  passwordResetToken: varchar("password_reset_token"),
  passwordResetTokenExpires: timestamp("password_reset_token_expires", { withTimezone: true }),
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  /** Auto-assigned JOBSAGE communication alias — assigned at registration and stable for life */
  jobsageEmail: text("jobsage_email").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  uniqueIndex("users_google_booking_slug_idx").on(table.googleBookingSlug),
]);

export type UpsertUser = typeof usersTable.$inferInsert;
export type User = typeof usersTable.$inferSelect;
