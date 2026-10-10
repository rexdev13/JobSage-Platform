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
import { verifyPublicBoardRevalidation } from "./publicBoardRevalidationProof";

export const REVIEWED_PUBLIC_BOARD_IMPORT_CONFIRMATION =
  "apply-reviewed-public-board-vacancy-import";
export const REVIEWED_PUBLIC_BOARD_IMPORT_MAX_BYTES = 3_000_000;
export const REVIEWED_PUBLIC_BOARD_IMPORT_MAX_ROWS = 4_000;
export const REVIEWED_PUBLIC_BOARD_IMPORT_MAX_OBSERVATION_AGE_MS = 24 * 60 * 60 * 1000;
export const REVIEWED_PUBLIC_BOARD_IMPORT_MAX_REVALIDATION_AGE_MS = 2 * 60 * 60 * 1000;

const REVIEW_TOKEN_TTL_MS = 30 * 60 * 1000;
const ALLOWED_SOURCES = new Set([
  "NHS Jobs",
  "Teaching Vacancies",
  "NHS Scotland",
  "Himalayas",
  "CharityJob",
  "jobs.ac.uk",
  "Reed",
  "Arbeitnow",
  "Jobicy",
]);

const REQUIRED_HEADERS = [
  "sponsor_name",
  "vacancy_category",
  "title",
  "employer",
  "location",
  "apply_url",
  "canonical_url_valid",
  "application_mode",
  "source",
  "external_id",
  "observed_at",
  "closes_at",
  "sponsor_match_status",
  "identity_import_eligible",
  "title_policy_eligible",
  "guarded_import_eligible",
  "sponsorship_status",
  "freshness_status",
  "candidate_visibility_status",
  "blocking_reason",
  "revalidation_status",
  "revalidated_at",
  "revalidated_final_url",
  "revalidation_reason",
  "revalidation_input_sha256",
  "revalidation_source_row",
  "revalidation_total_rows",
  "revalidation_row_hash",
  "revalidation_proof",
] as const;

const CsvReviewedPublicBoardRowSchema = z.object({
  sponsor_name: z.string().trim().min(1).max(300),
  vacancy_category: z.string().trim().max(100),
  title: z.string().trim().min(1).max(500),
  employer: z.string().trim().min(1).max(300),
  location: z.string().trim().min(1).max(500),
  apply_url: z.string().trim().min(1).max(2048),
  canonical_url_valid: z.string().trim().max(20),
  application_mode: z.string().trim().max(40),
  source: z.string().trim().min(1).max(80),
  external_id: z.string().trim().min(1).max(300),
  observed_at: z.string().trim().min(1).max(80),
  closes_at: z.string().trim().max(80),
  sponsor_match_status: z.string().trim().max(80),
  identity_import_eligible: z.string().trim().max(20),
  title_policy_eligible: z.string().trim().max(20),
  guarded_import_eligible: z.string().trim().max(20),
  sponsorship_status: z.string().trim().max(40),
  freshness_status: z.string().trim().max(80),
  candidate_visibility_status: z.string().trim().max(100),
  blocking_reason: z.string().trim().max(1000),
  revalidation_status: z.string().trim().max(40),
  revalidated_at: z.string().trim().max(80),
  revalidated_final_url: z.string().trim().max(2048),
  revalidation_reason: z.string().trim().max(500),
  revalidation_input_sha256: z.string().trim().max(100),
  revalidation_source_row: z.string().trim().max(20),
  revalidation_total_rows: z.string().trim().max(20),
  revalidation_row_hash: z.string().trim().max(100),
  revalidation_proof: z.string().trim().max(200),
});

type ParsedCsvRow = z.infer<typeof CsvReviewedPublicBoardRowSchema>;
type ParsedCsvEntry = {
  sourceRow: string;
  raw: Record<string, string>;
  parsed?: ParsedCsvRow;
  invalidReason?: string;
};
type PreparedPlan = {
  environment: string;
  inputSha256: string;
  planHash: string;
  rows: ReviewedPublicBoardImportRow[];
  adverts: BoardAdvert[];
};

export type ReviewedPublicBoardImportRow = {
  sourceRow: string;
  source: string;
  employer: string;
  sponsorName: string;
  title: string;
  url: string | null;
  status:
    | "held"
    | "would_insert"
    | "already_present"
    | "inserted"
    | "not_imported_batch_error";
  reason?: string;
  matchedBy?: UpsertBoardVacancyOutcome["matchedBy"];
  verificationStatus?: "verified_live_from_reviewed_revalidation";
};

