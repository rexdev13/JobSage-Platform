import { pgTable, serial, text, integer, timestamp, varchar, boolean, jsonb, index, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";
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
  requiredDbsClearanceLevel: varchar("required_dbs_clearance_level", {
    enum: ["unknown", "none", "basic", "standard", "enhanced"],
  }),
  requiredSafeguardingLevel: varchar("required_safeguarding_level", {
    enum: ["unknown", "none", "level_1", "level_2"],
  }),
  targetRegions: jsonb("target_regions").$type<string[]>().default([]),
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

export const roleGapAnalysesTable = pgTable(
  "role_gap_analyses",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id").notNull(),
    roleId: integer("role_id").notNull(),
    matchedRequirements: jsonb("matched_requirements").$type<string[]>().notNull(),
    gaps: jsonb("gaps").$type<string[]>().notNull(),
    optimizationSteps: jsonb("optimization_steps").$type<string[]>().notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "role_gap_analyses_role_id_fk",
      columns: [t.roleId],
      foreignColumns: [rolesTable.id],
    }).onDelete("cascade"),
    uniqueIndex("role_gap_analyses_user_role_idx").on(t.userId, t.roleId),
    index("role_gap_analyses_user_idx").on(t.userId),
  ],
);

export type RoleGapAnalysis = typeof roleGapAnalysesTable.$inferSelect;
export type InsertRoleGapAnalysis = typeof roleGapAnalysesTable.$inferInsert;
