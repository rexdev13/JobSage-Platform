import { date, integer, pgTable, serial, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * One row per London calendar day. The unique date lets the API atomically
 * reserve configured AI web-search capacity across workers and restarts.
 */
export const vacancyAiUsageTable = pgTable(
  "vacancy_ai_usage",
  {
    id: serial("id").primaryKey(),
    londonDate: date("london_date").notNull(),
    usedCount: integer("used_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("vacancy_ai_usage_london_date_idx").on(t.londonDate)],
);

export type VacancyAiUsage = typeof vacancyAiUsageTable.$inferSelect;
export type InsertVacancyAiUsage = typeof vacancyAiUsageTable.$inferInsert;