import { pgTable, serial, text, integer, timestamp, varchar, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { decisionRecordsTable } from "./rulesets";

export const remediationPlansTable = pgTable("remediation_plans", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  decisionRecordId: integer("decision_record_id").notNull().references(() => decisionRecordsTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("remediation_plans_user_decision_uniq").on(t.userId, t.decisionRecordId),
]);

export const insertRemediationPlanSchema = createInsertSchema(remediationPlansTable).omit({ id: true, createdAt: true });
export type InsertRemediationPlan = z.infer<typeof insertRemediationPlanSchema>;
export type RemediationPlan = typeof remediationPlansTable.$inferSelect;

export const remediationStepsTable = pgTable("remediation_steps", {
  id: serial("id").primaryKey(),
  planId: integer("plan_id").notNull().references(() => remediationPlansTable.id, { onDelete: "cascade" }),
  stepOrder: integer("step_order").notNull().default(0),
  title: text("title").notNull(),
  description: text("description").notNull(),
  gap: text("gap").notNull(),
  timelineRange: text("timeline_range"),
  costRange: text("cost_range"),
  pathway: text("pathway"),
  stepSource: varchar("step_source", { enum: ["rule", "sponsorship", "manual"] }).notNull().default("rule"),
  ruleId: integer("rule_id"),
  rulesetVersion: varchar("ruleset_version").notNull(),
  status: varchar("status", { enum: ["planned", "in_progress", "done"] }).notNull().default("planned"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertRemediationStepSchema = createInsertSchema(remediationStepsTable).omit({ id: true, updatedAt: true });
export type InsertRemediationStep = z.infer<typeof insertRemediationStepSchema>;
export type RemediationStep = typeof remediationStepsTable.$inferSelect;
