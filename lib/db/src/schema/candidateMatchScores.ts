import { pgTable, serial, text, integer, timestamp, varchar, unique } from "drizzle-orm/pg-core";

export const candidateMatchScoresTable = pgTable("candidate_match_scores", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  roleId: integer("role_id").notNull(),
  score: integer("score").notNull(),
  aiExplanation: text("ai_explanation").notNull(),
  scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
});

export const matchDismissalsTable = pgTable(
  "match_dismissals",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id").notNull(),
    roleId: integer("role_id").notNull(),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueUserRole: unique("match_dismissals_user_role_unique").on(t.userId, t.roleId),
  }),
);
