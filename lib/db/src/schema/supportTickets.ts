import { createInsertSchema } from "drizzle-zod";
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./auth";
import { candidateMessagesTable } from "./candidateMessages";

export const supportTicketCategories = [
  "Visa Sponsorship",
  "Readiness Checks",
  "Account/Billing",
  "Technical Support",
  "Other",
] as const;

export const supportTicketStatuses = ["new", "in_review", "attended", "resolved"] as const;
export const supportTicketSeverities = ["low", "normal", "high", "urgent"] as const;

export const supportTicketsTable = pgTable(
  "support_tickets",
  {
    id: serial("id").primaryKey(),
    ticketId: varchar("ticket_id", { length: 13 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    email: varchar("email", { length: 254 }).notNull(),
    category: varchar("category", { enum: supportTicketCategories }).notNull(),
    subject: varchar("subject", { length: 180 }).notNull(),
    message: text("message").notNull(),
    userId: varchar("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    isContentReport: boolean("is_content_report").notNull().default(false),
    status: varchar("status", { enum: supportTicketStatuses }).notNull().default("new"),
    severity: varchar("severity", { enum: supportTicketSeverities }).notNull().default("normal"),
    assignedModeratorId: varchar("assigned_moderator_id").references(() => usersTable.id, { onDelete: "set null" }),
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
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
    uniqueIndex("support_tickets_ticket_id_unique").on(table.ticketId),
    index("support_tickets_status_created_at_idx").on(table.status, table.createdAt),
    index("support_tickets_user_id_idx").on(table.userId),
    index("support_tickets_moderation_queue_idx").on(table.isContentReport, table.status, table.severity, table.createdAt),
    check("support_tickets_severity_check", sql`${table.severity} IN ('low', 'normal', 'high', 'urgent')`),
  ],
);

export const supportTicketRepliesTable = pgTable(
  "support_ticket_replies",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id")
      .notNull()
      .references(() => supportTicketsTable.id, { onDelete: "cascade" }),
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
    index("support_ticket_replies_ticket_created_at_idx").on(table.ticketId, table.createdAt),
    index("support_ticket_replies_admin_user_id_idx").on(table.adminUserId),
  ],
);

export const insertSupportTicketSchema = createInsertSchema(supportTicketsTable).omit({
  id: true,
  userId: true,
  status: true,
  isContentReport: true,
  severity: true,
  assignedModeratorId: true,
  escalatedAt: true,
  adminNotes: true,
  reviewedBy: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTicketsTable.$inferSelect;
export type SupportTicketReply = typeof supportTicketRepliesTable.$inferSelect;