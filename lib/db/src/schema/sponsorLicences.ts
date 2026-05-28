import { pgTable, serial, text, timestamp, integer, varchar, index } from "drizzle-orm/pg-core";

export const sponsorLicencesTable = pgTable(
  "sponsor_licences",
  {
    id: serial("id").primaryKey(),
    organisationName: text("organisation_name").notNull(),
    townCity: text("town_city"),
    county: text("county"),
    route: text("route"),
    subRoute: text("sub_route"),
    rating: text("rating"),
    industry: text("industry"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sponsor_licences_name_idx").on(t.organisationName),
    index("sponsor_licences_route_idx").on(t.route),
    index("sponsor_licences_industry_idx").on(t.industry),
  ],
);

export type SponsorLicence = typeof sponsorLicencesTable.$inferSelect;
export type InsertSponsorLicence = typeof sponsorLicencesTable.$inferInsert;

export const sponsorLicenceSyncLogTable = pgTable("sponsor_licence_sync_log", {
  id: serial("id").primaryKey(),
  status: varchar("status", { enum: ["success", "error"] }).notNull(),
  recordCount: integer("record_count"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SponsorLicenceSyncLog = typeof sponsorLicenceSyncLogTable.$inferSelect;
