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
    websiteOdsCode: text("website_ods_code"),
    websiteOdsRecordUrl: text("website_ods_record_url"),
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

/**
 * Maps an environment-independent sponsor identity to the local sponsor row
 * selected in this database. The key is derived from source identity fields,
 * never from a development or production serial ID.
 */
export const sponsorLicenceIdentityCrosswalkTable = pgTable(
  "sponsor_licence_identity_crosswalk",
  {
    id: serial("id").primaryKey(),
    sourceSystem: text("source_system").notNull(),
    identityKey: varchar("identity_key", { length: 64 }).notNull(),
    identitySnapshot: jsonb("identity_snapshot")
      .$type<Record<string, string>>()
      .notNull(),
    targetSponsorLicenceId: integer("target_sponsor_licence_id")
      .notNull()
      .references(() => sponsorLicencesTable.id, { onDelete: "cascade" }),
    resolutionMethod: varchar("resolution_method", {
      enum: ["exact_unique", "manual_review"],
    }).notNull(),
    resolvedBy: text("resolved_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sponsor_licence_identity_crosswalk_source_key_unique").on(
      t.sourceSystem,
      t.identityKey,
    ),
    index("sponsor_licence_identity_crosswalk_target_idx").on(t.targetSponsorLicenceId),
  ],
);

export type SponsorLicenceIdentityCrosswalk =
  typeof sponsorLicenceIdentityCrosswalkTable.$inferSelect;

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
  jobKind: text("job_kind"),
  metrics: jsonb("metrics").$type<Record<string, unknown> | null>(),
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

export const sponsorLicenceCompanySiteChecksTable = pgTable(
  "sponsor_licence_company_site_checks",
  {
    id: serial("id").primaryKey(),
    organisationName: text("organisation_name").notNull(),
    genericCheckedAt: timestamp("generic_checked_at", { withTimezone: true }),
    atsCheckedAt: timestamp("ats_checked_at", { withTimezone: true }),
    careersUrl: text("careers_url"),
    atsProvider: text("ats_provider"),
    atsBoardId: text("ats_board_id"),
    atsMappingEvidenceUrl: text("ats_mapping_evidence_url"),
    atsMappingStatus: text("ats_mapping_status")
      .$type<"verified" | "unverified" | "invalid">()
      .notNull()
      .default("unverified"),
    retryAfter: timestamp("retry_after", { withTimezone: true }),
    lastError: text("last_error"),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
    lastCompletedAt: timestamp("last_completed_at", { withTimezone: true }),
    lastPartialAt: timestamp("last_partial_at", { withTimezone: true }),
    lastOutcome: text("last_outcome"),
    probeStatus: text("probe_status")
      .$type<"ok_for_crawl" | "bad" | "unknown">()
      .notNull()
      .default("unknown"),
    lastProbedAt: timestamp("last_probed_at", { withTimezone: true }),
    probeReason: text("probe_reason"),
    lastPagesFetched: integer("last_pages_fetched"),
    lastAdvertsFound: integer("last_adverts_found"),
    lastRejectedCount: integer("last_rejected_count"),
    crawlLeaseUntil: timestamp("crawl_lease_until", { withTimezone: true }),
    crawlLeaseToken: text("crawl_lease_token"),
    crawlState: jsonb("crawl_state").$type<{
      queue: string[];
      visited: string[];
      sitemapQueued?: boolean;
      careersUrl?: string | null;
      atsProvider?: string | null;
    } | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("company_site_checks_org_unique").on(t.organisationName),
    index("company_site_checks_generic_idx").on(t.genericCheckedAt),
    index("company_site_checks_ats_idx").on(t.atsCheckedAt),
    index("company_site_checks_retry_idx").on(t.retryAfter),
    index("company_site_checks_probe_due_idx").on(t.probeStatus, t.lastProbedAt),
    index("company_site_checks_crawl_lease_idx").on(t.crawlLeaseUntil),
  ],
);

