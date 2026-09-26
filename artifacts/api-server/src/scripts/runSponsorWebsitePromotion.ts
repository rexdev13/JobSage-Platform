import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { classifySponsorWebsitePromotion } from "../lib/sponsorWebsitePromotion";
import type { CompanySiteDiscoveryDiagnostics } from "../lib/companySiteDiscovery";
import { runCompanySiteCheck } from "../lib/companySiteScheduler";
import { verifyCompanySiteStoredLink } from "../lib/companySiteVerification";

type Confidence = "high" | "medium" | "low" | "none";
type Decision = "auto_promote" | "review_required" | "reject";

type AuditCandidate = {
  url: string;
  hostname: string;
  title: string;
  snippet: string;
  sourceUrl: string;
  sourceType: string;
  confidence: Confidence;
  reason: string;
};

type PageOutcome = {
  target: {
    url: string;
    organisationName: string;
    townCity: string | null;
    sourceType: string;
    reasons: string[];
  };
  fetched: boolean;
  pageUrl: string | null;
  pageTitle: string | null;
  identityVerified: boolean;
  geographyMismatch: boolean;
  websiteConfidence: Confidence;
  error: string | null;
  excerpt: string;
};

type AuditRecord = {
  runId: string;
  organisationKey: string;
  organisationName: string;
  sampleGroup: string;
  sector: string;
  townCity: string | null;
  existingWebsiteUrl: string | null;
  existingCareersUrl: string | null;
  websiteUrl: string | null;
  websiteConfidence: Confidence;
  websiteEvidenceUrl: string | null;
  careersUrl: string | null;
  careersConfidence: Confidence;
  careersEvidenceUrl: string | null;
  atsProvider: string | null;
  atsBoardId: string | null;
  atsMappingStatus: "verified" | "unverified" | "invalid" | null;
  atsMappingEvidenceUrl: string | null;
  classifications: string[];
  candidateResults: AuditCandidate[];
  checkedAt: string;
  lastError: string | null;
};

type AuditSnapshot = {
  runId: string;
  records: AuditRecord[];
  pageOutcomes: PageOutcome[];
};

type SponsorDbRow = {
  id: number | string;
  organisation_name: string;
  website: string | null;
  town_city: string | null;
  industry: string | null;
  careers_url: string | null;
  ats_provider: string | null;
  ats_board_id: string | null;
  ats_mapping_status: "verified" | "unverified" | "invalid" | null;
  ats_mapping_evidence_url: string | null;
  generic_checked_at: Date | string | null;
  ats_checked_at: Date | string | null;
};

type ClassificationRow = {
  run_id: string;
  organisation_name: string;
  sample_group: string;
  sector: string;
  original_confidence: Confidence;
  promotion_decision: Decision;
  candidate_website: string | null;
  candidate_source_type: string | null;
  sponsor_licence_id: number | null;
  sponsor_licence_ids: number[];
  domain_match_score: number;
  identity_match_evidence: string | null;
  geography_check: "match" | "mismatch" | "missing";
  blocked_host_check: string;
  existing_data_conflict_check: string;
  decision_reason: string;
  candidate_careers_url_if_any: string | null;
  candidate_careers_confidence: Confidence;
  candidate_ats_provider_if_any: string | null;
  candidate_ats_board_id_if_any: string | null;
  candidate_ats_mapping_status_if_any: string | null;
  audit_checked_at: string;
};

type DiscoveryRow = {
  id: number | string;
  organisation_name: string;
  title: string;
  url: string;
  application_url: string | null;
  source_type: string;
  last_discovered_at: Date | string;
  liveness: string;
  last_verified_at: Date | string | null;
  closes_at: Date | string | null;
};

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "../../../../");
const OUTPUT_BASE_DIR = path.join(REPO_ROOT, ".agents/outputs/sponsor-website-sample");
const SAMPLE_PATH = path.join(OUTPUT_BASE_DIR, "safe-page-results.json");
const PRIOR_APPROVED_CLASSIFICATION_PATH = path.join(
  OUTPUT_BASE_DIR,
  "website-promotion-classification.json",
);

function outputPaths(healthcareOnly: boolean, approved26: boolean) {
  const outputDir = approved26
    ? path.join(OUTPUT_BASE_DIR, "approved-26-rerun")
    : healthcareOnly
      ? path.join(OUTPUT_BASE_DIR, "healthcare")
      : OUTPUT_BASE_DIR;
  return {
    outputDir,
    classificationJson: path.join(outputDir, "website-promotion-classification.json"),
    classificationCsv: path.join(outputDir, "website-promotion-classification.csv"),
    importReport: path.join(outputDir, "website-auto-promote-import-report.md"),
    vacancyReport: path.join(outputDir, "website-auto-promote-vacancy-results.md"),
  };
}

function assertDevelopmentOnly(): void {
  if (process.env.NODE_ENV !== "development") {
    throw new Error(
      "Sponsor website promotion is development-only. Run with NODE_ENV=development and do not point it at production.",
    );
  }
}

function orgKey(value: string): string {
  return value.trim().toLocaleLowerCase("en-GB");
}

