import { index, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./auth";

export const employerDescriptionFeedbackTable = pgTable(
  "employer_description_feedback",
  {
    id: serial("id").primaryKey(),
    employerUserId: varchar("employer_user_id").references(() => usersTable.id, { onDelete: "set null" }),
    sentiment: varchar("sentiment", { enum: ["up", "down"] }).notNull(),
    jobTitle: text("job_title").notNull(),
    specialty: text("specialty"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("employer_description_feedback_created_at_idx").on(table.createdAt),
    index("employer_description_feedback_sentiment_idx").on(table.sentiment, table.createdAt),
    index("employer_description_feedback_user_id_idx").on(table.employerUserId),
  ],
);

export const insertEmployerDescriptionFeedbackSchema = createInsertSchema(employerDescriptionFeedbackTable).omit({
  id: true,
  createdAt: true,
});

export type InsertEmployerDescriptionFeedback = z.infer<typeof insertEmployerDescriptionFeedbackSchema>;
export type EmployerDescriptionFeedback = typeof employerDescriptionFeedbackTable.$inferSelect;