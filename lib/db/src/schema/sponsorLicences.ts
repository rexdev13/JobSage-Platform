import { pgTable, serial, text, timestamp, integer, boolean, varchar, index, uniqueIndex, jsonb, date, foreignKey } from "drizzle-orm/pg-core";

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
    website: text("website"),
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    address: text("address"),
    region: text("region"),
    contactBackfillAttemptedAt: timestamp("contact_backfill_attempted_at", { withTimezone: true }),
  },
  (t) => [
    index("sponsor_licences_name_idx").on(t.organisationName),
    index("sponsor_licences_route_idx").on(t.route),
    index("sponsor_licences_industry_idx").on(t.industry),
    index("sponsor_licences_region_idx").on(t.region),
  ],
);

export type SponsorLicence = typeof sponsorLicencesTable.$inferSelect;
export type InsertSponsorLicence = typeof sponsorLicencesTable.$inferInsert;

export const sponsorLicenceSyncLogTable = pgTable("sponsor_licence_sync_log", {
  id: serial("id").primaryKey(),
  status: varchar("status", { enum: ["success", "error"] }).notNull(),
  recordCount: integer("record_count"),
  addedCount: integer("added_count"),
  updatedCount: integer("updated_count"),
  removedCount: integer("removed_count"),
  durationMs: integer("duration_ms"),
  triggeredBy: varchar("triggered_by", { enum: ["scheduler", "manual"] }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SponsorLicenceSyncLog = typeof sponsorLicenceSyncLogTable.$inferSelect;

export const vacancySyncLogTable = pgTable("vacancy_sync_log", {
  id: serial("id").primaryKey(),
  status: varchar("status", { enum: ["success", "error"] }).notNull(),
  batchSize: integer("batch_size"),
  checkedCount: integer("checked_count"),
  cacheHitCount: integer("cache_hit_count"),
  errorCount: integer("error_count"),
  errorMessage: text("error_message"),
  triggeredBy: varchar("triggered_by", { enum: ["scheduler", "manual"] }),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VacancySyncLog = typeof vacancySyncLogTable.$inferSelect;

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
    vacancyList: jsonb("vacancy_list").$type<Array<{
      title: string;
      location: string | null;
      salary: string | null;
      url: string | null;
      description: string | null;
      postedDate: string | null;
      targetRegions: string[] | null;
    }>>(),
  },
  (t) => [
    index("vacancy_checks_org_name_idx").on(t.organisationName),
    index("vacancy_checks_checked_at_idx").on(t.checkedAt),
  ],
);

export type SponsorLicenceVacancyCheck = typeof sponsorLicenceVacancyChecksTable.$inferSelect;
export type InsertSponsorLicenceVacancyCheck = typeof sponsorLicenceVacancyChecksTable.$inferInsert;

export const sponsorLicenceVacanciesTable = pgTable(
  "sponsor_licence_vacancies",
  {
    id: serial("id").primaryKey(),
    organisationName: text("organisation_name").notNull(),
    checkDate: date("check_date").notNull(),
    title: text("title").notNull(),
    location: text("location"),
    salary: text("salary"),
    url: text("url"),
    sourceType: text("source_type").$type<"job_board" | "company_site">(),
    boardName: text("board_name"),
    externalListingId: text("external_listing_id"),
    description: text("description"),
    requiredDbsClearanceLevel: varchar("required_dbs_clearance_level", {
      enum: ["unknown", "none", "basic", "standard", "enhanced"],
    }),
    requiredSafeguardingLevel: varchar("required_safeguarding_level", {
      enum: ["unknown", "none", "level_1", "level_2"],
    }),
    targetRegions: jsonb("target_regions").$type<string[]>().default([]),
    postedDate: text("posted_date"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastDiscoveredAt: timestamp("last_discovered_at", { withTimezone: true }).notNull().defaultNow(),
    // Liveness tracking: background sweep + click-time checker keep these current.
    // "unverified" = never checked (or URL missing), "live" = last check passed,
    // "dead" = last check hit 404/410/5xx or an expiration phrase (see livenessReason).
    liveness: varchar("liveness", { enum: ["unverified", "live", "dead"] }).notNull().default("unverified"),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    livenessReason: text("liveness_reason"),
  },
  (t) => [
    index("sponsor_licence_vacancies_org_date_idx").on(t.organisationName, t.checkDate),
    index("sponsor_licence_vacancies_org_idx").on(t.organisationName),
    index("sponsor_licence_vacancies_liveness_idx").on(t.liveness, t.lastVerifiedAt),
    index("sponsor_licence_vacancies_discovered_idx").on(t.lastDiscoveredAt),
  ],
);

export type SponsorLicenceVacancy = typeof sponsorLicenceVacanciesTable.$inferSelect;
export type InsertSponsorLicenceVacancy = typeof sponsorLicenceVacanciesTable.$inferInsert;

export const sponsorLicenceBookmarksTable = pgTable(
  "sponsor_licence_bookmarks",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    sponsorLicenceId: integer("sponsor_licence_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "sl_bookmarks_sl_id_fk",
      columns: [t.sponsorLicenceId],
      foreignColumns: [sponsorLicencesTable.id],
    }).onDelete("cascade"),
    uniqueIndex("sponsor_licence_bookmarks_user_sponsor_idx").on(t.userId, t.sponsorLicenceId),
    index("sponsor_licence_bookmarks_user_idx").on(t.userId),
  ],
);

export type SponsorLicenceBookmark = typeof sponsorLicenceBookmarksTable.$inferSelect;
export type InsertSponsorLicenceBookmark = typeof sponsorLicenceBookmarksTable.$inferInsert;

export const sponsorLicenceVacancyScoresTable = pgTable(
  "sponsor_licence_vacancy_scores",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id").notNull(),
    vacancyId: integer("vacancy_id").notNull(),
    organisationName: text("organisation_name").notNull(),
    score: integer("score").notNull(),
    isEligible: boolean("is_eligible").notNull(),
    missingRequirements: jsonb("missing_requirements").$type<string[]>(),
    explanation: text("explanation"),
    scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "sl_vacancy_scores_vacancy_id_fk",
      columns: [t.vacancyId],
      foreignColumns: [sponsorLicenceVacanciesTable.id],
    }).onDelete("cascade"),
    uniqueIndex("sl_vacancy_scores_user_vacancy_idx").on(t.userId, t.vacancyId),
    index("sl_vacancy_scores_user_org_idx").on(t.userId, t.organisationName),
  ],
);

