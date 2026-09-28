import { createInsertSchema } from "drizzle-zod";
import {
  index,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export type SponsorLicenceUrlMigrationReviewStatus =
  | "pending"
  | "resolved"
  | "rejected";

/**
 * Durable review queue for sponsor URL candidates that cannot be safely
 * applied to a live sponsor or careers-site row. Vacancy discovery does not
 * read this table.
 */
export const sponsorLicenceUrlMigrationStagingTable = pgTable(
  "sponsor_licence_url_migration_staging",
  {
    id: serial("id").primaryKey(),
    sourceSystem: text("source_system").notNull(),
    sourceRef: text("source_ref").notNull(),
    candidateHash: varchar("candidate_hash", { length: 64 }).notNull(),
    field: varchar("field", { enum: ["website", "careers"] }).notNull(),
    organisationName: text("organisation_name").notNull(),
    candidateUrl: text("candidate_url").notNull(),
    evidenceUrl: text("evidence_url").notNull(),
    identitySnapshot: jsonb("identity_snapshot")
      .$type<Record<string, string>>()
      .notNull(),
    candidateSnapshot: jsonb("candidate_snapshot")
      .$type<Record<string, string>>()
      .notNull(),
    productionCandidates: jsonb("production_candidates")
      .$type<Array<Record<string, string | number | null>>>()
      .notNull(),
    resolverStatus: text("resolver_status").notNull(),
    resolverReason: text("resolver_reason").notNull(),
    reviewStatus: varchar("review_status", {
      enum: ["pending", "resolved", "rejected"],
    })
      .$type<SponsorLicenceUrlMigrationReviewStatus>()
      .notNull()
      .default("pending"),
    stagedBy: text("staged_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("sponsor_url_migration_source_candidate_unique").on(
      t.sourceSystem,
      t.sourceRef,
      t.candidateHash,
    ),
    index("sponsor_url_migration_review_created_idx").on(
      t.reviewStatus,
      t.createdAt,
    ),
    index("sponsor_url_migration_status_idx").on(
      t.sourceSystem,
      t.resolverStatus,
    ),
  ],
);

export const insertSponsorLicenceUrlMigrationStagingSchema = createInsertSchema(
  sponsorLicenceUrlMigrationStagingTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export type SponsorLicenceUrlMigrationStaging =
  typeof sponsorLicenceUrlMigrationStagingTable.$inferSelect;
export type InsertSponsorLicenceUrlMigrationStaging =
  typeof sponsorLicenceUrlMigrationStagingTable.$inferInsert;