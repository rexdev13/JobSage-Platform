import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { parse as parseCsv } from "csv-parse/sync";
import { db, sponsorLicencesTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { z } from "zod";
import {
  boardVacancyFingerprint,
  normaliseAndDedupeBoardAdverts,
  upsertSharedBoardVacancies,
  type BoardAdvert,
  type UpsertBoardVacancyOutcome,
} from "./boardVacancyPipeline";
import { normalizeSponsorLegalNameValue } from "./sponsorWebsiteCrossEnvIdentity";
import { canonicalVacancyUrl } from "./vacancySource";
import { isBlockedVacancyUrl, isValidVacancyUrlForSource } from "./vacancyUrlPolicy";

export const REVIEWED_COMPANY_SITE_IMPORT_CONFIRMATION =
  "apply-reviewed-company-site-vacancy-import";
export const REVIEWED_COMPANY_SITE_IMPORT_MAX_BYTES = 1_000_000;
export const REVIEWED_COMPANY_SITE_IMPORT_MAX_ROWS = 500;
export const REVIEWED_COMPANY_SITE_IMPORT_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const REVIEW_TOKEN_TTL_MS = 30 * 60 * 1000;

const REQUIRED_HEADERS = [
  "source_row",
  "source_employer",
  "source_title",
  "source_location",
  "source_careers_page",
  "listing_url",
  "source_type",
  "listing_fetch_status",
  "listing_http_status",
  "listing_final_url",
  "page_employer_match",
  "page_title",
  "page_title_match",
  "closing_date",
  "explicit_closed_phrase",
  "current_status",
  "application_url",
  "application_final_url",
  "application_http_status",
  "application_status",
  "application_job_specific",
  "decision",
  "checked_at_utc",
] as const;

const CsvCompanySiteRowSchema = z.object({
  source_row: z.string().trim().min(1).max(80),
  source_employer: z.string().trim().min(1).max(300),
  source_title: z.string().trim().min(1).max(500),
  source_location: z.string().trim().max(500),
  source_careers_page: z.string().trim().max(2048),
  listing_url: z.string().trim().max(2048),
  source_type: z.string().trim().max(80),
  listing_fetch_status: z.string().trim().max(80),
  listing_http_status: z.string().trim().max(20),
  listing_final_url: z.string().trim().max(2048),
  page_employer_match: z.string().trim().max(80),
  page_title: z.string().trim().max(500),
  page_title_match: z.string().trim().max(80),
  closing_date: z.string().trim().max(80),
  explicit_closed_phrase: z.string().trim().max(20),
  current_status: z.string().trim().max(80),
  application_url: z.string().trim().max(2048),
  application_final_url: z.string().trim().max(2048),
  application_http_status: z.string().trim().max(20),
  application_status: z.string().trim().max(100),
  application_job_specific: z.string().trim().max(20),
  decision: z.string().trim().max(40),
  checked_at_utc: z.string().trim().max(80),
});

export type ReviewedCompanySiteImportRow = {
  sourceRow: string;
  employer: string;
  title: string;
  listingUrl: string | null;
  applicationUrl: string | null;
  status:
    | "held"
    | "would_insert"
    | "already_present"
    | "inserted"
    | "not_imported_batch_error";
  reason?: string;
  matchedBy?: UpsertBoardVacancyOutcome["matchedBy"];
  verificationStatus?: "queued_unverified";
};

export type ReviewedCompanySiteImportReport = {
  mode: "dry-run" | "apply";
  environment: string;
  inputSha256: string;
  rows: ReviewedCompanySiteImportRow[];
  counts: {
    sourceRows: number;
    wouldInsert: number;
    inserted: number;
    alreadyPresent: number;
    held: number;
    notImported: number;
  };
};

export class ReviewedCompanySiteImportTokenError extends Error {}
export class ReviewedCompanySiteImportInputError extends Error {}

type ParsedCsvRow = z.infer<typeof CsvCompanySiteRowSchema>;
type PreparedPlan = {
  environment: string;
  inputSha256: string;
  planHash: string;
  rows: ReviewedCompanySiteImportRow[];
  adverts: BoardAdvert[];
};

function currentEnvironment(): string {
  return process.env.NODE_ENV || "unknown";
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeText(value: unknown, maxLength = 500): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseReviewedCsv(buffer: Buffer): {
  inputSha256: string;
  rows: Array<{ sourceRow: string; parsed?: ParsedCsvRow; invalidReason?: string }>;
} {
  if (buffer.length === 0 || buffer.length > REVIEWED_COMPANY_SITE_IMPORT_MAX_BYTES) {
    throw new ReviewedCompanySiteImportInputError("Reviewed CSV must be non-empty and no larger than 1 MB.");
  }

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new ReviewedCompanySiteImportInputError("Reviewed CSV must be valid UTF-8.");
  }

  let headers: string[] = [];
  let records: Record<string, string>[] = [];
  try {
    records = parseCsv(source, {
      bom: true,
      columns: (rawHeaders: string[]) => {
        headers = rawHeaders.map((header) => header.trim());
        if (new Set(headers).size !== headers.length) {
          throw new Error("Reviewed CSV has duplicate column names.");
        }
        return headers;
      },
      skip_empty_lines: true,
      trim: true,
      max_record_size: 64_000,
    }) as Record<string, string>[];
  } catch (error) {
    if (error instanceof Error && error.message.includes("duplicate column")) {
      throw new ReviewedCompanySiteImportInputError(error.message);
    }
    throw new ReviewedCompanySiteImportInputError("Reviewed CSV could not be parsed.");
  }

  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw new ReviewedCompanySiteImportInputError(
      `Reviewed CSV is missing required columns: ${missingHeaders.join(", ")}.`,
    );
  }
  if (records.length === 0 || records.length > REVIEWED_COMPANY_SITE_IMPORT_MAX_ROWS) {
    throw new ReviewedCompanySiteImportInputError(
      `Reviewed CSV must contain 1 to ${REVIEWED_COMPANY_SITE_IMPORT_MAX_ROWS} data rows.`,
    );
  }

  const rows = records.map((raw, index) => {
    const sourceRow = safeText(raw.source_row, 80) || String(index + 1);
    const projected = Object.fromEntries(
      REQUIRED_HEADERS.map((header) => [header, typeof raw[header] === "string" ? raw[header] : ""]),
    );
    const result = CsvCompanySiteRowSchema.safeParse(projected);
    return result.success
      ? { sourceRow: result.data.source_row, parsed: result.data }
      : {
          sourceRow,
          invalidReason: `Invalid or missing required value: ${result.error.issues[0]?.path.join(".") || "row"}.`,
        };
  });

  return { inputSha256: sha256(buffer), rows };
}

function isSafeHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && !isBlockedVacancyUrl(value);
  } catch {
    return false;
  }
}

function statusCode(value: string): number | null {
  if (!/^\d{3}$/.test(value)) return null;
  const code = Number(value);
  return Number.isInteger(code) ? code : null;
}

function validationHoldReason(row: ParsedCsvRow, now: number): string | null {
  if (row.decision !== "READY") return "Source validation did not mark this row READY.";
  if (row.source_type !== "company_site") return "Only company-site source rows are accepted.";
  if (row.listing_fetch_status !== "HTTP_200" || statusCode(row.listing_http_status) !== 200) {
    return "The source listing was not validated with HTTP 200.";
  }
  if (!isValidVacancyUrlForSource(row.listing_url, "company_site")
    || !isValidVacancyUrlForSource(row.listing_final_url, "company_site")) {
    return "The validated listing URL is not a safe, specific vacancy page.";
  }
  if (!isSafeHttpsUrl(row.source_careers_page)) {
    return "The employer careers evidence URL is not a safe HTTPS page.";
  }
  if (row.page_employer_match !== "MATCH" || row.page_title_match !== "MATCH") {
    return "The listing page did not confirm both employer and title.";
  }
  if (row.current_status !== "CURRENT" || row.explicit_closed_phrase.toLowerCase() !== "false") {
    return "The listing was not confirmed current and open.";
  }
  const applicationUrl = row.application_final_url || row.application_url;
  const applicationStatus = statusCode(row.application_http_status);
  if (!applicationUrl || !isSafeHttpsUrl(applicationUrl)
    || applicationStatus === null || applicationStatus < 200 || applicationStatus >= 300
    || !/^REACHABLE_JOB_SPECIFIC(?:_|$)/.test(row.application_status)
    || row.application_job_specific.toLowerCase() !== "true") {
    return "The job-specific application destination was not confirmed reachable.";
  }
  const checkedAt = Date.parse(row.checked_at_utc);
  if (!Number.isFinite(checkedAt) || checkedAt > now
    || now - checkedAt > REVIEWED_COMPANY_SITE_IMPORT_MAX_AGE_MS) {
    return "The source validation is missing, future-dated, or older than 48 hours.";
  }
  return null;
}