function urlHost(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function siteKey(value: string | null): string | null {
  const host = urlHost(value);
  if (!host) return null;
  const parts = host.split(".");
  const multiPartSuffixes = new Set(["co.uk", "org.uk", "gov.uk", "ac.uk", "com.au", "co.nz"]);
  const suffix = parts.slice(-2).join(".");
  const rootLength = multiPartSuffixes.has(suffix) ? 3 : 2;
  return parts.slice(-rootLength).join(".");
}

function websiteOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return `${url.protocol}//${url.host}/`;
  } catch {
    return null;
  }
}

function approvedWebsiteUrl(record: AuditRecord, outcome: PageOutcome | null): string | null {
  const original = websiteOrigin(record.websiteUrl);
  const fetched = websiteOrigin(outcome?.pageUrl ?? null);
  if (
    original?.startsWith("http://") &&
    fetched?.startsWith("https://") &&
    siteKey(original) === siteKey(fetched)
  ) return fetched;
  return original ?? fetched ?? websiteOrigin(outcome?.target.url ?? null);
}

function evidenceUrl(record: AuditRecord, outcome: PageOutcome | null): string | null {
  const saved = record.websiteEvidenceUrl;
  const fetched = outcome?.pageUrl ?? null;
  if (saved?.startsWith("https://")) return saved;
  if (
    fetched?.startsWith("https://") &&
    (!saved || siteKey(saved) === siteKey(fetched))
  ) return fetched;
  return saved ?? fetched;
}

function outcomeRank(outcome: PageOutcome): number {
  return (outcome.fetched ? 4 : 0) +
    (outcome.identityVerified ? 2 : 0) +
    (outcome.websiteConfidence === "high" ? 1 : 0);
}

function matchingOutcome(
  record: AuditRecord,
  outcomes: PageOutcome[],
): PageOutcome | null {
  const candidateUrl = websiteOrigin(record.websiteUrl);
  const key = siteKey(candidateUrl);
  if (!key) return null;
  const matches = outcomes
    .filter((outcome) =>
      orgKey(outcome.target.organisationName) === orgKey(record.organisationName) &&
      siteKey(outcome.target.url) === key,
    )
    .sort((a, b) => outcomeRank(b) - outcomeRank(a));
  return matches[0] ?? null;
}

function matchingCandidate(
  record: AuditRecord,
  outcome: PageOutcome | null,
): AuditCandidate | null {
  const urls = [outcome?.target.url ?? null, record.websiteEvidenceUrl, record.websiteUrl];
  const keys = new Set(urls.map(siteKey).filter((key): key is string => Boolean(key)));
  const matches = record.candidateResults
    .filter((candidate) => keys.has(siteKey(candidate.url) ?? ""))
    .sort((a, b) => {
      const rank = (candidate: AuditCandidate) =>
        (candidate.confidence === "high" ? 3 : candidate.confidence === "medium" ? 2 : 1) +
        (candidate.sourceType === "official_site" ? 1 : 0);
      return rank(b) - rank(a);
    });
  return matches[0] ?? null;
}

function countDecisions(rows: ClassificationRow[]): Record<Decision, number> {
  return {
    auto_promote: rows.filter((row) => row.promotion_decision === "auto_promote").length,
    review_required: rows.filter((row) => row.promotion_decision === "review_required").length,
    reject: rows.filter((row) => row.promotion_decision === "reject").length,
  };
}

function asCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) ? value.join("; ") : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function toCsv(rows: ClassificationRow[]): string {
  const columns = [
    "run_id",
    "organisation_name",
    "sample_group",
    "sector",
    "original_confidence",
    "promotion_decision",
    "candidate_website",
    "candidate_source_type",
    "sponsor_licence_id",
    "sponsor_licence_ids",
    "domain_match_score",
    "identity_match_evidence",
    "geography_check",
    "blocked_host_check",
    "existing_data_conflict_check",
    "decision_reason",
    "candidate_careers_url_if_any",
    "candidate_careers_confidence",
    "candidate_ats_provider_if_any",
    "candidate_ats_board_id_if_any",
    "candidate_ats_mapping_status_if_any",
    "audit_checked_at",
  ] as const;
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => asCsvCell(row[column])).join(",")),
  ].join("\n") + "\n";
}

function markdownTable(rows: string[][]): string {
  return [
    `| ${rows[0]!.join(" | ")} |`,
    `| ${rows[0]!.map(() => "---").join(" | ")} |`,
    ...rows.slice(1).map((row) => `| ${row.map((cell) => cell.replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`),
  ].join("\n");
}

