import { pgTable, serial, text, integer, timestamp, varchar, boolean, jsonb } from "drizzle-orm/pg-core";

export const employerProfilesTable = pgTable("employer_profiles", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().unique(),
  companyName: text("company_name").notNull(),
  industry: varchar("industry", {
    enum: ["nhs_trust", "university", "private_healthcare", "charity", "other"],
  }).notNull(),
  sponsorLicenceNumber: text("sponsor_licence_number"),
  region: text("region").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type EmployerProfile = typeof employerProfilesTable.$inferSelect;
export type InsertEmployerProfile = typeof employerProfilesTable.$inferInsert;

export const jobListingsTable = pgTable("job_listings", {
  id: serial("id").primaryKey(),
  employerProfileId: integer("employer_profile_id").notNull(),
  title: text("title").notNull(),
  specialty: text("specialty"),
  location: text("location").notNull(),
  salaryBand: text("salary_band"),
  sponsorshipOffered: boolean("sponsorship_offered").notNull().default(false),
  requirements: text("requirements"),
  description: text("description"),
  status: varchar("status", { enum: ["draft", "published", "closed"] }).notNull().default("draft"),
  regulator: varchar("regulator", { enum: ["GMC", "NMC", "HCPC"] }).notNull(),
  requiredRegistration: text("required_registration").notNull(),
  targetProfessions: jsonb("target_professions").$type<string[]>().default([]),
  targetRegions: jsonb("target_regions").$type<string[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type JobListing = typeof jobListingsTable.$inferSelect;
export type InsertJobListing = typeof jobListingsTable.$inferInsert;
