import { pgTable, serial, text, integer, timestamp, boolean, varchar } from "drizzle-orm/pg-core";

export const candidateMessagesTable = pgTable("candidate_messages", {
  id: serial("id").primaryKey(),
  senderEmployerProfileId: integer("sender_employer_profile_id"),
  recipientUserId: varchar("recipient_user_id").notNull(),
  vacancyId: integer("vacancy_id"),
  applicationId: integer("application_id"),
  messageType: varchar("message_type", { length: 20 }).notNull().default("employer"),
  messageText: text("message_text").notNull(),
  subject: text("subject").notNull().default("Message from an employer on JOBSAGE"),
  isRead: boolean("is_read").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CandidateMessage = typeof candidateMessagesTable.$inferSelect;
export type InsertCandidateMessage = typeof candidateMessagesTable.$inferInsert;
