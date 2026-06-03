import { pgTable, serial, text, timestamp, integer, boolean, varchar, index, uniqueIndex } from "drizzle-orm/pg-core";

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

export const sponsorLicenceVacancyChecksTable = pgTable(
  "sponsor_licence_vacancy_checks",
  {
    id: serial("id").primaryKey(),
    organisationName: text("organisation_name").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    vacanciesFound: boolean("vacancies_found").notNull().default(false),
    vacancyCount: integer("vacancy_count"),
    sourceUrl: text("source_url"),
    summary: text("summary"),
  },
  (t) => [
    index("vacancy_checks_org_name_idx").on(t.organisationName),
    index("vacancy_checks_checked_at_idx").on(t.checkedAt),
  ],
);

export type SponsorLicenceVacancyCheck = typeof sponsorLicenceVacancyChecksTable.$inferSelect;
export type InsertSponsorLicenceVacancyCheck = typeof sponsorLicenceVacancyChecksTable.$inferInsert;

export const sponsorLicenceBookmarksTable = pgTable(
  "sponsor_licence_bookmarks",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    sponsorLicenceId: integer("sponsor_licence_id")
      .notNull()
      .references(() => sponsorLicencesTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sponsor_licence_bookmarks_user_sponsor_idx").on(t.userId, t.sponsorLicenceId),
    index("sponsor_licence_bookmarks_user_idx").on(t.userId),
  ],
);

export type SponsorLicenceBookmark = typeof sponsorLicenceBookmarksTable.$inferSelect;
export type InsertSponsorLicenceBookmark = typeof sponsorLicenceBookmarksTable.$inferInsert;