function sponsorNameLookupVariants(name: string): string[] {
  const trimmed = name.trim();
  const variants = new Set([trimmed]);
  if (/\bltd\.?$/i.test(trimmed)) {
    variants.add(trimmed.replace(/\bltd\.?$/i, "Limited"));
  } else if (/\blimited\.?$/i.test(trimmed)) {
    variants.add(trimmed.replace(/\blimited\.?$/i, "Ltd"));
  }
  return [...variants];
}

async function resolveLocalEmployerNames(names: readonly string[]): Promise<Set<string>> {
  const uniqueNames = [...new Set(names)];
  if (uniqueNames.length === 0) return new Set();
  const lookupNames = [...new Set(uniqueNames.flatMap(sponsorNameLookupVariants))];
  // Deliberately resolve by name against this process's database. No sponsor
  // serial IDs or source database-match IDs are selected or accepted.
  const localRows = await db
    .select({ organisationName: sponsorLicencesTable.organisationName })
    .from(sponsorLicencesTable)
    .where(inArray(sponsorLicencesTable.organisationName, lookupNames));
  return new Set(localRows.map((row) => normalizeSponsorLegalNameValue(row.organisationName)));
}

function toAdvert(row: ParsedCsvRow): BoardAdvert {
  const applicationUrl = row.application_final_url || row.application_url;
  const closingDateMs = Date.parse(row.closing_date);
  const closesAt = row.closing_date
    && Number.isFinite(closingDateMs)
    && closingDateMs <= Date.now() + 5 * 365 * 24 * 60 * 60 * 1000
    ? new Date(closingDateMs)
    : undefined;
  return {
    organisationName: row.source_employer,
    employer: row.source_employer,
    title: row.source_title,
    location: row.source_location || null,
    salary: null,
    url: row.listing_url,
    applicationUrl,
    description: null,
    postedDate: null,
    targetRegions: null,
    boardName: null,
    externalId: null,
    sourceType: "company_site",
    ...(closesAt ? { closesAt } : {}),
    reviewedSourceRow: row.source_row,
    companyVacancyEvidence: {
      kind: "strict_role_page",
      listingUrl: row.source_careers_page,
      detailUrl: row.listing_final_url,
      applicationUrl,
    },
  };
}

