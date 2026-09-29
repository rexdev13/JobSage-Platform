import { createHash } from "node:crypto";
import { parseCsv } from "./sponsor-contact-discovery/csv";

export const HEALTHCARE_SPONSOR_BATCH_COLUMNS = [
  "sponsor_licence_id",
  "organisation_name",
  "normalized_organisation_name",
  "town_city",
  "county",
  "region",
  "industry",
  "route",
  "sub_route",
  "rating",
  "existing_website",
  "existing_careers_url",
  "existing_ats_provider",
  "existing_ats_board_id",
  "existing_ats_mapping_status",
  "existing_ats_mapping_evidence_url",
  "website_url",
  "website_confidence",
  "website_evidence_url",
  "careers_url",
  "careers_confidence",
  "careers_evidence_url",
  "ats_provider",
  "ats_board_id",
  "ats_mapping_status",
  "ats_mapping_evidence_url",
  "source",
  "source_evidence_url",
  "notes",
] as const;

export type SponsorWebsiteConfidence = "high" | "medium" | "low" | "none";
export type HealthcareSponsorBatchRow = Record<string, string> & {
  sponsor_licence_id: string;
  organisation_name: string;
  town_city: string;
  industry: string;
  website_url: string;
  website_confidence: SponsorWebsiteConfidence;
  website_evidence_url: string;
  careers_url: string;
  careers_confidence: SponsorWebsiteConfidence;
  careers_evidence_url: string;
};

const CONFIDENCE_VALUES = new Set<SponsorWebsiteConfidence>([
  "high",
  "medium",
  "low",
  "none",
]);

function assertHttpsUrl(value: string, label: string, rowNumber: number): void {
  if (!value) {
    throw new Error(`Row ${rowNumber}: ${label} is required.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Row ${rowNumber}: ${label} is not a valid URL.`);
  }
  if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) {
    throw new Error(`Row ${rowNumber}: ${label} must be a credential-free HTTPS URL.`);
  }
}

function validateUrlClaim(
  row: Record<string, string>,
  urlColumn: "website_url" | "careers_url",
  confidenceColumn: "website_confidence" | "careers_confidence",
  evidenceColumn: "website_evidence_url" | "careers_evidence_url",
  rowNumber: number,
): void {
  const url = row[urlColumn] ?? "";
  const evidence = row[evidenceColumn] ?? "";
  const confidenceText = (row[confidenceColumn] ?? "").toLowerCase();
  if (!CONFIDENCE_VALUES.has(confidenceText as SponsorWebsiteConfidence)) {
    throw new Error(
      `Row ${rowNumber}: ${confidenceColumn} must be high, medium, low, or none.`,
    );
  }
  const confidence = confidenceText as SponsorWebsiteConfidence;
  if (confidence === "none") {
    if (url || evidence) {
      throw new Error(`Row ${rowNumber}: ${urlColumn} and its evidence must be blank at confidence none.`);
    }
    return;
  }
  if (!url) {
    throw new Error(`Row ${rowNumber}: ${urlColumn} is required at ${confidence} confidence.`);
  }
  assertHttpsUrl(url, urlColumn, rowNumber);
  assertHttpsUrl(evidence, evidenceColumn, rowNumber);
}

export function parseHealthcareSponsorBatchCsv(text: string): HealthcareSponsorBatchRow[] {
  const [rawHeaders, ...rawRows] = parseCsv(text);
  if (!rawHeaders) throw new Error("The batch CSV is empty.");
  const headers = rawHeaders.map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim(),
  );
  if (
    headers.length !== HEALTHCARE_SPONSOR_BATCH_COLUMNS.length ||
    headers.some((header, index) => header !== HEALTHCARE_SPONSOR_BATCH_COLUMNS[index])
  ) {
    throw new Error("The batch CSV does not have the exact healthcare sponsor column order.");
  }
  if (rawRows.length === 0 || rawRows.length > 500) {
    throw new Error(`The batch must contain 1–500 rows; found ${rawRows.length}.`);
  }

  const seenIds = new Set<number>();
  return rawRows.map((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== headers.length) {
      throw new Error(`Row ${rowNumber}: expected ${headers.length} columns, found ${values.length}.`);
    }
    const row = Object.fromEntries(
      headers.map((header, columnIndex) => [header, values[columnIndex]?.trim() ?? ""]),
    ) as HealthcareSponsorBatchRow;
    row.website_confidence = row.website_confidence.toLowerCase() as SponsorWebsiteConfidence;
    row.careers_confidence = row.careers_confidence.toLowerCase() as SponsorWebsiteConfidence;
    const id = Number(row.sponsor_licence_id);
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new Error(`Row ${rowNumber}: sponsor_licence_id must be a positive integer.`);
    }
    if (seenIds.has(id)) {
      throw new Error(`Row ${rowNumber}: duplicate sponsor_licence_id ${id}.`);
    }
    seenIds.add(id);
    if (!row.organisation_name || row.industry !== "Healthcare") {
      throw new Error(`Row ${rowNumber}: organisation name and exact industry=Healthcare are required.`);
    }
    validateUrlClaim(row, "website_url", "website_confidence", "website_evidence_url", rowNumber);
    validateUrlClaim(row, "careers_url", "careers_confidence", "careers_evidence_url", rowNumber);
    return row;
  });
}

export function normalizeSponsorIdentity(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}

export function batchRunId(batchNumber: number, csvText: string): string {
  if (!Number.isInteger(batchNumber) || batchNumber < 1 || batchNumber > 6) {
    throw new Error("Batch number must be between 1 and 6.");
  }
  const digest = createHash("sha256").update(csvText, "utf8").digest("hex").slice(0, 16);
  return `healthcare-sponsor-batch-${String(batchNumber).padStart(3, "0")}-${digest}`;
}

export function isMediumReviewRow(row: HealthcareSponsorBatchRow): boolean {
  return row.website_confidence === "medium" || row.careers_confidence === "medium";
}