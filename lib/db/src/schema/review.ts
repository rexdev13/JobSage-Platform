import { pgTable, serial, text, integer, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { decisionRecordsTable } from "./rulesets";

export const reviewCasesTable = pgTable("review_cases", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  decisionRecordId: integer("decision_record_id").notNull().references(() => decisionRecordsTable.id, { onDelete: "cascade" }),
  flagReason: text("flag_reason").notNull(),
  status: varchar("status", { enum: ["pending", "reviewed"] }).notNull().default("pending"),
  reviewedBy: varchar("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertReviewCaseSchema = createInsertSchema(reviewCasesTable).omit({ id: true, createdAt: true });
export type InsertReviewCase = z.infer<typeof insertReviewCaseSchema>;
export type ReviewCase = typeof reviewCasesTable.$inferSelect;

export const reviewAnnotationsTable = pgTable("review_annotations", {
  id: serial("id").primaryKey(),
  caseId: integer("case_id").notNull().references(() => reviewCasesTable.id, { onDelete: "cascade" }),
  reviewerId: varchar("reviewer_id").notNull(),
  notes: text("notes").notNull(),
  recommendedPathway: text("recommended_pathway"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertReviewAnnotationSchema = createInsertSchema(reviewAnnotationsTable).omit({ id: true, createdAt: true });
export type InsertReviewAnnotation = z.infer<typeof insertReviewAnnotationSchema>;
export type ReviewAnnotation = typeof reviewAnnotationsTable.$inferSelect;
