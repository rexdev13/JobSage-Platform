import { pgTable, serial, text, integer, timestamp, varchar, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const rolesTable = pgTable("roles", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  employer: text("employer").notNull(),
  location: text("location").notNull(),
  regulator: varchar("regulator", { enum: ["GMC", "NMC", "HCPC"] }).notNull(),
  sponsorshipOffered: boolean("sponsorship_offered").notNull().default(false),
  requiredRegistration: text("required_registration").notNull(),
  active: boolean("active").notNull().default(true),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  importedBy: varchar("imported_by"),
  applyUrl: text("apply_url"),
  contactEmail: text("contact_email"),
  contactPhone: text("contact_phone"),
  contactWebsite: text("contact_website"),
  // Apply-link liveness tracking (mirrors sponsor_licence_vacancies):
  // "unverified" = never checked, "live" = last check passed,
  // "dead" = 404/410/5xx or expiration phrase (see livenessReason).
  liveness: varchar("liveness", { enum: ["unverified", "live", "dead"] }).notNull().default("unverified"),
  lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
  livenessReason: text("liveness_reason"),
});

export const insertRoleSchema = createInsertSchema(rolesTable).omit({ id: true, importedAt: true });
export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Role = typeof rolesTable.$inferSelect;
