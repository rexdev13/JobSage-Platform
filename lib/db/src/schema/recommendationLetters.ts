import { pgTable, serial, text, varchar, boolean, timestamp } from "drizzle-orm/pg-core";

export const recommendationLettersTable = pgTable("recommendation_letters", {
  id: serial("id").primaryKey(),
  candidateUserId: varchar("candidate_user_id").notNull(),
  employerUserId: varchar("employer_user_id"),
  authorName: text("author_name").notNull(),
  authorTitle: text("author_title").notNull(),
  organisation: text("organisation").notNull(),
  relationship: text("relationship").notNull(),
  content: text("content").notNull(),
  isEmployerVerified: boolean("is_employer_verified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RecommendationLetter = typeof recommendationLettersTable.$inferSelect;
