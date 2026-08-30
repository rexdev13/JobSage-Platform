import { pgTable, serial, text, integer, timestamp, varchar, boolean, index } from "drizzle-orm/pg-core";

export const speculativeApplicationsTable = pgTable(
  "speculative_applications",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id").notNull(),
    companyName: text("company_name").notNull(),
    sponsorLicenceId: integer("sponsor_licence_id"),
    status: varchar("status", {
      enum: ["cv_sent", "sent", "acknowledged", "no_account", "under_review", "interview_invited", "offer", "rejected"],
    })
      .notNull()
      .default("cv_sent"),
    notes: text("notes"),
    cvDocumentId: integer("cv_document_id"),
    vacancyRef: text("vacancy_ref"),
    roleId: integer("role_id"),
    vacancyUrl: text("vacancy_url"),
    sourceType: varchar("source_type", { enum: ["job_board", "company_site"] }),
    boardName: text("board_name"),
    emailSent: boolean("email_sent").notNull().default(false),
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    emailRecipient: text("email_recipient"),
    jobsageEmail: text("jobsage_email"),
    vacancyTitle: text("vacancy_title"),
    deliveryStatus: varchar("delivery_status", {
      enum: ["pending", "delivered", "failed"],
    })
      .notNull()
      .default("pending"),
    deliveryError: text("delivery_error"),
    deliveryAttempts: integer("delivery_attempts").notNull().default(0),
    lastDeliveryAttemptAt: timestamp("last_delivery_attempt_at", { withTimezone: true }),
    attachmentType: varchar("attachment_type", { enum: ["pdf"] }),
    /**
     * Which lookup step resolved the employer recipient:
     * "employer_contact_email" – stored email on an employer profile
     * "employer_account"      – registered JOBSAGE employer
     * "sponsor_contact_email" – stored contactEmail on the sponsor licence record
     * "ops_fallback"          – no email found; routed to ops inbox
     */
    deliveryRoute: varchar("delivery_route", {
      enum: ["employer_contact_email", "employer_account", "sponsor_contact_email", "ai_enrichment", "ops_fallback"],
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("speculative_apps_user_idx").on(t.userId),
    index("speculative_apps_user_vacancy_idx").on(t.userId, t.vacancyRef),
  ],
);

export const speculativeApplicationDeliveryAttemptsTable = pgTable(
  "speculative_application_delivery_attempts",
  {
    id: serial("id").primaryKey(),
    speculativeApplicationId: integer("speculative_application_id").notNull(),
    userId: varchar("user_id").notNull(),
    outcome: varchar("outcome", { enum: ["pending", "delivered", "failed"] })
      .notNull()
      .default("pending"),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [
    index("speculative_delivery_attempts_user_time_idx").on(t.userId, t.attemptedAt),
    index("speculative_delivery_attempts_application_idx").on(t.speculativeApplicationId),
  ],
);

export type SpeculativeApplication = typeof speculativeApplicationsTable.$inferSelect;
export type InsertSpeculativeApplication = typeof speculativeApplicationsTable.$inferInsert;
export type SpeculativeApplicationDeliveryAttempt = typeof speculativeApplicationDeliveryAttemptsTable.$inferSelect;
