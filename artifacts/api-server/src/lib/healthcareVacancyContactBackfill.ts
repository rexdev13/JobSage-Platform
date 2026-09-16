import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  persistScrapedAdvertContacts,
  type BoardAdvert,
} from "./boardVacancyPipeline";
import { enrichAdvertContacts } from "./vacancyAdvertContact";

export const HEALTHCARE_CONTACT_BACKFILL_LIMIT = 100;

type VacancyBackfillRow = {
  id: number;
  organisationName: string;
  title: string;
  url: string;
  sourceType: "job_board" | "company_site" | null;
  boardName: string | null;
  externalListingId: string | null;
  description: string | null;
  existingContactEmail: string | null;
};

export type HealthcareVacancyContactBackfillRow = {
  id: number;
  organisationName: string;
  title: string;
  url: string;
  sourceType: string;
  boardName: string;
  existingContactEmail: string;
  contactEmail: string;
  contactEvidenceUrl: string;
  outcome: "found" | "skipped_existing" | "not_found";
};

export type HealthcareVacancyContactBackfillSummary = {
  selected: number;
  found: number;
  applied: number;
  skippedExisting: number;
  notFound: number;
  errors: number;
  topEmails: Array<{ email: string; count: number }>;
  rows: HealthcareVacancyContactBackfillRow[];
};

function toBoardAdvert(row: VacancyBackfillRow): BoardAdvert {
  return {
    organisationName: row.organisationName,
    employer: row.organisationName,
    title: row.title,
    location: null,
    salary: null,
    url: row.url,
    description: row.description,
    postedDate: null,
    targetRegions: null,
    boardName: row.boardName,
    externalId: row.externalListingId,
    sourceType: row.sourceType ?? "job_board",
  };
}

export async function runHealthcareVacancyContactBackfill(
  requestedLimit = HEALTHCARE_CONTACT_BACKFILL_LIMIT,
): Promise<HealthcareVacancyContactBackfillSummary> {
  const limit = Math.min(
    HEALTHCARE_CONTACT_BACKFILL_LIMIT,
    Math.max(1, Math.floor(requestedLimit)),
  );
  const selected = await db.execute<VacancyBackfillRow>(sql`
    SELECT v.id,
           v.organisation_name AS "organisationName",
           v.title,
           v.url,
           v.source_type AS "sourceType",
           v.board_name AS "boardName",
           v.external_listing_id AS "externalListingId",
           v.description,
           s.contact_email AS "existingContactEmail"
    FROM sponsor_licence_vacancies v
    LEFT JOIN sponsor_licences s
      ON s.organisation_name = v.organisation_name
    WHERE v.liveness = 'live'
      AND v.url IS NOT NULL
      AND (
        lower(coalesce(s.industry, '')) ~ '\\m(nhs|hospital|health|medical|social care|care home|nursing)\\M'
        OR lower(v.organisation_name) ~ '\\m(nhs|hospital|health|medical|social care|care home|nursing)\\M'
      )
    ORDER BY v.last_discovered_at DESC, v.id DESC
    LIMIT ${limit}
  `);
  const sourceRows = selected.rows;
  const adverts = await enrichAdvertContacts(sourceRows.map(toBoardAdvert));
  const foundAdverts = adverts.filter((advert) => advert.contactEmail && advert.contactEvidenceUrl);
  const persisted = foundAdverts.length > 0
    ? await persistScrapedAdvertContacts(db, foundAdverts)
    : { upserted: 0, skippedExisting: 0, rejected: 0 };

  const emailCounts = new Map<string, number>();
  const rows = sourceRows.map((source, index) => {
    const advert = adverts[index]!;
    const contactEmail = advert.contactEmail ?? "";
    const contactEvidenceUrl = advert.contactEvidenceUrl ?? "";
    if (contactEmail) {
      emailCounts.set(contactEmail, (emailCounts.get(contactEmail) ?? 0) + 1);
    }
    const outcome: HealthcareVacancyContactBackfillRow["outcome"] =
      contactEmail && source.existingContactEmail?.trim()
        ? "skipped_existing"
        : contactEmail
          ? "found"
          : "not_found";
    return {
      id: source.id,
      organisationName: source.organisationName,
      title: source.title,
      url: source.url,
      sourceType: source.sourceType ?? "",
      boardName: source.boardName ?? "",
      existingContactEmail: source.existingContactEmail ?? "",
      contactEmail,
      contactEvidenceUrl,
      outcome,
    };
  });

  return {
    selected: sourceRows.length,
    found: foundAdverts.length,
    applied: persisted.upserted,
    skippedExisting: persisted.skippedExisting,
    notFound: rows.filter((row) => row.outcome === "not_found").length,
    errors: persisted.rejected,
    topEmails: [...emailCounts.entries()]
      .map(([email, count]) => ({ email, count }))
      .sort((a, b) => b.count - a.count || a.email.localeCompare(b.email))
      .slice(0, 10),
    rows,
  };
}