function short(value: string | null | undefined, length = 220): string {
  if (!value) return "";
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function buildImportReport(input: {
  runId: string;
  segmentFilter: string | null;
  rows: ClassificationRow[];
  dryRun: boolean;
  importedWebsiteRows: number;
  skippedConcurrentConflicts: number;
  discoveryRuns: Array<{
    organisationName: string;
    status: string;
    completion: string | null;
    pagesFetched: number;
    adverts: number;
    inserted: number;
    updated: number;
    revived: number;
    repeatedInserted: number;
    careersUrl: string | null;
    atsProvider: string | null;
    diagnostics?: CompanySiteDiscoveryDiagnostics | null;
    error?: string;
  }>;
  siteChecks: Array<{
    organisation_name: string;
    careers_url: string | null;
    ats_provider: string | null;
    ats_mapping_status: string | null;
    last_error: string | null;
  }>;
}): string {
  const counts = countDecisions(input.rows);
  const highRows = input.rows.filter((row) => row.original_confidence === "high");
  const discoveries = input.discoveryRuns;
  const checked = discoveries.filter((row) => row.status === "checked");
  const complete = checked.filter((row) => row.completion === "complete");
  const partial = checked.filter((row) => row.completion?.startsWith("partial"));
  const failed = checked.filter((row) => row.completion === "failed");
  const careersFound = discoveries.filter((row) =>
    row.careersUrl || row.diagnostics?.careersPageFound,
  ).length;
  const atsDetected = discoveries.filter((row) =>
    row.atsProvider || (row.diagnostics?.atsLinksSeen.length ?? 0) > 0,
  ).length;
  const verifiedBoards = input.siteChecks.filter((row) => row.ats_mapping_status === "verified").length;
  const vacancyInserted = checked.reduce((sum, row) => sum + row.inserted, 0);
  const vacancyRepeatedInserted = checked.reduce((sum, row) => sum + row.repeatedInserted, 0);
  const repeatedBatches = checked.filter((row) => row.adverts > 0).length;
  const mode = input.dryRun ? "DRY RUN — no database writes or discovery were performed." : "Development-only apply run.";
  const results = discoveries.length
    ? markdownTable([
        ["Employer", "Check", "Pages", "Adverts", "Inserted", "Updated", "Repeat inserts", "Careers URL", "ATS"],
        ...discoveries.map((row) => [
          row.organisationName,
          row.completion ?? row.status,
          String(row.pagesFetched),
          String(row.adverts),
          String(row.inserted),
          String(row.updated + row.revived),
          String(row.repeatedInserted),
          row.careersUrl ?? "",
          row.atsProvider ?? "",
        ]),
      ])
    : "No approved discovery runs were executed.";
  const errors = discoveries.filter((row) =>
    row.error || row.status !== "checked" || row.completion !== "complete",
  );
  return `# Sponsor website promotion import report

- Audit run: \`${input.runId}\`
- Mode: **${mode}**
- Sample scope: ${input.segmentFilter ?? "all saved-audit records"}.
- Classification: ${input.rows.length} sampled employers; ${highRows.length} were originally high confidence.
- Decisions: ${counts.auto_promote} auto-promote, ${counts.review_required} review required, ${counts.reject} reject.
- Auto-promote rows: ${counts.auto_promote}.
- Website rows updated from blank in development: ${input.dryRun ? "not run" : input.importedWebsiteRows}.
- Concurrent website conflicts skipped: ${input.dryRun ? "not run" : input.skippedConcurrentConflicts}.
- Employer-site discovery runs: ${input.dryRun ? "not run" : discoveries.length}; completed successfully: ${input.dryRun ? "not run" : complete.length}; partial: ${input.dryRun ? "not run" : partial.length}; failed: ${input.dryRun ? "not run" : failed.length}.
- Careers URLs found or confirmed during discovery: ${input.dryRun ? "not run" : careersFound}.
- ATS providers detected during discovery: ${input.dryRun ? "not run" : atsDetected}; verified ATS mappings after discovery: ${input.dryRun ? "not run" : verifiedBoards}.
- New vacancies inserted: ${input.dryRun ? "not run" : vacancyInserted}.
- Repeat-import verification: ${input.dryRun ? "not run" : repeatedBatches > 0 ? `${repeatedBatches} non-empty vacancy batch(es) repeated; ${vacancyRepeatedInserted} duplicate inserts` : "not applicable — no vacancies were extracted; duplicate-insert count is 0"}.

## Guardrails applied

- Only \`auto_promote\` records were eligible for a website update and targeted discovery.
- \`sponsor_licences.website\` was updated only when blank; no existing website was overwritten.
- Existing careers URLs and verified ATS mappings were preserved during targeted discovery.
- Direct ATS feeds were only used through the existing verified-mapping discovery path.
- Review/reject records were not imported or crawled. No production data was read or written, and nothing was deployed.
- The existing website-enrichment audit remains the source for original confidence and protected-page evidence; the CSV/JSON classification files retain the decision and its evidence.

## Per-employer discovery

${results}

${discoveries.length ? `## Per-employer site diagnosis

${markdownTable([
  ["Employer", "Homepage", "Careers evidence", "Robots / sitemap", "ATS evidence", "Vacancy signals", "Rejected careers links"],
  ...discoveries.map((row) => {
    const diagnostics = row.diagnostics;
    if (!diagnostics) return [row.organisationName, "diagnostics unavailable", "", "", "", "", ""];
    const careers = diagnostics.careersPageFound
      ? diagnostics.careersUrl
        ? `${short(diagnostics.careersUrl, 100)} (${diagnostics.careersHttpStatus ?? "not fetched"}${diagnostics.careersFailureKind ? ` / ${diagnostics.careersFailureKind}` : ""})`
        : "found, URL unavailable"
      : diagnostics.careersUrl
        ? `stored candidate not confirmed: ${short(diagnostics.careersUrl, 100)}`
        : "not found";
    const ats = diagnostics.atsLinksSeen
      .map((entry) => `${entry.provider}: ${entry.followed ? "followed" : entry.reason ?? "not followed"}`)
      .join("; ") || "none detected";
    const signals = [
      diagnostics.jsonLdJobPostingFound ? "JSON-LD JobPosting" : null,
      diagnostics.microdataJobPostingFound ? "microdata JobPosting" : null,
      diagnostics.explicitNoVacancies ? "explicit no-vacancy message" : null,
      diagnostics.jsRenderedJobsLikely ? "JavaScript-rendered jobs likely" : null,
      diagnostics.vacancyLikePages.length ? `${diagnostics.vacancyLikePages.length} vacancy-like page(s)` : null,
    ].filter(Boolean).join("; ") || "no structured vacancy evidence";
    const rejected = diagnostics.rejectedCareersLinks
      .slice(0, 3)
      .map((entry) => `${short(entry.text || entry.url, 70)} — ${entry.reason ?? "rejected"}`)
      .join("; ") || "none";
    return [
      row.organisationName,
      `${diagnostics.homepageFetched ? "fetched" : "not fetched"} (${diagnostics.homepageHttpStatus ?? "no HTTP status"})`,
      careers,
      `${diagnostics.robotsResult}; ${diagnostics.sitemapChecked ? `${diagnostics.sitemapDocuments.length} sitemap document(s)` : "sitemap not checked"}`,
      ats,
      signals,
      rejected,
    ];
  }),
])}

Full fetch/link/ATS diagnostics are included in the classification JSON output.
` : ""}

${errors.length ? `\n## Failed or partial discovery attempts\n\n${errors.map((row) => {
    const storedError = input.siteChecks.find(
      (check) => orgKey(check.organisation_name) === orgKey(row.organisationName),
    )?.last_error;
    return `- **${row.organisationName} (${row.completion ?? row.status}):** ${short(row.error ?? storedError ?? "No stored failure detail.", 500)}`;
  }).join("\n")}\n` : ""}
`;
}

