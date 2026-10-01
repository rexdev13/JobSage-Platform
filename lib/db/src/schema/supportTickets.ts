import { createInsertSchema } from "drizzle-zod";
import { index, pgTable, serial, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { z } from "zod/v4";
import { usersTable } from "./auth";

export const supportTicketCategories = [
  "Visa Sponsorship",
  "Readiness Checks",
  "Account/Billing",
  "Technical Support",
  "Other",
] as const;

export const supportTicketStatuses = ["new", "in_review", "resolved"] as const;

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
    status: varchar("status", { enum: supportTicketStatuses }).notNull().default("new"),
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
  ],
);

export const insertSupportTicketSchema = createInsertSchema(supportTicketsTable).omit({
  id: true,
  userId: true,
  status: true,
  adminNotes: true,
  reviewedBy: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertSupportTicket = z.infer<typeof insertSupportTicketSchema>;
export type SupportTicket = typeof supportTicketsTable.$inferSelect;