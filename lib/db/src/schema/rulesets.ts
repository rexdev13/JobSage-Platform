import { pgTable, serial, text, integer, timestamp, varchar, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const rulesetsTable = pgTable("rulesets", {
  id: serial("id").primaryKey(),
  regulator: text("regulator").notNull(),
  version: varchar("version").notNull(),
  status: varchar("status", { enum: ["draft", "published"] }).notNull().default("draft"),
  effectiveDate: timestamp("effective_date", { withTimezone: true }).notNull(),
  changelog: text("changelog").notNull(),
  createdBy: varchar("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRulesetSchema = createInsertSchema(rulesetsTable).omit({ id: true, createdAt: true });
export type InsertRuleset = z.infer<typeof insertRulesetSchema>;
export type Ruleset = typeof rulesetsTable.$inferSelect;

export type RuleConditionOperator = "eq" | "neq" | "in" | "not_in" | "gte" | "lte" | "exists";

export type RuleCondition = {
  field: string;
  operator: RuleConditionOperator;
  value?: unknown;
};

export const rulesetRulesTable = pgTable("ruleset_rules", {
  id: serial("id").primaryKey(),
  rulesetId: integer("ruleset_id").notNull().references(() => rulesetsTable.id, { onDelete: "cascade" }),
  ruleKey: varchar("rule_key").notNull(),
  conditions: json("conditions").$type<RuleCondition[]>().notNull(),
  outcome: varchar("outcome", { enum: ["eligible", "not_eligible", "ineligible"] }).notNull(),
  reasonCode: varchar("reason_code").notNull(),
  explanationText: text("explanation_text").notNull(),
  pathways: json("pathways").$type<string[]>(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertRulesetRuleSchema = createInsertSchema(rulesetRulesTable).omit({ id: true });
export type InsertRulesetRule = z.infer<typeof insertRulesetRuleSchema>;
export type RulesetRule = typeof rulesetRulesTable.$inferSelect;

export const decisionRecordsTable = pgTable("decision_records", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  profileSnapshotHash: varchar("profile_snapshot_hash").notNull(),
  rulesetId: integer("ruleset_id").notNull().references(() => rulesetsTable.id),
  rulesetVersion: varchar("ruleset_version").notNull(),
  outcome: varchar("outcome", { enum: ["eligible", "not_eligible", "ineligible"] }).notNull(),
  reasonCodes: json("reason_codes").$type<string[]>().notNull(),
  explanationText: text("explanation_text").notNull(),
  pathways: json("pathways").$type<string[]>(),
  reviewFlagged: integer("review_flagged").notNull().default(0),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDecisionRecordSchema = createInsertSchema(decisionRecordsTable).omit({ id: true, createdAt: true });
export type InsertDecisionRecord = z.infer<typeof insertDecisionRecordSchema>;
export type DecisionRecord = typeof decisionRecordsTable.$inferSelect;
