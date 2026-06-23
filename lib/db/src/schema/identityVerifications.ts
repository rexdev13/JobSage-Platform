import { pgTable, serial, varchar, text, timestamp } from "drizzle-orm/pg-core";

export const IdentityVerificationStatus = {
  pending: "pending",
  verified: "verified",
  rejected: "rejected",
} as const;

export const identityVerificationsTable = pgTable("identity_verifications", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().unique(),
  passportKey: text("passport_key"),
  selfieKey: text("selfie_key"),
  status: varchar("status", { enum: ["pending", "verified", "rejected"] })
    .notNull()
    .default("pending"),
  aiConfidence: varchar("ai_confidence", { enum: ["high", "medium", "low", "none"] }),
  aiNotes: text("ai_notes"),
  adminNotes: text("admin_notes"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type IdentityVerification = typeof identityVerificationsTable.$inferSelect;
