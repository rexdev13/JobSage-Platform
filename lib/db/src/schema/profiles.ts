import { pgTable, serial, text, integer, boolean, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const profilesTable = pgTable("profiles", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().unique(),
  profession: varchar("profession", { enum: ["doctor", "nurse", "allied_health_professional", "clinical_academic"] }).notNull(),
  specialty: text("specialty"),
  qualificationCountry: text("qualification_country"),
  qualificationType: text("qualification_type"),
  qualificationYear: integer("qualification_year"),
  experienceYears: integer("experience_years"),
  registrationStatus: varchar("registration_status", { enum: ["registered", "not_registered", "in_process"] }),
  licenceReady: boolean("licence_ready"),
  residencyStatus: text("residency_status"),
  requiresSponsorship: boolean("requires_sponsorship"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProfileSchema = createInsertSchema(profilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Profile = typeof profilesTable.$inferSelect;