export type SponsorLicenceCompanySiteCheck = typeof sponsorLicenceCompanySiteChecksTable.$inferSelect;
export type InsertSponsorLicenceCompanySiteCheck = typeof sponsorLicenceCompanySiteChecksTable.$inferInsert;

/**
 * Per-employer, resumable state for the deliberately separate website/contact
 * enrichment worker.  This is not tied to a licence row because an employer can
 * occur more than once in the sponsor register.
 */
export const sponsorLicenceContactEnrichmentsTable = pgTable(
  "sponsor_licence_contact_enrichments",
  {
    id: serial("id").primaryKey(),
    organisationName: text("organisation_name").notNull(),
    stage: varchar("stage", { enum: ["website", "contact"] }).notNull().default("website"),
    status: varchar("status", { enum: ["pending", "retry", "complete", "failed"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    retryAfter: timestamp("retry_after", { withTimezone: true }),
    websiteUrl: text("website_url"),
    websiteLookupSource: varchar("website_lookup_source", { enum: ["stored", "vacancy", "web_search"] }),
    websiteLookupAt: timestamp("website_lookup_at", { withTimezone: true }),
    websiteCitedAt: timestamp("website_cited_at", { withTimezone: true }),
    websiteVerifiedAt: timestamp("website_verified_at", { withTimezone: true }),
    websiteEvidenceUrl: text("website_evidence_url"),
    contactEmail: text("contact_email"),
    contactSource: varchar("contact_source", {
      enum: ["vacancy_field", "vacancy_text", "sponsor_record", "website"],
    }),
    contactEvidenceUrl: text("contact_evidence_url"),
    contactExtractedAt: timestamp("contact_extracted_at", { withTimezone: true }),
    storedHarvestedAt: timestamp("stored_harvested_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("contact_enrichments_org_unique").on(t.organisationName),
    index("contact_enrichments_due_idx").on(t.status, t.retryAfter),
  ],
);

export type SponsorLicenceContactEnrichment = typeof sponsorLicenceContactEnrichmentsTable.$inferSelect;
export type InsertSponsorLicenceContactEnrichment = typeof sponsorLicenceContactEnrichmentsTable.$inferInsert;

export const contactWebSearchUsageTable = pgTable(
  "contact_web_search_usage",
  {
    id: serial("id").primaryKey(),
    utcDate: date("utc_date").notNull(),
    organisationName: text("organisation_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contact_web_search_usage_org_day_unique").on(t.utcDate, t.organisationName),
    index("contact_web_search_usage_day_idx").on(t.utcDate),
  ],
);

export const companySiteHostStatesTable = pgTable(
  "company_site_host_states",
  {
    id: serial("id").primaryKey(),
    hostname: text("hostname").notNull(),
    robotsBody: text("robots_body"),
    robotsCheckedAt: timestamp("robots_checked_at", { withTimezone: true }),
    lastRequestAt: timestamp("last_request_at", { withTimezone: true }),
    requestLeaseUntil: timestamp("request_lease_until", { withTimezone: true }),
    requestLeaseToken: text("request_lease_token"),
    failureCount: integer("failure_count").notNull().default(0),
    retryAfter: timestamp("retry_after", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("company_site_host_states_hostname_unique").on(t.hostname),
    index("company_site_host_states_retry_idx").on(t.retryAfter),
  ],
);

export type CompanySiteHostState = typeof companySiteHostStatesTable.$inferSelect;
export type InsertCompanySiteHostState = typeof companySiteHostStatesTable.$inferInsert;

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
    applicationUrl: text("application_url"),
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
    closesAt: timestamp("closes_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    closedReason: text("closed_reason"),
    companyVacancyEvidence: jsonb("company_vacancy_evidence").$type<{
      kind: string;
      listingUrl?: string;
      provider?: string;
    } | null>(),
    companyEvidenceLegacyUntil: timestamp("company_evidence_legacy_until", { withTimezone: true }),
    sourceMissingSince: timestamp("source_missing_since", { withTimezone: true }),
    sourceMissingObservations: integer("source_missing_observations").notNull().default(0),
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