export type ReviewedPublicBoardImportReport = {
  mode: "dry-run" | "apply";
  environment: string;
  inputSha256: string;
  rows: ReviewedPublicBoardImportRow[];
  counts: {
    sourceRows: number;
    wouldInsert: number;
    inserted: number;
    alreadyPresent: number;
    held: number;
    notImported: number;
  };
};

export class ReviewedPublicBoardImportInputError extends Error {}
export class ReviewedPublicBoardImportTokenError extends Error {}

function currentEnvironment(): string {
  return process.env.NODE_ENV || "unknown";
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function parseReviewedCsv(buffer: Buffer): {
  inputSha256: string;
  rows: ParsedCsvEntry[];
} {
  if (buffer.length === 0 || buffer.length > REVIEWED_PUBLIC_BOARD_IMPORT_MAX_BYTES) {
    throw new ReviewedPublicBoardImportInputError(
      `Reviewed public-board CSV must be non-empty and no larger than ${REVIEWED_PUBLIC_BOARD_IMPORT_MAX_BYTES} bytes.`,
    );
  }

  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new ReviewedPublicBoardImportInputError("Reviewed public-board CSV must be valid UTF-8.");
  }

  let headers: string[] = [];
  let records: Record<string, string>[] = [];
  try {
    records = parseCsv(source, {
      bom: true,
      columns: (rawHeaders: string[]) => {
        headers = rawHeaders.map((header) => header.trim());
        if (new Set(headers).size !== headers.length) {
          throw new Error("Reviewed public-board CSV has duplicate column names.");
        }
        return headers;
      },
      skip_empty_lines: true,
      trim: true,
      max_record_size: 64_000,
    }) as Record<string, string>[];
  } catch (error) {
    if (error instanceof Error && error.message.includes("duplicate column")) {
      throw new ReviewedPublicBoardImportInputError(error.message);
    }
    throw new ReviewedPublicBoardImportInputError("Reviewed public-board CSV could not be parsed.");
  }

  const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw new ReviewedPublicBoardImportInputError(
      `Reviewed public-board CSV is missing required columns: ${missingHeaders.join(", ")}.`,
    );
  }
  if (records.length === 0 || records.length > REVIEWED_PUBLIC_BOARD_IMPORT_MAX_ROWS) {
    throw new ReviewedPublicBoardImportInputError(
      `Reviewed public-board CSV must contain 1 to ${REVIEWED_PUBLIC_BOARD_IMPORT_MAX_ROWS} data rows.`,
    );
  }

  const rows = records.map((raw, index) => {
    const sourceRow = String(index + 2);
    const record = Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [key, typeof value === "string" ? value : ""]),
    );
    const projected = Object.fromEntries(
      REQUIRED_HEADERS.map((header) => [header, typeof raw[header] === "string" ? raw[header] : ""]),
    );
    const result = CsvReviewedPublicBoardRowSchema.safeParse(projected);
    return result.success
      ? { sourceRow, raw: record, parsed: result.data }
      : {
          sourceRow,
          raw: record,
          invalidReason: `Invalid or missing required value: ${result.error.issues[0]?.path.join(".") || "row"}.`,
        };
  });

  return { inputSha256: sha256(buffer), rows };
}

function isSafeHttpsVacancyUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && !parsed.username
      && !parsed.password
      && !isBlockedVacancyUrl(value)
      && isValidVacancyUrlForSource(value, "job_board");
  } catch {
    return false;
  }
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

