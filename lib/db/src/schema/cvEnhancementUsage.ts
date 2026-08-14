import { pgTable, serial, varchar, date, integer, uniqueIndex } from "drizzle-orm/pg-core";

export const cvEnhancementUsageTable = pgTable(
  "cv_enhancement_usage",
  {
    id:        serial("id").primaryKey(),
    userId:    varchar("user_id").notNull(),
    usageDate: date("usage_date").notNull(),
    count:     integer("count").notNull().default(0),
  },
  (t) => [uniqueIndex("cv_enhancement_usage_user_date_idx").on(t.userId, t.usageDate)],
);
