import { date, integer, pgTable, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export const applicationStrengthsDraftUsageTable = pgTable(
  "application_strengths_draft_usage",
  {
    userId: varchar("user_id").notNull(),
    usageDate: date("usage_date", { mode: "string" }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("application_strengths_draft_usage_user_date_idx")
      .on(table.userId, table.usageDate),
  ],
);
