import { pgTable, serial, text, integer, timestamp, varchar } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const ApplicationStatus = {
  applied: "applied",
  shortlisted: "shortlisted",
  interview: "interview",
  interview_invited: "interview_invited",
  under_review: "under_review",
  offer: "offer",
  rejected: "rejected",
  no_response: "no_response",
} as const;

export type ApplicationStatusType = (typeof ApplicationStatus)[keyof typeof ApplicationStatus];

export const applicationsTable = pgTable("applications", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  roleId: integer("role_id").notNull().default(0),
  applicationType: varchar("application_type", {
    enum: ["platform", "website"],
  })
    .notNull()
    .default("platform"),
  applicationUrl: text("application_url"),
  companyName: text("company_name"),
  status: varchar("status", {
    enum: ["applied", "shortlisted", "interview", "interview_invited", "under_review", "offer", "rejected", "no_response"],
  })
    .notNull()
    .default("applied"),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
  interviewDate: timestamp("interview_date", { withTimezone: true }),
  interviewNotes: text("interview_notes"),
  cvDocumentId: integer("cv_document_id"),
});

export const applicationStatusValues = z.enum(["applied", "shortlisted", "interview", "interview_invited", "under_review", "offer", "rejected", "no_response"]);
export type Application = typeof applicationsTable.$inferSelect;
