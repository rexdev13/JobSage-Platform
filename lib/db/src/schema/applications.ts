import { pgTable, serial, text, integer, timestamp, varchar } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const ApplicationStatus = {
  applied: "applied",
  shortlisted: "shortlisted",
  interview: "interview",
  offer: "offer",
  rejected: "rejected",
  no_response: "no_response",
} as const;

export type ApplicationStatusType = (typeof ApplicationStatus)[keyof typeof ApplicationStatus];

export const applicationsTable = pgTable("applications", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  roleId: integer("role_id").notNull(),
  status: varchar("status", {
    enum: ["applied", "shortlisted", "interview", "offer", "rejected", "no_response"],
  })
    .notNull()
    .default("applied"),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
});

export const applicationStatusValues = z.enum(["applied", "shortlisted", "interview", "offer", "rejected", "no_response"]);
export type Application = typeof applicationsTable.$inferSelect;
