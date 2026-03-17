import { pgTable, serial, text, integer, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const DOCUMENT_DISCLAIMER = "Documents are uploaded for reference only and are not verified by JOBSAGE or any regulator.";

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  storageKey: text("storage_key").notNull(),
  fileSize: integer("file_size"),
  disclaimerText: text("disclaimer_text").notNull().default(DOCUMENT_DISCLAIMER),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({ id: true, uploadedAt: true });
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
