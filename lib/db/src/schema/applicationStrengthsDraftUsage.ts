import { date, integer, pgTable, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./auth";

export const applicationStrengthsDraftUsageTable = pgTable(
  "application_strengths_draft_usage",
  {
    userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    usageDate: date("usage_date", { mode: "string" }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [
    uniqueIndex("application_strengths_draft_usage_user_date_idx")
      .on(table.userId, table.usageDate),
  ],
);
