import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sponsorLicenceVacanciesTable } from "./sponsorLicences";

export const vacancySourceStatesTable = pgTable("vacancy_source_states", {
  sourceId: text("source_id").primaryKey(),
  provider: text("provider").notNull(),
  sourceType: text("source_type").notNull(),
  boardName: text("board_name").notNull(),
  parserVersion: text("parser_version").notNull(),
  cursor: text("cursor"),
  sweepStartedAt: timestamp("sweep_started_at", { withTimezone: true }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastExhaustedAt: timestamp("last_exhausted_at", { withTimezone: true }),
  lastOutcome: text("last_outcome"),
  lastError: text("last_error"),
  reportedTotal: integer("reported_total"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  nextRetryAt: timestamp("next_retry_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vacancySourceObservationsTable = pgTable(
  "vacancy_source_observations",
  {
    id: serial("id").primaryKey(),
    vacancyId: integer("vacancy_id")
      .notNull()
      .references(() => sponsorLicenceVacanciesTable.id, { onDelete: "cascade" }),
    sourceId: text("source_id").notNull(),
    provider: text("provider").notNull(),
    sourceType: text("source_type").notNull(),
    boardName: text("board_name").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    applicationUrl: text("application_url"),
    sourceMetadata: jsonb("source_metadata").$type<Record<string, unknown> | null>(),
    parserVersion: text("parser_version").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    missingSince: timestamp("missing_since", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("vacancy_source_observations_source_external_uidx").on(
      table.sourceId,
      table.externalId,
    ),
    index("vacancy_source_observations_url_idx").on(table.canonicalUrl),
    index("vacancy_source_observations_vacancy_idx").on(table.vacancyId),
    index("vacancy_source_observations_source_seen_idx").on(
      table.sourceId,
      table.lastSeenAt,
    ),
  ],
);

/**
 * Public job-board listings that could not be linked to an eligible sponsor.
 * These rows support sweep-wide deduplication and review, but are never
 * candidate-visible vacancies.
 */
export const vacancySourceListingAuditsTable = pgTable(
  "vacancy_source_listing_audits",
  {
    id: serial("id").primaryKey(),
    sourceId: text("source_id").notNull(),
    provider: text("provider").notNull(),
    boardName: text("board_name").notNull(),
    externalId: text("external_id").notNull(),
    employerName: text("employer_name").notNull(),
    title: text("title").notNull(),
    listingUrl: text("listing_url").notNull(),
    matchReason: text("match_reason").notNull(),
    parserVersion: text("parser_version").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("vacancy_source_listing_audits_source_external_uidx").on(
      table.sourceId,
      table.externalId,
    ),
    index("vacancy_source_listing_audits_source_seen_idx").on(
      table.sourceId,
      table.lastSeenAt,
    ),
    index("vacancy_source_listing_audits_employer_idx").on(table.employerName),
  ],
);
