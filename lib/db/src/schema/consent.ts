import { pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const consentLogsTable = pgTable("consent_logs", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  termsVersion: text("terms_version").notNull(),
  ipHash: text("ip_hash"),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertConsentLogSchema = createInsertSchema(consentLogsTable).omit({ id: true, consentedAt: true });
export type InsertConsentLog = z.infer<typeof insertConsentLogSchema>;
export type ConsentLog = typeof consentLogsTable.$inferSelect;
