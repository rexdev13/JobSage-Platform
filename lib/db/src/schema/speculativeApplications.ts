import { pgTable, serial, text, integer, timestamp, varchar, boolean, index } from "drizzle-orm/pg-core";

export const speculativeApplicationsTable = pgTable(
  "speculative_applications",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id").notNull(),
    companyName: text("company_name").notNull(),
    sponsorLicenceId: integer("sponsor_licence_id"),
    status: varchar("status", { enum: ["sent", "acknowledged", "no_account"] })
      .notNull()
      .default("sent"),
    notes: text("notes"),
    cvDocumentId: integer("cv_document_id"),
    emailSent: boolean("email_sent").notNull().default(false),
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    emailRecipient: text("email_recipient"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("speculative_apps_user_idx").on(t.userId)],
);

export type SpeculativeApplication = typeof speculativeApplicationsTable.$inferSelect;
export type InsertSpeculativeApplication = typeof speculativeApplicationsTable.$inferInsert;