async function buildPlan(buffer: Buffer): Promise<PreparedPlan> {
  const parsed = parseReviewedCsv(buffer);
  const environment = currentEnvironment();
  const now = Date.now();
  const resultRows: ReviewedCompanySiteImportRow[] = [];
  const candidates: Array<{ row: ParsedCsvRow; advert: BoardAdvert }> = [];
  const seenSourceRows = new Set<string>();

  for (const entry of parsed.rows) {
    if (!entry.parsed) {
      resultRows.push({
        sourceRow: entry.sourceRow,
        employer: "",
        title: "",
        listingUrl: null,
        applicationUrl: null,
        status: "held",
        reason: entry.invalidReason ?? "Invalid source row.",
      });
      continue;
    }

    const row = entry.parsed;
    const base = {
      sourceRow: row.source_row,
      employer: row.source_employer,
      title: row.source_title,
      listingUrl: row.listing_url || null,
      applicationUrl: row.application_final_url || row.application_url || null,
    };
    if (seenSourceRows.has(row.source_row)) {
      resultRows.push({ ...base, status: "held", reason: "Duplicate source_row value in uploaded CSV." });
      continue;
    }
    seenSourceRows.add(row.source_row);

    const reason = validationHoldReason(row, now);
    if (reason) {
      resultRows.push({ ...base, status: "held", reason });
      continue;
    }
    const [normalizedAdvert] = normaliseAndDedupeBoardAdverts([toAdvert(row)]);
    if (!normalizedAdvert) {
      resultRows.push({
        ...base,
        status: "held",
        reason: "The shared vacancy policy rejected this title or listing.",
      });
      continue;
    }
    candidates.push({ row, advert: normalizedAdvert });
  }

  const localEmployerNames = await resolveLocalEmployerNames(
    candidates.map(({ row }) => row.source_employer),
  );
  const eligible: Array<{ row: ParsedCsvRow; advert: BoardAdvert }> = [];
  const seenCanonicalUrls = new Set<string>();
  const seenFingerprints = new Set<string>();
  for (const candidate of candidates) {
    const { row, advert } = candidate;
    const base = {
      sourceRow: row.source_row,
      employer: row.source_employer,
      title: row.source_title,
      listingUrl: row.listing_url,
      applicationUrl: row.application_final_url || row.application_url,
    };
    if (!localEmployerNames.has(normalizeSponsorLegalNameValue(row.source_employer))) {
      resultRows.push({
        ...base,
        status: "held",
        reason: "Employer name does not resolve in the target environment's sponsor register.",
      });
      continue;
    }
    const canonical = canonicalVacancyUrl(advert.url);
    const fingerprint = boardVacancyFingerprint(advert);
    if (!canonical || seenCanonicalUrls.has(canonical)) {
      resultRows.push({
        ...base,
        status: "held",
        reason: "Duplicate canonical listing URL within the reviewed CSV.",
      });
      continue;
    }
    if (seenFingerprints.has(fingerprint)) {
      resultRows.push({
        ...base,
        status: "held",
        reason: "Duplicate employer/title/location fingerprint within the reviewed CSV.",
      });
      continue;
    }
    seenCanonicalUrls.add(canonical);
    seenFingerprints.add(fingerprint);
    eligible.push(candidate);
  }

  const writerResult = await upsertSharedBoardVacancies(
    eligible.map(({ advert }) => advert),
    {
      dryRun: true,
      skipExisting: true,
      enrichContacts: false,
      queueVerifications: false,
      includeOutcomes: true,
    },
  );
  const writerOutcomes = new Map(
    (writerResult.outcomes ?? []).flatMap((outcome) =>
      outcome.sourceRow ? [[outcome.sourceRow, outcome] as const] : [],
    ),
  );
  for (const { row } of eligible) {
    const outcome = writerOutcomes.get(row.source_row);
    const base = {
      sourceRow: row.source_row,
      employer: row.source_employer,
      title: row.source_title,
      listingUrl: row.listing_url,
      applicationUrl: row.application_final_url || row.application_url,
    };
    if (!outcome) {
      resultRows.push({
        ...base,
        status: "held",
        reason: "The shared vacancy writer did not return a match outcome.",
      });
      continue;
    }
    resultRows.push({
      ...base,
      status: outcome.status === "would_insert" ? "would_insert" : "already_present",
      ...(outcome.matchedBy ? { matchedBy: outcome.matchedBy } : {}),
    });
  }

  const bySourceOrder = new Map(parsed.rows.map((entry, index) => [entry.sourceRow, index]));
  resultRows.sort((left, right) =>
    (bySourceOrder.get(left.sourceRow) ?? Number.MAX_SAFE_INTEGER)
    - (bySourceOrder.get(right.sourceRow) ?? Number.MAX_SAFE_INTEGER),
  );
  const planHash = sha256(JSON.stringify(resultRows));
  return {
    environment,
    inputSha256: parsed.inputSha256,
    planHash,
    rows: resultRows,
    adverts: eligible.map(({ advert }) => advert),
  };
}

function signPlanToken(plan: PreparedPlan): { token: string; expiresAt: string } {
  const secret = process.env.VACANCY_JOB_SECRET;
  if (!secret) throw new Error("VACANCY_JOB_SECRET is not configured.");
  const expiresAtMs = Date.now() + REVIEW_TOKEN_TTL_MS;
  const payload = Buffer.from(JSON.stringify({
    version: 1,
    environment: plan.environment,
    inputSha256: plan.inputSha256,
    planHash: plan.planHash,
    expiresAtMs,
  })).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return { token: `${payload}.${signature}`, expiresAt: new Date(expiresAtMs).toISOString() };
}

