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
});

export const insertRoleSchema = createInsertSchema(rolesTable).omit({ id: true, importedAt: true });
export type InsertRole = z.infer<typeof insertRoleSchema>;
export type Role = typeof rolesTable.$inferSelect;