export type SponsorLicenceVacancyScore = typeof sponsorLicenceVacancyScoresTable.$inferSelect;
export type InsertSponsorLicenceVacancyScore = typeof sponsorLicenceVacancyScoresTable.$inferInsert;

// ── Gap Analysis Results ───────────────────────────────────────────────────────
// Stores the detailed per-candidate per-vacancy AI gap analysis. Keyed by
// (userId, vacancyId) — each candidate can only generate one analysis per
// vacancy. A 7-day TTL is enforced in application code (not the DB).
// Total analyses per user is capped at 10, also enforced in application code.

export const sponsorLicenceGapAnalysesTable = pgTable(
  "sponsor_licence_gap_analyses",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id").notNull(),
    vacancyId: integer("vacancy_id").notNull(),
    matchedRequirements: jsonb("matched_requirements").$type<string[]>().notNull(),
    gaps: jsonb("gaps").$type<string[]>().notNull(),
    optimizationSteps: jsonb("optimization_steps").$type<string[]>().notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "sl_gap_analyses_vacancy_id_fk",
      columns: [t.vacancyId],
      foreignColumns: [sponsorLicenceVacanciesTable.id],
    }).onDelete("cascade"),
    uniqueIndex("sl_gap_analyses_user_vacancy_idx").on(t.userId, t.vacancyId),
    index("sl_gap_analyses_user_idx").on(t.userId),
  ],
);

export type SponsorLicenceGapAnalysis = typeof sponsorLicenceGapAnalysesTable.$inferSelect;
export type InsertSponsorLicenceGapAnalysis = typeof sponsorLicenceGapAnalysesTable.$inferInsert;
