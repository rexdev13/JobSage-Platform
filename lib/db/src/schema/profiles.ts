import { pgTable, serial, text, integer, boolean, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const profilesTable = pgTable("profiles", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().unique(),
  profession: varchar("profession", { enum: ["doctor", "nurse", "midwife", "allied_health_professional", "clinical_academic"] }).notNull(),
  specialty: text("specialty").notNull(),
  qualificationCountry: text("qualification_country").notNull(),
  qualificationType: text("qualification_type").notNull(),
  qualificationYear: integer("qualification_year").notNull(),
  experienceYears: integer("experience_years").notNull(),
  registrationStatus: varchar("registration_status", { enum: ["registered", "not_registered", "in_process"] }).notNull(),
  licenceReady: boolean("licence_ready"),
  residencyStatus: text("residency_status").notNull(),
  requiresSponsorship: boolean("requires_sponsorship").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProfileSchema = createInsertSchema(profilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Profile = typeof profilesTable.$inferSelect;
