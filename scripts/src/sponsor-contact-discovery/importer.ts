import { eq } from "drizzle-orm";
import {
  db,
  sponsorLicenceContactEnrichmentsTable,
  sponsorLicencesTable,
} from "@workspace/db";
import { readCsvFile } from "./csv";
import { normaliseImportEmail, normaliseImportName, normaliseImportWebsite } from "./importValidation";

type ImportRow = {
  organisation_name: string;
  town_city: string;
  website: string;
  contact_email: string;
  contact_source: string;
  contact_evidence_url: string;
  status: string;
  review_status?: string;
};

export type ImportSummary = {
  selected: number;
  matched: number;
  updated: number;
  skippedExisting: number;
  skippedReview: number;
  unmatched: number;
};

function cleanRow(row: Record<string, string>): ImportRow {
  return {
    organisation_name: row.organisation_name?.trim() ?? "",
    town_city: row.town_city?.trim() ?? "",
    website: normaliseImportWebsite(row.website),
    contact_email: normaliseImportEmail(row.contact_email),
    contact_source: row.contact_source?.trim() ?? "",
    contact_evidence_url: row.contact_evidence_url?.trim() ?? "",
    status: row.status?.trim() ?? "",
    review_status: row.review_status?.trim().toLowerCase(),
  };
}

export async function importReviewCsv(
  path: string,
  options: { apply: boolean; requireReview: boolean },
): Promise<ImportSummary> {
  const rows = (await readCsvFile(path)).map(cleanRow).filter((row) =>
    row.organisation_name && (row.website || row.contact_email),
  );
  const summary: ImportSummary = {
    selected: rows.length,
    matched: 0,
    updated: 0,
    skippedExisting: 0,
    skippedReview: 0,
    unmatched: 0,
  };
  if (!options.apply) {
    console.log(`Dry run: ${rows.length} reviewed candidate row(s) would be imported.`);
    return summary;
  }

  for (const row of rows) {
    if (options.requireReview && row.review_status !== "approved") {
      summary.skippedReview += 1;
      continue;
    }
    if (row.status !== "verified_email" && !row.review_status) {
      summary.skippedReview += 1;
      continue;
    }
    const candidates = await db
      .select()
      .from(sponsorLicencesTable)
      .where(eq(sponsorLicencesTable.organisationName, row.organisation_name));
    const exact = candidates.filter((candidate) =>
      !row.town_city || normaliseImportName(candidate.townCity) === normaliseImportName(row.town_city),
    );
    const matches = exact.length ? exact : candidates;
    if (!matches.length) {
      summary.unmatched += 1;
      continue;
    }
    summary.matched += matches.length;
    for (const candidate of matches) {
      const website = candidate.website || row.website || null;
      const contactEmail = candidate.contactEmail || row.contact_email || null;
      if (candidate.website || candidate.contactEmail) summary.skippedExisting += 1;
      if (website === candidate.website && contactEmail === candidate.contactEmail) continue;
      await db
        .update(sponsorLicencesTable)
        .set({ website, contactEmail })
        .where(eq(sponsorLicencesTable.id, candidate.id));
      await db
        .insert(sponsorLicenceContactEnrichmentsTable)
        .values({
          organisationName: candidate.organisationName,
          stage: "contact",
          status: "complete",
          websiteUrl: website,
          websiteLookupSource: row.website ? "stored" : undefined,
          websiteEvidenceUrl: row.contact_evidence_url || null,
          contactEmail,
          contactSource: row.contact_source === "website" ? "website" : "sponsor_record",
          contactEvidenceUrl: row.contact_evidence_url || null,
          contactExtractedAt: contactEmail ? new Date() : null,
          websiteVerifiedAt: website ? new Date() : null,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: sponsorLicenceContactEnrichmentsTable.organisationName,
          set: {
            websiteUrl: website,
            contactEmail,
            contactSource: row.contact_source === "website" ? "website" : "sponsor_record",
            contactEvidenceUrl: row.contact_evidence_url || null,
            status: "complete",
            completedAt: new Date(),
            updatedAt: new Date(),
          },
        });
      summary.updated += 1;
    }
  }
  return summary;
}