import { pgTable, serial, varchar, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { usersTable } from "./auth";

export const messageSenderBlocksTable = pgTable("message_sender_blocks", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  senderKey: text("sender_key").notNull(),
  senderLabel: text("sender_label").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [uniqueIndex("message_sender_blocks_owner_sender_idx").on(table.userId, table.senderKey)]);
export const insertMessageSenderBlockSchema = createInsertSchema(messageSenderBlocksTable).omit({ id: true, createdAt: true });
export type MessageSenderBlock = typeof messageSenderBlocksTable.$inferSelect;