function buildVacancyReport(input: {
  runId: string;
  segmentFilter: string | null;
  dryRun: boolean;
  discoveryRuns: Array<{
    organisationName: string;
    status: string;
    completion: string | null;
    pagesFetched: number;
    adverts: number;
    inserted: number;
    updated: number;
    revived: number;
    careersUrl: string | null;
    atsProvider: string | null;
    diagnostics?: CompanySiteDiscoveryDiagnostics | null;
  }>;
  verificationRows: Array<{
    id: number;
    organisationName: string;
    title: string;
    detailUrl: string;
    applicationUrl: string;
    liveness: string;
    lastVerifiedAt: string | null;
    verificationOutcome: string;
  }>;
}): string {
  const rows = input.verificationRows;
  const live = rows.filter((row) => row.liveness === "live").length;
  const dead = rows.filter((row) => row.liveness === "dead").length;
  const unverified = rows.filter((row) => !["live", "dead"].includes(row.liveness)).length;
  const sampleRows = rows.slice(0, 30);
  const completeRuns = input.discoveryRuns.filter((row) => row.completion === "complete").length;
  const partialRuns = input.discoveryRuns.filter((row) => row.completion?.startsWith("partial")).length;
  const failedRuns = input.discoveryRuns.filter((row) => row.completion === "failed").length;
  const table = sampleRows.length
    ? markdownTable([
        ["ID", "Employer", "Vacancy", "Detail URL", "Application URL", "Liveness", "Last verified"],
        ...sampleRows.map((row) => [
          String(row.id),
          row.organisationName,
          short(row.title, 80),
          row.detailUrl,
          row.applicationUrl,
          row.liveness,
          row.lastVerifiedAt ?? "",
        ]),
      ])
    : "No company-site vacancy rows were touched by the targeted discovery run.";
  const checks = input.discoveryRuns.length
    ? markdownTable([
        ["Employer", "Discovery", "Pages fetched", "Adverts extracted", "New", "Updated/revived", "Careers", "ATS"],
        ...input.discoveryRuns.map((row) => [
          row.organisationName,
          row.completion ?? row.status,
          String(row.pagesFetched),
          String(row.adverts),
          String(row.inserted),
          String(row.updated + row.revived),
          row.careersUrl ?? "",
          row.atsProvider ?? "",
        ]),
      ])
    : "No approved discovery runs were executed.";
  return `# Sponsor website vacancy discovery results

- Audit run: \`${input.runId}\`
- Mode: **${input.dryRun ? "dry run; no vacancy discovery was executed" : "development-only targeted run"}**.
- Sample scope: ${input.segmentFilter ?? "all saved-audit records"}.
- Approved employers checked: ${input.dryRun ? "not run" : input.discoveryRuns.length}; complete: ${input.dryRun ? "not run" : completeRuns}; partial: ${input.dryRun ? "not run" : partialRuns}; failed: ${input.dryRun ? "not run" : failedRuns}.
- Company-site vacancy rows checked for liveness: ${input.dryRun ? "not run" : rows.length}.
- Live: ${input.dryRun ? "not run" : live}; dead: ${input.dryRun ? "not run" : dead}; inconclusive or otherwise unverified: ${input.dryRun ? "not run" : unverified}.
- The liveness checks used each stored application URL when present, otherwise its detail URL. No broad scheduler or global liveness sweep was run.
- Candidate-facing visibility was not asserted from liveness alone; it also depends on the app's current vacancy gates and candidate-specific filters.

## Targeted discovery

${checks}

## Detail and application URL verification

${rows.length > sampleRows.length ? `Showing ${sampleRows.length} of ${rows.length} checked vacancy rows.` : ""}

${table}

${rows.some((row) => row.verificationOutcome !== row.liveness)
    ? `\nVerifier outcomes: ${rows.filter((row) => row.verificationOutcome !== row.liveness).map((row) => `#${row.id}: ${row.verificationOutcome} (stored ${row.liveness})`).join("; ")}\n`
    : ""}
`;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await handler(items[index]!);
    }
  }));
  return results;
}

