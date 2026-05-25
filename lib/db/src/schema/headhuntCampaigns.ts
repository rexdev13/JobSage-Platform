import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const headhuntCampaignsTable = pgTable("headhunt_campaigns", {
  id: serial("id").primaryKey(),
  employerProfileId: integer("employer_profile_id").notNull(),
  vacancyId: integer("vacancy_id"),
  name: text("name").notNull(),
  filters: jsonb("filters").$type<{
    profession?: string;
    specialty?: string;
    eligibilityStatus?: string;
    requiresSponsorship?: boolean;
    experienceYearsMin?: number;
    preferredRegion?: string;
  }>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
});

export type HeadhuntCampaign = typeof headhuntCampaignsTable.$inferSelect;
export type InsertHeadhuntCampaign = typeof headhuntCampaignsTable.$inferInsert;
