import { pgTable, serial, text, integer, boolean, timestamp, varchar, date } from "drizzle-orm/pg-core";
// Note: preferredRegion is a text array to support multiple UK region selections
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const profilesTable = pgTable("profiles", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().unique(),
  profession: text("profession").notNull(),
  specialty: text("specialty").notNull(),
  qualificationCountry: text("qualification_country").notNull(),
  qualificationType: text("qualification_type").notNull(),
  qualificationYear: integer("qualification_year").notNull(),
  experienceYears: integer("experience_years").notNull(),
  registrationStatus: varchar("registration_status", { enum: ["registered", "not_registered", "in_process"] }).notNull(),
  licenceReady: boolean("licence_ready"),
  dbsClearanceLevel: varchar("dbs_clearance_level", {
    enum: ["unknown", "none", "basic", "standard", "enhanced"],
  }).notNull().default("unknown"),
  safeguardingTrainingLevel: varchar("safeguarding_training_level", {
    enum: ["unknown", "none", "level_1", "level_2"],
  }).notNull().default("unknown"),
  residencyStatus: text("residency_status").notNull(),
  requiresSponsorship: boolean("requires_sponsorship").notNull(),
  preferredRegion: text("preferred_region").array(),
  alertFrequency: varchar("alert_frequency", { enum: ["daily", "weekly", "off"] }).notNull().default("daily"),
  lastAlertSentAt: timestamp("last_alert_sent_at", { withTimezone: true }),
  boostProfile: boolean("boost_profile").notNull().default(false),
  preferredStartDate: date("preferred_start_date"),
  profilePhotoKey: text("profile_photo_key"),
  languages: text("languages").array(),
  additionalNotes: text("additional_notes"),
  jobsageEmail: text("jobsage_email").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertProfileSchema = createInsertSchema(profilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertProfile = z.infer<typeof insertProfileSchema>;
export type Profile = typeof profilesTable.$inferSelect;
