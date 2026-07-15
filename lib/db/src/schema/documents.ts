import { pgTable, serial, text, integer, timestamp, varchar, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const DOCUMENT_DISCLAIMER = "Documents are uploaded for reference only and are not verified by JOBSAGE or any regulator.";

export const DOCUMENT_TYPES = [
  "cv",
  "qualification",
  "cpd_certificate",
  "recommendation_letter",
  "passport",
  "proof_of_address",
  "other",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  cv: "CV / Résumé",
  qualification: "Qualification",
  cpd_certificate: "CPD Certificate",
  recommendation_letter: "Recommendation Letter",
  passport: "Passport",
  proof_of_address: "Proof of Address",
  other: "Other",
};

export const documentsTable = pgTable("documents", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  filename: text("filename").notNull(),
  mimeType: text("mime_type").notNull(),
  storageKey: text("storage_key").notNull(),
  fileSize: integer("file_size"),
  documentType: text("document_type"),
  label: text("label"),
  isPrimary: boolean("is_primary").notNull().default(false),
  disclaimerText: text("disclaimer_text").notNull().default(DOCUMENT_DISCLAIMER),
  parsedData: jsonb("parsed_data"),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({ id: true, uploadedAt: true });
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;