async function main(): Promise<void> {
  assertDevelopmentOnly();
  const apply = process.argv.includes("--apply-dev");
  const healthcareOnly = process.argv.includes("--healthcare");
  const approved26 = process.argv.includes("--approved-26");
  if (healthcareOnly && approved26) {
    throw new Error("Choose either --healthcare or --approved-26; their sample scopes cannot be combined.");
  }
  const segmentFilter = approved26
    ? "previously_auto_promote_26_mixed_sectors"
    : healthcareOnly ? "healthcare_social_care" : null;
  const paths = outputPaths(healthcareOnly, approved26);
  const audit = JSON.parse(await readFile(SAMPLE_PATH, "utf8")) as AuditSnapshot;
  if (!audit.runId || !Array.isArray(audit.records) || !Array.isArray(audit.pageOutcomes)) {
    throw new Error("Saved website audit is missing the required runId, records, or pageOutcomes.");
  }
  let priorApprovedNames: Set<string> | null = null;
  if (approved26) {
    const previous = JSON.parse(await readFile(PRIOR_APPROVED_CLASSIFICATION_PATH, "utf8")) as {
      records?: Array<{ organisation_name?: string; promotion_decision?: string }>;
    };
    const previousAuto = (previous.records ?? [])
      .filter((record) => record.promotion_decision === "auto_promote")
      .map((record) => record.organisation_name?.trim() ?? "")
      .filter(Boolean);
    priorApprovedNames = new Set(previousAuto.map(orgKey));
    if (priorApprovedNames.size !== 26 || previousAuto.length !== 26) {
      throw new Error(
        `Expected exactly 26 unique previously auto-approved employers; found ${previousAuto.length} rows and ${priorApprovedNames.size} unique names.`,
      );
    }
  }
  const sampleRecords = approved26
    ? audit.records.filter((record) => priorApprovedNames!.has(orgKey(record.organisationName)))
    : healthcareOnly
      ? audit.records.filter((record) => record.sector === "healthcare_social_care")
      : audit.records;
  if (sampleRecords.length === 0) {
    throw new Error(`Saved website audit contains no employers in sector ${segmentFilter}.`);
  }
  if (approved26) {
    const sampledNames = new Set(sampleRecords.map((record) => orgKey(record.organisationName)));
    const missing = [...priorApprovedNames!].filter((name) => !sampledNames.has(name));
    if (sampledNames.size !== 26 || missing.length > 0 || sampleRecords.length !== 26) {
      throw new Error(
        `Approved-26 scope does not match the saved audit exactly (records=${sampleRecords.length}, unique=${sampledNames.size}, missing=${missing.length}).`,
      );
    }
  }
  const organisationNames = [...new Set(sampleRecords.map((record) => orgKey(record.organisationName)))];
  const currentResult = await db.execute<SponsorDbRow>(sql`
    SELECT
      sl.id,
      sl.organisation_name,
      sl.website,
      sl.town_city,
      sl.industry,
      cs.careers_url,
      cs.ats_provider,
      cs.ats_board_id,
      cs.ats_mapping_status,
      cs.ats_mapping_evidence_url,
      cs.generic_checked_at,
      cs.ats_checked_at
    FROM sponsor_licences sl
    LEFT JOIN sponsor_licence_company_site_checks cs
      ON cs.organisation_name = sl.organisation_name
    WHERE lower(btrim(sl.organisation_name)) = ANY(${sql.param(organisationNames)}::text[])
    ORDER BY sl.id
  `);
  const currentRows = currentResult.rows;
  const byOrg = new Map<string, SponsorDbRow[]>();
  for (const row of currentRows) {
    const key = orgKey(row.organisation_name);
    const group = byOrg.get(key) ?? [];
    group.push(row);
    byOrg.set(key, group);
  }

  const classificationRows: ClassificationRow[] = sampleRecords.map((record) => {
    const matchingRows = byOrg.get(orgKey(record.organisationName)) ?? [];
    const ids = matchingRows.map((row) => Number(row.id)).sort((a, b) => a - b);
    const outcome = matchingOutcome(record, audit.pageOutcomes);
    const candidate = matchingCandidate(record, outcome);
    const candidateWebsite = approvedWebsiteUrl(record, outcome);
    const sourceType = outcome?.target.sourceType ?? candidate?.sourceType ?? null;
    const existingWebsiteUrls = matchingRows
      .map((row) => row.website?.trim() ?? "")
      .filter(Boolean);
    const existingCareersUrls = matchingRows
      .map((row) => row.careers_url?.trim() ?? "")
      .filter(Boolean);
    const existingStatuses = matchingRows.map((row) => row.ats_mapping_status);
    const atsLeadUnverified =
      Boolean(record.atsProvider && record.atsMappingStatus !== "verified") ||
      matchingRows.some((row) => Boolean(row.ats_provider && row.ats_mapping_status !== "verified"));
    const classification = classifySponsorWebsitePromotion({
      organisationName: record.organisationName,
      townCity: record.townCity,
      candidateWebsite,
      evidenceUrl: evidenceUrl(record, outcome),
      originalConfidence: record.websiteConfidence,
      sourceType,
      fetched: outcome?.fetched === true,
      pageUrl: outcome?.pageUrl ?? null,
      pageTitle: outcome?.pageTitle ?? null,
      pageExcerpt: outcome?.excerpt ?? null,
      candidateSnippet: candidate?.snippet ?? null,
      identityVerified: outcome?.identityVerified === true,
      geographyMismatch: outcome?.geographyMismatch === true,
      existingWebsiteUrls,
      existingCareersUrls,
      existingAtsMappingStatuses: existingStatuses,
      atsLeadUnverified,
      sponsorLicenceIds: ids,
    });
    return {
      run_id: record.runId,
      organisation_name: record.organisationName,
      sample_group: record.sampleGroup,
      sector: record.sector,
      original_confidence: record.websiteConfidence,
      promotion_decision: classification.promotionDecision,
      candidate_website: candidateWebsite,
      candidate_source_type: sourceType,
      sponsor_licence_id: ids[0] ?? null,
      sponsor_licence_ids: ids,
      domain_match_score: classification.domainMatchScore,
      identity_match_evidence: classification.identityMatchEvidence,
      geography_check: classification.geographyCheck,
      blocked_host_check: classification.blockedHostCheck,
      existing_data_conflict_check: classification.existingDataConflictCheck,
      decision_reason: classification.decisionReason,
      candidate_careers_url_if_any: record.careersUrl,
      candidate_careers_confidence: record.careersConfidence,
      candidate_ats_provider_if_any: record.atsProvider,
      candidate_ats_board_id_if_any: record.atsBoardId,
      candidate_ats_mapping_status_if_any: record.atsMappingStatus,
      audit_checked_at: record.checkedAt,
    };
  });
  const decisionCounts = countDecisions(classificationRows);
  if (approved26 && apply && decisionCounts.auto_promote !== 26) {
    throw new Error(
      `Refusing the approved-26 apply: current safety classification permits ${decisionCounts.auto_promote} of the 26 previously approved employers.`,
    );
  }
  let execution: Record<string, unknown> = {
    status: "dry_run",
    importedWebsiteRows: 0,
    skippedConcurrentConflicts: 0,
    discoveryRuns: [],
    verificationRows: [],
  };
  let discoveryRuns: Array<{
    organisationName: string;
    status: string;
    completion: string | null;
    pagesFetched: number;
    adverts: number;
    inserted: number;
    updated: number;
    revived: number;
    repeatedInserted: number;
    careersUrl: string | null;
    atsProvider: string | null;
    diagnostics?: CompanySiteDiscoveryDiagnostics | null;
    error?: string;
  }> = [];
  let siteChecks: Array<{
    organisation_name: string;
    careers_url: string | null;
    ats_provider: string | null;
    ats_mapping_status: string | null;
    last_error: string | null;
  }> = [];
  let importedWebsiteRows = 0;
  let skippedConcurrentConflicts = 0;
  let verificationRows: Array<{
    id: number;
    organisationName: string;
    title: string;
    detailUrl: string;
    applicationUrl: string;
    liveness: string;
    lastVerifiedAt: string | null;
    verificationOutcome: string;
  }> = [];

  if (apply) {
    if (process.env.NODE_ENV !== "development") {
      throw new Error("Refusing apply: NODE_ENV is not development.");
    }
    const approved = classificationRows.filter(
      (row) => row.promotion_decision === "auto_promote" && row.candidate_website,
    );
    await db.transaction(async (tx) => {
      for (const item of approved) {
        const ids = item.sponsor_licence_ids;
        if (ids.length === 0) continue;
        const changed = await tx.execute<{ id: number | string }>(sql`
          UPDATE sponsor_licences
          SET website = ${item.candidate_website}
          WHERE id = ANY(${sql.param(ids)}::int[])
            AND NULLIF(btrim(website), '') IS NULL
          RETURNING id
        `);
        importedWebsiteRows += changed.rows.length;
      }
    });

    const approvedNames = approved.map((row) => orgKey(row.organisation_name));
    const freshRows = await db.execute<SponsorDbRow>(sql`
      SELECT
        sl.id,
        sl.organisation_name,
        sl.website,
        sl.town_city,
        sl.industry,
        cs.careers_url,
        cs.ats_provider,
        cs.ats_board_id,
        cs.ats_mapping_status,
        cs.ats_mapping_evidence_url,
        cs.generic_checked_at,
        cs.ats_checked_at
      FROM sponsor_licences sl
      LEFT JOIN sponsor_licence_company_site_checks cs
        ON cs.organisation_name = sl.organisation_name
      WHERE lower(btrim(sl.organisation_name)) = ANY(${sql.param(approvedNames)}::text[])
      ORDER BY sl.id
    `);
    const freshByOrg = new Map<string, SponsorDbRow[]>();
    for (const row of freshRows.rows) {
      const group = freshByOrg.get(orgKey(row.organisation_name)) ?? [];
      group.push(row);
      freshByOrg.set(orgKey(row.organisation_name), group);
    }
    const safeApproved = approved.filter((item) => {
      const current = freshByOrg.get(orgKey(item.organisation_name)) ?? [];
      const candidateKey = siteKey(item.candidate_website);
      const conflicting = current.some((row) => {
        const existing = row.website?.trim();
        return Boolean(existing && siteKey(existing) !== candidateKey);
      });
      if (conflicting) skippedConcurrentConflicts += 1;
      return !conflicting && current.length > 0;
    });

    const discoveryStartedAt = new Date(Date.now() - 2_000);
    discoveryRuns = await mapWithConcurrency(safeApproved, 3, async (item) => {
      const rows = freshByOrg.get(orgKey(item.organisation_name)) ?? [];
      const primary = rows[0];
      if (!primary || !item.candidate_website) {
        return {
          organisationName: item.organisation_name,
          status: "skipped",
          completion: null,
          pagesFetched: 0,
          adverts: 0,
          inserted: 0,
          updated: 0,
          revived: 0,
          repeatedInserted: 0,
          careersUrl: null,
          atsProvider: null,
          error: "matching development sponsor row or approved website is missing",
        };
      }
      try {
        const outcome = await runCompanySiteCheck({
          organisationName: primary.organisation_name,
          website: item.candidate_website,
          genericCheckedAt: null,
          atsCheckedAt: null,
          careersUrl: primary.careers_url,
          atsMappingEvidenceUrl: primary.ats_mapping_evidence_url ?? null,
          atsProvider: primary.ats_provider,
          atsMappingStatus: primary.ats_mapping_status ?? "unverified",
          crawlState: null,
        }, {
          deadlineMs: Date.now() + 60_000,
          acquireLease: true,
          preserveExistingSiteMetadata: true,
          queueVerifications: false,
          verifyImportIdempotency: true,
        });
        if (outcome.status === "skipped") {
          return {
            organisationName: item.organisation_name,
            status: "skipped",
            completion: null,
            pagesFetched: 0,
            adverts: 0,
            inserted: 0,
            updated: 0,
            revived: 0,
            repeatedInserted: 0,
            careersUrl: null,
            atsProvider: null,
            error: outcome.reason,
          };
        }
        return {
          organisationName: item.organisation_name,
          status: "checked",
          completion: outcome.completion,
          pagesFetched: outcome.pagesFetched,
          adverts: outcome.adverts,
          inserted: outcome.inserted,
          updated: outcome.updated,
          revived: outcome.revived,
          repeatedInserted: outcome.repeatImport?.inserted ?? 0,
          careersUrl: outcome.careersUrl,
          atsProvider: outcome.atsProvider,
          diagnostics: outcome.diagnostics ?? null,
          ...(outcome.repeatImport?.inserted
            ? { error: `repeat import inserted ${outcome.repeatImport.inserted} duplicate row(s)` }
            : {}),
        };
      } catch (error) {
        return {
          organisationName: item.organisation_name,
          status: "error",
          completion: null,
          pagesFetched: 0,
          adverts: 0,
          inserted: 0,
          updated: 0,
          revived: 0,
          repeatedInserted: 0,
          careersUrl: null,
          atsProvider: null,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    const siteCheckResult = await db.execute<{
      organisation_name: string;
      careers_url: string | null;
      ats_provider: string | null;
      ats_mapping_status: string | null;
      last_error: string | null;
    }>(sql`
      SELECT organisation_name, careers_url, ats_provider, ats_mapping_status, last_error
      FROM sponsor_licence_company_site_checks
      WHERE lower(btrim(organisation_name)) = ANY(${sql.param(approvedNames)}::text[])
      ORDER BY lower(btrim(organisation_name))
    `);
    siteChecks = siteCheckResult.rows;
    const errorByOrg = new Map(
      siteChecks.map((row) => [orgKey(row.organisation_name), row.last_error]),
    );
    discoveryRuns = discoveryRuns.map((row) =>
      row.completion !== "complete" && !row.error
        ? {
            ...row,
            error: errorByOrg.get(orgKey(row.organisationName)) ?? `discovery ${row.completion ?? row.status}`,
          }
        : row,
    );

    const affectedResult = await db.execute<DiscoveryRow>(sql`
      SELECT
        id,
        organisation_name,
        title,
        url,
        application_url,
        source_type,
        last_discovered_at,
        liveness,
        last_verified_at,
        closes_at
      FROM sponsor_licence_vacancies
      WHERE source_type = 'company_site'
        AND lower(btrim(organisation_name)) = ANY(${sql.param(approvedNames)}::text[])
        AND last_discovered_at >= ${discoveryStartedAt}
      ORDER BY lower(btrim(organisation_name)), id
    `);
    const affectedRows = affectedResult.rows;
    const outcomes = new Map<number, string>();
    for (const row of affectedRows) {
      const id = Number(row.id);
      const effectiveUrl = row.application_url?.trim() || row.url;
      try {
        outcomes.set(id, await verifyCompanySiteStoredLink(id, effectiveUrl));
      } catch (error) {
        outcomes.set(id, `error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const finalVacancies = await db.execute<DiscoveryRow>(sql`
      SELECT
        id,
        organisation_name,
        title,
        url,
        application_url,
        source_type,
        last_discovered_at,
        liveness,
        last_verified_at,
        closes_at
      FROM sponsor_licence_vacancies
      WHERE id = ANY(${sql.param(affectedRows.map((row) => Number(row.id)))}::int[])
      ORDER BY lower(btrim(organisation_name)), id
    `);
    verificationRows = finalVacancies.rows.map((row) => ({
      id: Number(row.id),
      organisationName: row.organisation_name,
      title: row.title,
      detailUrl: row.url,
      applicationUrl: row.application_url?.trim() || row.url,
      liveness: row.liveness,
      lastVerifiedAt: row.last_verified_at ? new Date(row.last_verified_at).toISOString() : null,
      verificationOutcome: outcomes.get(Number(row.id)) ?? "not checked",
    }));
    execution = {
      status: "applied_development_only",
      importedWebsiteRows,
      skippedConcurrentConflicts,
      discoveryStartedAt: discoveryStartedAt.toISOString(),
      discoveryRuns,
      siteChecks,
      verificationRows,
    };
  }

  const reportInput = {
    runId: audit.runId,
    segmentFilter,
    rows: classificationRows,
    dryRun: !apply,
    importedWebsiteRows,
    skippedConcurrentConflicts,
    discoveryRuns,
    siteChecks,
  };
  await mkdir(paths.outputDir, { recursive: true });
  await writeFile(paths.classificationCsv, toCsv(classificationRows), "utf8");
  await writeFile(paths.classificationJson, JSON.stringify({
    runId: audit.runId,
    classifiedAt: new Date().toISOString(),
    sourceFile: path.relative(REPO_ROOT, SAMPLE_PATH),
    segmentFilter,
    sampleCount: classificationRows.length,
    summary: {
      decisions: decisionCounts,
      originalHighConfidenceCount: classificationRows.filter((row) => row.original_confidence === "high").length,
    },
    execution,
    records: classificationRows,
  }, null, 2) + "\n", "utf8");
  await writeFile(paths.importReport, buildImportReport(reportInput), "utf8");
  await writeFile(paths.vacancyReport, buildVacancyReport({
    runId: audit.runId,
    segmentFilter,
    dryRun: !apply,
    discoveryRuns,
    verificationRows,
  }), "utf8");
  console.log(JSON.stringify({
    runId: audit.runId,
    segmentFilter,
    mode: apply ? "development apply" : "dry run",
    sampleCount: classificationRows.length,
    originalHighConfidenceCount: classificationRows.filter((row) => row.original_confidence === "high").length,
    decisions: decisionCounts,
    autoPromote: classificationRows
      .filter((row) => row.promotion_decision === "auto_promote")
      .map((row) => ({
        organisationName: row.organisation_name,
        website: row.candidate_website,
        ids: row.sponsor_licence_ids,
        domainMatchScore: row.domain_match_score,
      })),
    execution: {
      importedWebsiteRows,
      skippedConcurrentConflicts,
      discoveryRuns: discoveryRuns.length,
      discoveryErrors: discoveryRuns.filter((row) =>
        row.error || row.status !== "checked" || row.completion !== "complete",
      ).length,
      insertedVacancies: discoveryRuns.reduce((sum, row) => sum + row.inserted, 0),
      repeatImportInserted: discoveryRuns.reduce((sum, row) => sum + row.repeatedInserted, 0),
      verifiedLive: verificationRows.filter((row) => row.liveness === "live").length,
      verifiedDead: verificationRows.filter((row) => row.liveness === "dead").length,
      verificationRows: verificationRows.length,
    },
    files: [
      path.relative(REPO_ROOT, paths.classificationCsv),
      path.relative(REPO_ROOT, paths.classificationJson),
      path.relative(REPO_ROOT, paths.importReport),
      path.relative(REPO_ROOT, paths.vacancyReport),
    ],
  }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
} finally {
  await pool.end();
}