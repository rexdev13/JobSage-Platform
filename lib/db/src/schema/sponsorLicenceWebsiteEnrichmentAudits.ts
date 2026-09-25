import { pgTable, serial, text, varchar, jsonb, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export type SponsorWebsiteConfidence = "high" | "medium" | "low" | "none";

export type SponsorWebsiteAuditCandidate = {
  url: string;
  hostname: string;
  title: string;
  snippet: string;
  sourceUrl: string;
  sourceType:
    | "official_site"
    | "careers"
    | "supported_ats"
    | "unsupported_ats"
    | "social"
    | "directory"
    | "aggregator"
    | "job_board"
    | "other";
  confidence: Exclude<SponsorWebsiteConfidence, "none">;
  reason: string;
};

export const sponsorLicenceWebsiteEnrichmentAuditsTable = pgTable(
  "sponsor_licence_website_enrichment_audits",
  {
    id: serial("id").primaryKey(),
    runId: text("run_id").notNull(),
    organisationKey: text("organisation_key").notNull(),
    organisationName: text("organisation_name").notNull(),
    sampleGroup: text("sample_group").notNull(),
    sector: text("sector"),
    townCity: text("town_city"),
    existingWebsiteUrl: text("existing_website_url"),
    existingCareersUrl: text("existing_careers_url"),
    websiteUrl: text("website_url"),
    websiteConfidence: varchar("website_confidence", {
      enum: ["high", "medium", "low", "none"],
    }).$type<SponsorWebsiteConfidence>().notNull().default("none"),
    websiteEvidenceUrl: text("website_evidence_url"),
    careersUrl: text("careers_url"),
    careersConfidence: varchar("careers_confidence", {
      enum: ["high", "medium", "low", "none"],
    }).$type<SponsorWebsiteConfidence>().notNull().default("none"),
    careersEvidenceUrl: text("careers_evidence_url"),
    atsProvider: text("ats_provider"),
    atsBoardId: text("ats_board_id"),
    atsMappingStatus: varchar("ats_mapping_status", {
      enum: ["verified", "unverified", "invalid"],
    }).$type<"verified" | "unverified" | "invalid" | null>(),
    atsMappingEvidenceUrl: text("ats_mapping_evidence_url"),
    classifications: jsonb("classifications").$type<string[]>().notNull(),
    candidateResults: jsonb("candidate_results").$type<SponsorWebsiteAuditCandidate[]>().notNull(),
    searchQueries: jsonb("search_queries").$type<string[]>().notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sponsor_licence_website_audit_run_org_unique").on(t.runId, t.organisationKey),
    index("sponsor_licence_website_audit_run_idx").on(t.runId),
    index("sponsor_licence_website_audit_group_idx").on(t.sampleGroup),
    index("sponsor_licence_website_audit_checked_idx").on(t.checkedAt),
  ],
);

export const insertSponsorLicenceWebsiteEnrichmentAuditSchema = createInsertSchema(
  sponsorLicenceWebsiteEnrichmentAuditsTable,
).omit({ id: true, createdAt: true, updatedAt: true });

export type SponsorLicenceWebsiteEnrichmentAudit =
  typeof sponsorLicenceWebsiteEnrichmentAuditsTable.$inferSelect;
export type InsertSponsorLicenceWebsiteEnrichmentAudit =
  typeof sponsorLicenceWebsiteEnrichmentAuditsTable.$inferInsert;