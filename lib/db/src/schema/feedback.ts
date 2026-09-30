import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./auth";

export const feedbackTable = pgTable(
  "feedback",
  {
    id: serial("id").primaryKey(),
    category: varchar("category", { enum: ["issue", "idea", "general"] }).notNull(),
    message: text("message").notNull(),
    email: varchar("email", { length: 254 }),
    pageUrl: text("page_url").notNull(),
    screenResolution: varchar("screen_resolution", { length: 64 }).notNull(),
    userId: varchar("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    userAgent: text("user_agent"),
    status: varchar("status", { enum: ["new", "in_review", "resolved"] })
      .notNull()
      .default("new"),
    adminNotes: text("admin_notes"),
    reviewedBy: varchar("reviewed_by").references(() => usersTable.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("feedback_category_idx").on(table.category),
    index("feedback_status_created_at_idx").on(table.status, table.createdAt),
    index("feedback_user_id_idx").on(table.userId),
  ],
);

export const insertFeedbackSchema = createInsertSchema(feedbackTable).omit({
  id: true,
  userId: true,
  userAgent: true,
  status: true,
  adminNotes: true,
  reviewedBy: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertFeedback = z.infer<typeof insertFeedbackSchema>;
export type Feedback = typeof feedbackTable.$inferSelect;