function validationHoldReason(
  row: ParsedCsvRow,
  raw: Record<string, string>,
  sourceRow: string,
  totalRows: number,
  batchEvidenceValid: boolean,
  now: number,
): string | null {
  if (!batchEvidenceValid
    || !verifyPublicBoardRevalidation(raw, {
      environment: currentEnvironment(),
      sourceRow,
      totalRows,
    })) {
    return "The recent URL check does not have a valid server-signed proof for this exact source row and environment.";
  }
  if (row.guarded_import_eligible !== "true") return "The audit guard did not approve this row.";
  if (row.identity_import_eligible !== "true") return "The employer identity was not approved by the audit.";
  if (row.title_policy_eligible !== "true") return "The title did not pass the audit's vacancy policy.";
  if (row.application_mode !== "job_board") return "Only public job-board vacancies are accepted.";
  if (!ALLOWED_SOURCES.has(row.source)) return "The source is not in the reviewed public-board allowlist.";
  if (!["exact-register-name", "unique-normalised-register-name"].includes(row.sponsor_match_status)) {
    return "The sponsor-register match is not an approved exact or unique normalized match.";
  }
  if (normalizeSponsorLegalNameValue(row.employer) !== normalizeSponsorLegalNameValue(row.sponsor_name)) {
    return "The source employer does not normalize to the reviewed sponsor-register identity.";
  }
  if (row.canonical_url_valid !== "true" || !isSafeHttpsVacancyUrl(row.apply_url)) {
    return "The listing URL is not a safe, specific HTTPS job-board vacancy page.";
  }
  if (!row.external_id) return "The source listing has no stable external ID.";
  if (row.sponsorship_status !== "unknown") {
    return "The audit must not infer sponsorship from sponsor-register membership.";
  }
  if (row.freshness_status !== "current_source_observation") {
    return "The source row is not from a current observation.";
  }
  if (row.candidate_visibility_status !== "eligible_after_import_and_persisted_liveness") {
    return "The audit did not approve candidate visibility after persisted liveness.";
  }
  if (row.blocking_reason) return "The audit row still has a blocking reason.";
  if (row.revalidation_status !== "live") {
    return row.revalidation_reason
      ? `Fresh URL revalidation was not live: ${row.revalidation_reason}`
      : "Fresh URL revalidation did not confirm a live destination.";
  }
  if (!isSafeHttpsVacancyUrl(row.revalidated_final_url)) {
    return "The revalidated final destination is not a safe job-specific HTTPS URL.";
  }

  const observedAt = Date.parse(row.observed_at);
  if (!Number.isFinite(observedAt) || observedAt > now
    || now - observedAt > REVIEWED_PUBLIC_BOARD_IMPORT_MAX_OBSERVATION_AGE_MS) {
    return "The source observation is missing, future-dated, or older than 24 hours.";
  }
  const revalidatedAt = Date.parse(row.revalidated_at);
  if (!Number.isFinite(revalidatedAt) || revalidatedAt > now
    || now - revalidatedAt > REVIEWED_PUBLIC_BOARD_IMPORT_MAX_REVALIDATION_AGE_MS) {
    return "The URL revalidation is missing, future-dated, or older than two hours.";
  }
  if (row.closes_at) {
    const closesAtMs = Date.parse(row.closes_at);
    if (!Number.isFinite(closesAtMs)) return "The advertised closing date is invalid.";
    if (closesAtMs <= now) return "The advertised closing date has passed.";
  }
  return null;
}

async function resolveLocalSponsorNames(names: readonly string[]): Promise<Map<string, Set<string>>> {
  const uniqueNames = [...new Set(names)];
  if (uniqueNames.length === 0) return new Map();
  const lookupNames = [...new Set(uniqueNames.flatMap(sponsorNameLookupVariants))];
  // Resolve against the target environment by name. Source-side database IDs
  // and sponsor serial IDs are neither selected nor accepted.
  const localRows = await db
    .select({ organisationName: sponsorLicencesTable.organisationName })
    .from(sponsorLicencesTable)
    .where(inArray(sponsorLicencesTable.organisationName, lookupNames));
  const matches = new Map<string, Set<string>>();
  for (const row of localRows) {
    const normalized = normalizeSponsorLegalNameValue(row.organisationName);
    const namesForIdentity = matches.get(normalized) ?? new Set<string>();
    namesForIdentity.add(row.organisationName);
    matches.set(normalized, namesForIdentity);
  }
  return matches;
}

function toAdvert(
  row: ParsedCsvRow,
  sourceRow: string,
  inputSha256: string,
): BoardAdvert {
  const closingDateMs = Date.parse(row.closes_at);
  const closesAt = row.closes_at && Number.isFinite(closingDateMs)
    ? new Date(closingDateMs)
    : undefined;
  return {
    organisationName: row.sponsor_name,
    employer: row.employer,
    title: row.title,
    location: row.location,
    salary: null,
    url: row.apply_url,
    applicationUrl: row.revalidated_final_url,
    description: null,
    postedDate: null,
    targetRegions: null,
    boardName: row.source,
    sourceId: `job_board:${row.source.toLowerCase()}`,
    externalId: row.external_id,
    sourceType: "job_board",
    sourceMetadata: {
      provider: row.source,
      parserVersion: "reviewed-public-board-audit-v1",
      reviewedImportInputSha256: inputSha256,
      reviewedCsvRow: sourceRow,
      sourceObservedAt: row.observed_at,
      revalidatedAt: row.revalidated_at,
      revalidatedFinalUrl: row.revalidated_final_url,
      sponsorMatchStatus: row.sponsor_match_status,
      sponsorshipStatus: "unknown",
      vacancyCategory: row.vacancy_category,
    },
    // Public-board contact fields in the source file are deliberately not
    // copied: this importer does not establish Send CV contact provenance.
    ...(closesAt ? { closesAt } : {}),
    reviewedSourceRow: sourceRow,
  };
}

