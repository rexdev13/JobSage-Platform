import { pgTable, serial, timestamp, integer, text, varchar, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Candidate statements about readiness gaps that are useful context for future
 * checks, but are deliberately separate from regulated profile fields.
 */
export const candidateReadinessClaimsTable = pgTable(
  "candidate_readiness_claims",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id").notNull(),
    claimKey: varchar("claim_key", { length: 255 }).notNull(),
    claimText: text("claim_text").notNull(),
    sourceRoleId: integer("source_role_id"),
    sourceVacancyId: integer("source_vacancy_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("candidate_readiness_claims_user_key_idx").on(t.userId, t.claimKey),
    index("candidate_readiness_claims_user_idx").on(t.userId),
  ],
);

export const insertCandidateReadinessClaimSchema = createInsertSchema(candidateReadinessClaimsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCandidateReadinessClaim = z.infer<typeof insertCandidateReadinessClaimSchema>;
export type CandidateReadinessClaim = typeof candidateReadinessClaimsTable.$inferSelect;