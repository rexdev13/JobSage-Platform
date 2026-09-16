import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  persistScrapedAdvertContacts,
  type BoardAdvert,
} from "./boardVacancyPipeline";
import { enrichAdvertContactsWithStats } from "./vacancyAdvertContact";

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
  apply: boolean;
  sponsorsScanned: number;
  selected: number;
  vacanciesFetched: number;
  found: number;
  applied: number;
  skippedExisting: number;
  notFound: number;
  errors: number;
  topAppliedEmails: Array<{
    email: string;
    count: number;
    evidenceUrls: string[];
  }>;
  rows: HealthcareVacancyContactBackfillRow[];
};

export type HealthcareVacancyContactBackfillOptions = {
  limit?: number | null;
  apply?: boolean;
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
  options: HealthcareVacancyContactBackfillOptions | number = {},
): Promise<HealthcareVacancyContactBackfillSummary> {
  const normalizedOptions = typeof options === "number" ? { limit: options, apply: true } : options;
  const requestedLimit = normalizedOptions.limit === undefined
    ? HEALTHCARE_CONTACT_BACKFILL_LIMIT
    : normalizedOptions.limit;
  const limit = requestedLimit === null
    ? null
    : Math.min(
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
    WHERE v.liveness <> 'dead'
      AND v.url IS NOT NULL
      AND (
        lower(coalesce(s.industry, '')) ~ '\\m(nhs|hospital|healthcare|health|hospital|medical|social care|care home|nursing)\\M'
        OR lower(v.organisation_name) ~ '\\m(nhs|hospital|healthcare|health|medical|social care|care home|nursing)\\M'
      )
    ORDER BY v.last_discovered_at DESC, v.id DESC
    ${limit === null ? sql`` : sql`LIMIT ${limit}`}
  `);
  const sourceRows = selected.rows;
  const sponsorKeysWithContacts = new Set(
    sourceRows
      .filter((row) => row.existingContactEmail?.trim())
      .map((row) => row.organisationName.trim().toLowerCase()),
  );
  const candidates = sourceRows.filter(
    (row) => !sponsorKeysWithContacts.has(row.organisationName.trim().toLowerCase()),
  );
  const enriched = await enrichAdvertContactsWithStats(candidates.map(toBoardAdvert));
  const foundAdverts = enriched
    .map(({ advert }) => advert)
    .filter((advert) => advert.contactEmail && advert.contactEvidenceUrl);
  const persisted = normalizedOptions.apply && foundAdverts.length > 0
    ? await persistScrapedAdvertContacts(db, foundAdverts)
    : { upserted: 0, skippedExisting: 0, rejected: 0 };
  const appliedEmails = new Set(
    normalizedOptions.apply
      ? foundAdverts
          .map((advert) => advert.contactEmail?.trim().toLowerCase())
          .filter((email): email is string => Boolean(email))
      : [],
  );
  const emailEvidence = new Map<string, Set<string>>();
  for (const advert of foundAdverts) {
    const email = advert.contactEmail?.trim().toLowerCase();
    const evidenceUrl = advert.contactEvidenceUrl?.trim();
    if (!email || !evidenceUrl || (normalizedOptions.apply && !appliedEmails.has(email))) continue;
    const evidence = emailEvidence.get(email) ?? new Set<string>();
    evidence.add(evidenceUrl);
    emailEvidence.set(email, evidence);
  }
  const rows = sourceRows.map((source, index) => {
    const candidateIndex = candidates.indexOf(source);
    const advert = candidateIndex >= 0 ? enriched[candidateIndex]!.advert : null;
    const contactEmail = advert?.contactEmail ?? "";
    const contactEvidenceUrl = advert?.contactEvidenceUrl ?? "";
    const outcome: HealthcareVacancyContactBackfillRow["outcome"] =
      source.existingContactEmail?.trim()
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
    apply: normalizedOptions.apply === true,
    sponsorsScanned: new Set(sourceRows.map((row) => row.organisationName.trim().toLowerCase())).size,
    selected: sourceRows.length,
    vacanciesFetched: enriched.filter(({ fetched }) => fetched).length,
    found: foundAdverts.length,
    applied: persisted.upserted,
    skippedExisting: sponsorKeysWithContacts.size + persisted.skippedExisting,
    notFound: rows.filter((row) => row.outcome === "not_found").length,
    errors: persisted.rejected,
    topAppliedEmails: [...emailEvidence.entries()]
      .filter(([email]) => appliedEmails.has(email))
      .map(([email, evidence]) => ({
        email,
        count: foundAdverts.filter((advert) => advert.contactEmail?.trim().toLowerCase() === email).length,
        evidenceUrls: [...evidence],
      }))
      .sort((a, b) => b.count - a.count || a.email.localeCompare(b.email))
      .slice(0, 30),
    rows,
  };
}