async function buildPlan(buffer: Buffer): Promise<PreparedPlan> {
  const parsed = parseReviewedCsv(buffer);
  const environment = currentEnvironment();
  const now = Date.now();
  const proofInputHashes = new Set(
    parsed.rows.map((entry) => entry.raw.revalidation_input_sha256).filter(Boolean),
  );
  const batchEvidenceValid =
    proofInputHashes.size === 1
    && parsed.rows.every((entry) =>
      entry.raw.revalidation_total_rows === String(parsed.rows.length),
    );
  const resultRows: ReviewedPublicBoardImportRow[] = [];
  const candidates: Array<{ sourceRow: string; row: ParsedCsvRow; advert: BoardAdvert }> = [];
  const seenSourceIds = new Set<string>();
  const seenCanonicalUrls = new Set<string>();
  const seenFingerprints = new Set<string>();

  for (const entry of parsed.rows) {
    if (!entry.parsed) {
      resultRows.push({
        sourceRow: entry.sourceRow,
        source: "",
        employer: "",
        sponsorName: "",
        title: "",
        url: null,
        status: "held",
        reason: entry.invalidReason ?? "Invalid source row.",
      });
      continue;
    }

    const row = entry.parsed;
    const base = {
      sourceRow: entry.sourceRow,
      source: row.source,
      employer: row.employer,
      sponsorName: row.sponsor_name,
      title: row.title,
      url: row.apply_url || null,
    };
    const sourceExternalKey = `${row.source.toLowerCase()}\u0000${row.external_id}`;
    const canonical = canonicalVacancyUrl(row.apply_url);
    const advert = toAdvert(row, entry.sourceRow, parsed.inputSha256);
    const fingerprint = boardVacancyFingerprint(advert);
    if (seenSourceIds.has(sourceExternalKey)) {
      resultRows.push({ ...base, status: "held", reason: "Duplicate source and external ID in the reviewed CSV." });
      continue;
    }
    seenSourceIds.add(sourceExternalKey);
    if (!canonical || seenCanonicalUrls.has(canonical)) {
      resultRows.push({ ...base, status: "held", reason: "Duplicate or invalid canonical URL in the reviewed CSV." });
      continue;
    }
    seenCanonicalUrls.add(canonical);
    if (seenFingerprints.has(fingerprint)) {
      resultRows.push({ ...base, status: "held", reason: "Duplicate employer/title/location fingerprint in the reviewed CSV." });
      continue;
    }
    seenFingerprints.add(fingerprint);

    const reason = validationHoldReason(
      row,
      entry.raw,
      entry.sourceRow,
      parsed.rows.length,
      batchEvidenceValid,
      now,
    );
    if (reason) {
      resultRows.push({ ...base, status: "held", reason });
      continue;
    }
    const [normalizedAdvert] = normaliseAndDedupeBoardAdverts([advert]);
    if (!normalizedAdvert) {
      resultRows.push({
        ...base,
        status: "held",
        reason: "The shared vacancy policy rejected this title or listing.",
      });
      continue;
    }
    candidates.push({ sourceRow: entry.sourceRow, row, advert: normalizedAdvert });
  }

  const localNames = await resolveLocalSponsorNames(candidates.map(({ row }) => row.sponsor_name));
  const eligible: typeof candidates = [];
  for (const candidate of candidates) {
    const { sourceRow, row, advert } = candidate;
    const normalizedSponsorName = normalizeSponsorLegalNameValue(row.sponsor_name);
    const localMatches = localNames.get(normalizedSponsorName);
    const base = {
      sourceRow,
      source: row.source,
      employer: row.employer,
      sponsorName: row.sponsor_name,
      title: row.title,
      url: row.apply_url,
    };
    if (!localMatches?.size) {
      resultRows.push({
        ...base,
        status: "held",
        reason: "Sponsor name does not resolve in the target environment's sponsor register.",
      });
      continue;
    }
    if (localMatches.size > 1) {
      resultRows.push({
        ...base,
        status: "held",
        reason: "Sponsor name resolves to multiple distinct local register names.",
      });
      continue;
    }
    eligible.push({ sourceRow, row, advert });
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
  for (const { sourceRow, row } of eligible) {
    const outcome = writerOutcomes.get(sourceRow);
    const base = {
      sourceRow,
      source: row.source,
      employer: row.employer,
      sponsorName: row.sponsor_name,
      title: row.title,
      url: row.apply_url,
    };
    if (!outcome) {
      resultRows.push({
        ...base,
        status: "held",
        reason: "The shared vacancy writer did not return a row outcome.",
      });
      continue;
    }
    resultRows.push({
      ...base,
      status: outcome.status === "would_insert" ? "would_insert" : "already_present",
      ...(outcome.matchedBy ? { matchedBy: outcome.matchedBy } : {}),
    });
  }

  const sourceOrder = new Map(parsed.rows.map((entry, index) => [entry.sourceRow, index]));
  resultRows.sort((left, right) =>
    (sourceOrder.get(left.sourceRow) ?? Number.MAX_SAFE_INTEGER)
    - (sourceOrder.get(right.sourceRow) ?? Number.MAX_SAFE_INTEGER),
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
    throw new ReviewedPublicBoardImportTokenError("Preview token is invalid; run a new dry-run.");
  }
  const expectedSignature = createHmac("sha256", secret).update(payload).digest();
  let providedSignature: Buffer;
  try {
    providedSignature = Buffer.from(signature, "base64url");
  } catch {
    throw new ReviewedPublicBoardImportTokenError("Preview token is invalid; run a new dry-run.");
  }
  if (providedSignature.length !== expectedSignature.length
    || !timingSafeEqual(providedSignature, expectedSignature)) {
    throw new ReviewedPublicBoardImportTokenError("Preview token is invalid; run a new dry-run.");
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
    throw new ReviewedPublicBoardImportTokenError("Preview token is invalid; run a new dry-run.");
  }
  if (decoded.version !== 1
    || decoded.environment !== expected.environment
    || decoded.inputSha256 !== expected.inputSha256
    || typeof decoded.planHash !== "string"
    || typeof decoded.expiresAtMs !== "number"
    || decoded.expiresAtMs <= Date.now()) {
    throw new ReviewedPublicBoardImportTokenError(
      "Preview token expired or no longer matches this file and environment; run a new dry-run.",
    );
  }
  return { planHash: decoded.planHash };
}

function buildReport(
  mode: "dry-run" | "apply",
  plan: PreparedPlan,
  rows = plan.rows,
): ReviewedPublicBoardImportReport {
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

export async function previewReviewedPublicBoardCsv(buffer: Buffer): Promise<
  ReviewedPublicBoardImportReport & { dryRunToken: string; tokenExpiresAt: string; planHash: string }
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

export async function applyReviewedPublicBoardCsv(
  buffer: Buffer,
  dryRunToken: string,
): Promise<ReviewedPublicBoardImportReport> {
  const parsed = parseReviewedCsv(buffer);
  const environment = currentEnvironment();
  const tokenPayload = verifyPlanToken(dryRunToken, {
    environment,
    inputSha256: parsed.inputSha256,
  });
  const plan = await buildPlan(buffer);
  if (plan.planHash !== tokenPayload.planHash) {
    throw new ReviewedPublicBoardImportTokenError(
      "The target database changed after preview; run a new dry-run before applying.",
    );
  }

  try {
    const writerResult = await upsertSharedBoardVacancies(plan.adverts, {
      skipExisting: true,
      enrichContacts: false,
      // Every imported URL must have passed the recent safe revalidation in the
      // reviewed CSV. Persist that evidence as live, without a detached second
      // queue that could outlive a process restart.
      verifiedLive: true,
      queueVerifications: false,
      includeOutcomes: true,
    });
    const writerOutcomes = new Map(
      (writerResult.outcomes ?? []).flatMap((outcome) =>
        outcome.sourceRow ? [[outcome.sourceRow, outcome] as const] : [],
      ),
    );
    const rows = plan.rows.map((row): ReviewedPublicBoardImportRow => {
      if (row.status !== "would_insert") return row;
      const outcome = writerOutcomes.get(row.sourceRow);
      if (outcome?.status === "inserted") {
        return { ...row, status: "inserted", verificationStatus: "verified_live_from_reviewed_revalidation" };
      }
      if (outcome?.status === "already_present") {
        return {
          ...row,
          status: "already_present",
          ...(outcome.matchedBy ? { matchedBy: outcome.matchedBy } : {}),
          reason: "A duplicate was found at apply time; the existing vacancy was left unchanged.",
        };
      }
      return {
        ...row,
        status: "not_imported_batch_error",
        reason: "The shared vacancy writer did not confirm the row outcome; inspect the database before retrying.",
      };
    });
    return buildReport("apply", plan, rows);
  } catch {
    const rows = plan.rows.map((row): ReviewedPublicBoardImportRow =>
      row.status === "would_insert"
        ? {
            ...row,
            status: "not_imported_batch_error",
            reason: "The writer did not confirm this row's outcome; inspect the target before retrying.",
          }
        : row,
    );
    return buildReport("apply", plan, rows);
  }
}