function verifyPlanToken(
  token: string,
  expected: { environment: string; inputSha256: string },
): { planHash: string } {
  const secret = process.env.VACANCY_JOB_SECRET;
  if (!secret) throw new Error("VACANCY_JOB_SECRET is not configured.");
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) {
    throw new ReviewedCompanySiteImportTokenError("Preview token is invalid; run a new dry-run.");
  }
  const expectedSignature = createHmac("sha256", secret).update(payload).digest();
  let providedSignature: Buffer;
  try {
    providedSignature = Buffer.from(signature, "base64url");
  } catch {
    throw new ReviewedCompanySiteImportTokenError("Preview token is invalid; run a new dry-run.");
  }
  if (providedSignature.length !== expectedSignature.length
    || !timingSafeEqual(providedSignature, expectedSignature)) {
    throw new ReviewedCompanySiteImportTokenError("Preview token is invalid; run a new dry-run.");
  }

  let decoded: {
    version?: number;
    environment?: string;
    inputSha256?: string;
    planHash?: string;
    expiresAtMs?: number;
  };
  try {
    decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as typeof decoded;
  } catch {
    throw new ReviewedCompanySiteImportTokenError("Preview token is invalid; run a new dry-run.");
  }
  if (decoded.version !== 1
    || decoded.environment !== expected.environment
    || decoded.inputSha256 !== expected.inputSha256
    || typeof decoded.planHash !== "string"
    || typeof decoded.expiresAtMs !== "number"
    || decoded.expiresAtMs <= Date.now()) {
    throw new ReviewedCompanySiteImportTokenError(
      "Preview token expired or no longer matches this file and environment; run a new dry-run.",
    );
  }
  return { planHash: decoded.planHash };
}

function buildReport(
  mode: "dry-run" | "apply",
  plan: PreparedPlan,
  rows = plan.rows,
): ReviewedCompanySiteImportReport {
  return {
    mode,
    environment: plan.environment,
    inputSha256: plan.inputSha256,
    rows,
    counts: {
      sourceRows: rows.length,
      wouldInsert: rows.filter((row) => row.status === "would_insert").length,
      inserted: rows.filter((row) => row.status === "inserted").length,
      alreadyPresent: rows.filter((row) => row.status === "already_present").length,
      held: rows.filter((row) => row.status === "held").length,
      notImported: rows.filter((row) => row.status === "not_imported_batch_error").length,
    },
  };
}

export async function previewReviewedCompanySiteCsv(buffer: Buffer): Promise<
  ReviewedCompanySiteImportReport & { dryRunToken: string; tokenExpiresAt: string; planHash: string }
> {
  const plan = await buildPlan(buffer);
  const signed = signPlanToken(plan);
  return {
    ...buildReport("dry-run", plan),
    dryRunToken: signed.token,
    tokenExpiresAt: signed.expiresAt,
    planHash: plan.planHash,
  };
}

export async function applyReviewedCompanySiteCsv(
  buffer: Buffer,
  dryRunToken: string,
): Promise<ReviewedCompanySiteImportReport> {
  const parsed = parseReviewedCsv(buffer);
  const environment = currentEnvironment();
  const tokenPayload = verifyPlanToken(dryRunToken, {
    environment,
    inputSha256: parsed.inputSha256,
  });
  const plan = await buildPlan(buffer);
  if (plan.planHash !== tokenPayload.planHash) {
    throw new ReviewedCompanySiteImportTokenError(
      "The target database changed after preview; run a new dry-run before applying.",
    );
  }

  try {
    const writerResult = await upsertSharedBoardVacancies(plan.adverts, {
      skipExisting: true,
      enrichContacts: false,
      queueVerifications: true,
      includeOutcomes: true,
    });
    const writerOutcomes = new Map(
      (writerResult.outcomes ?? []).flatMap((outcome) =>
        outcome.sourceRow ? [[outcome.sourceRow, outcome] as const] : [],
      ),
    );
    const rows = plan.rows.map((row): ReviewedCompanySiteImportRow => {
      if (row.status !== "would_insert") return row;
      const outcome = writerOutcomes.get(row.sourceRow);
      if (outcome?.status === "inserted") {
        return { ...row, status: "inserted", verificationStatus: "queued_unverified" };
      }
      if (outcome?.status === "already_present") {
        return {
          ...row,
          status: "already_present",
          ...(outcome.matchedBy ? { matchedBy: outcome.matchedBy } : {}),
          reason: "An exact/canonical/fingerprint match was found at apply time; existing data was left unchanged.",
        };
      }
      return {
        ...row,
        status: "not_imported_batch_error",
        reason: "The shared vacancy writer returned no insert outcome; review the batch before retrying.",
      };
    });
    return buildReport("apply", plan, rows);
  } catch {
    const rows = plan.rows.map((row): ReviewedCompanySiteImportRow =>
      row.status === "would_insert"
        ? {
            ...row,
            status: "not_imported_batch_error",
            reason: "The writer did not confirm this row's outcome; verify target rows before retrying.",
          }
        : row,
    );
    return buildReport("apply", plan, rows);
  }
}
