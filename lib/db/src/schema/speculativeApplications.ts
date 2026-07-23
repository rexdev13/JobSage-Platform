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
    emailSent: boolean("email_sent").notNull().default(false),
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    emailRecipient: text("email_recipient"),
    jobsageEmail: text("jobsage_email"),
    vacancyTitle: text("vacancy_title"),
    /**
     * Which lookup step resolved the employer recipient:
     * "employer_account"      – registered JOBSAGE employer
     * "sponsor_contact_email" – stored contactEmail on the sponsor licence record
     * "ai_enrichment"         – discovered on-demand via AI web search
     * "ops_fallback"          – no email found; routed to ops inbox
     */
    deliveryRoute: varchar("delivery_route", {
      enum: ["employer_account", "sponsor_contact_email", "ai_enrichment", "ops_fallback"],
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("speculative_apps_user_idx").on(t.userId)],
);

export type SpeculativeApplication = typeof speculativeApplicationsTable.$inferSelect;
export type InsertSpeculativeApplication = typeof speculativeApplicationsTable.$inferInsert;
