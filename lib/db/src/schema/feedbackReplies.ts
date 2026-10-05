import { createInsertSchema } from "drizzle-zod";
import { index, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { candidateMessagesTable } from "./candidateMessages";
import { feedbackTable } from "./feedback";

export const feedbackRepliesTable = pgTable(
  "feedback_replies",
  {
    id: serial("id").primaryKey(),
    feedbackId: integer("feedback_id")
      .notNull()
      .references(() => feedbackTable.id, { onDelete: "cascade" }),
    adminUserId: varchar("admin_user_id").notNull(),
    adminDisplayName: text("admin_display_name").notNull(),
    replyText: text("reply_text").notNull(),
    deliveryChannel: varchar("delivery_channel", { enum: ["inbox", "email"] }).notNull(),
    deliveryStatus: varchar("delivery_status", { enum: ["sent", "failed"] }).notNull(),
    candidateMessageId: integer("candidate_message_id").references(() => candidateMessagesTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("feedback_replies_feedback_created_at_idx").on(table.feedbackId, table.createdAt),
    index("feedback_replies_admin_user_id_idx").on(table.adminUserId),
  ],
);

export const insertFeedbackReplySchema = createInsertSchema(feedbackRepliesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertFeedbackReply = z.infer<typeof insertFeedbackReplySchema>;
export type FeedbackReply = typeof feedbackRepliesTable.$inferSelect;
