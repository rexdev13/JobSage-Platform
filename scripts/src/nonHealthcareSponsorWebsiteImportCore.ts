import { parseCsv } from "./sponsor-contact-discovery/csv";

export const NON_HEALTHCARE_WEBSITE_IMPORT_COLUMNS = [
  "sponsor_licence_id",
  "organisation_name",
  "normalized_organisation_name",
  "town_city",
  "county",
  "region",
  "industry",
  "route",
  "sub_route",
  "existing_website",
  "existing_contact_email",
  "existing_careers_url",
  "official_website_url",
  "website_confidence",
  "website_evidence_url",
  "source",
  "notes",
] as const;

export type NonHealthcareWebsiteConfidence =
  | "high"
  | "medium"
  | "low"
  | "unverified";

export type NonHealthcareWebsiteRow = Record<string, string> & {
  sponsor_licence_id: string;
  organisation_name: string;
  normalized_organisation_name: string;
  town_city: string;
  industry: string;
  official_website_url: string;
  website_confidence: NonHealthcareWebsiteConfidence;
  website_evidence_url: string;
  source: string;
  notes: string;
};

export type NonHealthcareWebsiteImportAction =
  | "promote_high_blank"
  | "preserve_existing_same"
  | "preserve_existing_different"
  | "review_medium"
  | "review_low"
  | "unverified";

const CONFIDENCES = new Set<NonHealthcareWebsiteConfidence>([
  "high",
  "medium",
  "low",
  "unverified",
]);

function validateHttpUrl(value: string, label: string, rowNumber: number): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Row ${rowNumber}: ${label} is not a valid URL.`);
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(`Row ${rowNumber}: ${label} must be a credential-free HTTP(S) URL.`);
  }
}

export function parseNonHealthcareWebsiteCsv(text: string): NonHealthcareWebsiteRow[] {
  const [rawHeaders, ...rawRows] = parseCsv(text);
  if (!rawHeaders) throw new Error("The non-Healthcare website CSV is empty.");
  const headers = rawHeaders.map((header, index) =>
    (index === 0 ? header.replace(/^\uFEFF/, "") : header).trim(),
  );
  if (
    headers.length !== NON_HEALTHCARE_WEBSITE_IMPORT_COLUMNS.length ||
    headers.some((header, index) => header !== NON_HEALTHCARE_WEBSITE_IMPORT_COLUMNS[index])
  ) {
    throw new Error("The input CSV does not have the exact non-Healthcare website column order.");
  }
  if (rawRows.length === 0 || rawRows.length > 20_000) {
    throw new Error(`The input must contain 1–20,000 rows; found ${rawRows.length}.`);
  }

  const seenIds = new Set<number>();
  return rawRows.map((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== headers.length) {
      throw new Error(`Row ${rowNumber}: expected ${headers.length} columns, found ${values.length}.`);
    }
    const row = Object.fromEntries(
      headers.map((header, columnIndex) => [header, values[columnIndex]?.trim() ?? ""]),
    ) as NonHealthcareWebsiteRow;
    row.website_confidence = row.website_confidence.toLowerCase() as NonHealthcareWebsiteConfidence;

    const id = Number(row.sponsor_licence_id);
    if (!Number.isSafeInteger(id) || id < 1) {
      throw new Error(`Row ${rowNumber}: sponsor_licence_id must be a positive integer.`);
    }
    if (seenIds.has(id)) {
      throw new Error(`Row ${rowNumber}: duplicate sponsor_licence_id ${id}.`);
    }
    seenIds.add(id);

    if (!row.organisation_name || !row.normalized_organisation_name) {
      throw new Error(`Row ${rowNumber}: organisation name fields are required.`);
    }
    if (row.industry.toLowerCase() === "healthcare") {
      throw new Error(`Row ${rowNumber}: Healthcare rows are not allowed in this importer.`);
    }
    if (!CONFIDENCES.has(row.website_confidence)) {
      throw new Error(`Row ${rowNumber}: unsupported website_confidence.`);
    }

    const hasAcceptedUrl = Boolean(row.official_website_url);
    if (row.website_confidence === "high" || row.website_confidence === "medium") {
      if (!hasAcceptedUrl || !row.website_evidence_url) {
        throw new Error(
          `Row ${rowNumber}: high/medium website results require an official URL and evidence URL.`,
        );
      }
      validateHttpUrl(row.official_website_url, "official_website_url", rowNumber);
    } else if (hasAcceptedUrl) {
      throw new Error(
        `Row ${rowNumber}: low/unverified results cannot contain an official website URL.`,
      );
    }

    if (row.website_evidence_url) {
      validateHttpUrl(row.website_evidence_url, "website_evidence_url", rowNumber);
    }
    if (row.website_confidence === "low" && !row.website_evidence_url) {
      throw new Error(`Row ${rowNumber}: low-confidence results require a reviewable evidence URL.`);
    }
    return row;
  });
}

export function normalizeSponsorIdentity(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-GB");
}

export function normalizeWebsiteUrl(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\/+$/, "");
}

export function decideWebsiteImportAction(
  row: NonHealthcareWebsiteRow,
  currentWebsite: string | null | undefined,
): NonHealthcareWebsiteImportAction {
  if (row.website_confidence === "high") {
    if (!currentWebsite?.trim()) return "promote_high_blank";
    return normalizeWebsiteUrl(currentWebsite) === normalizeWebsiteUrl(row.official_website_url)
      ? "preserve_existing_same"
      : "preserve_existing_different";
  }
  if (row.website_confidence === "medium") return "review_medium";
  if (row.website_confidence === "low") return "review_low";
  return "unverified";
}