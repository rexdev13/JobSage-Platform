import { access, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseCsvObjects, stringifyCsv } from "./sponsor-contact-discovery/csv";
import {
  PublicSiteFetcher,
  type PageResult,
  type PublicSiteFetcherMetrics,
} from "./sponsor-contact-discovery/http";
import {
  assessLiveWebsiteIdentity,
  extractLinkedVerificationPages,
  isBlockedOrTimeoutError,
  hasTimeoutSignalInNotes,
  isTimeoutError,
  normalizedOrganisationName,
  normalizedWebsiteHost,
  type VerificationPage,
  type VerificationPageKind,
} from "./nonHealthcareWebsiteLiveVerificationLogic";

const REPO_ROOT = resolve(dirnameFromFile(import.meta.url), "../..");
const INPUT_PATH =
  "artifacts/non-healthcare-company-websites-verification-pilot-100.csv";
const OUTPUT_PATH =
  "artifacts/non-healthcare-company-websites-live-verification-pilot-100.csv";
const REPORT_PATH =
  "artifacts/non-healthcare-company-websites-live-verification-pilot-100-report.md";
const REQUIRED_INPUT_COLUMNS = [
  "sponsor_licence_id",
  "organisation_name",
  "industry",
  "town_city",
  "county",
  "region",
  "current_confidence",
  "candidate_site_root",
  "candidate_domain",
  "contact_email_domain",
  "contact_email_domain_match",
  "existing_website_careers_source_match",
  "selection_group",
] as const;
const MAX_PAGES_PER_DOMAIN = 5;
const HOST_DELAY_MS = 1_500;

const OUTPUT_COLUMNS = [
  "sponsor_licence_id",
  "organisation_name",
  "normalized_organisation_name",
  "town_city",
  "county",
  "region",
  "industry",
  "original_confidence",
  "candidate_url",
  "candidate_domain",
  "verification_status",
  "new_confidence",
  "evidence_url_1",
  "evidence_url_2",
  "evidence_url_3",
  "pages_checked",
  "signals_matched",
  "conflicts_found",
  "reason",
  "notes",
] as const;

type SourceRow = Record<string, string>;
type OutputRow = Record<(typeof OUTPUT_COLUMNS)[number], string>;
type CachedFetch = { page: PageResult | null; error: string };

type Attempt = {
  url: string;
  kind: VerificationPageKind;
  page: PageResult | null;
  error: string;
  cacheHit: boolean;
};

type RunMetrics = PublicSiteFetcherMetrics & {
  pageCacheHits: number;
  domainsChecked: Set<string>;
  pagesAttempted: number;
  pagesChecked: number;
};

function dirnameFromFile(url: string): string {
  return resolve(new URL(".", url).pathname);
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function csvEscapeNote(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();
}

function canonicalUrl(value: string): string {
  const parsed = new URL(value);
  parsed.hash = "";
  parsed.search = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString();
}

function safeHttpsUrl(value: string): string {
  try {
    const parsed = new URL(clean(value));
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      !parsed.hostname.includes(".") ||
      parsed.hostname.includes("%") ||
      parsed.hostname.toLowerCase() === "localhost"
    ) {
      return "";
    }
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function validateInput(rows: readonly SourceRow[]): void {
  if (rows.length !== 100) {
    throw new Error(`Expected exactly 100 selected pilot rows; found ${rows.length}`);
  }
  for (const column of REQUIRED_INPUT_COLUMNS) {
    if (!Object.hasOwn(rows[0]!, column)) {
      throw new Error(`Pilot CSV is missing required column: ${column}`);
    }
  }

  const ids = new Set<string>();
  const domains = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const sponsorId = clean(row.sponsor_licence_id);
    const candidateUrl = safeHttpsUrl(row.candidate_site_root);
    const candidateHost = normalizedWebsiteHost(candidateUrl);
    const recordedHost = normalizedWebsiteHost(row.candidate_domain ?? "");
    if (!sponsorId || ids.has(sponsorId)) {
      throw new Error(`Pilot row ${index + 2} has a missing or duplicate sponsor ID`);
    }
    if (
      !candidateUrl ||
      !candidateHost ||
      candidateHost !== recordedHost ||
      domains.has(candidateHost)
    ) {
      throw new Error(`Pilot row ${index + 2} has an invalid or duplicate candidate domain`);
    }
    if (
      clean(row.current_confidence).toLowerCase() !== "medium" ||
      clean(row.selection_group) !== "strong_medium" ||
      clean(row.contact_email_domain_match).toLowerCase() !== "true" ||
      clean(row.existing_website_careers_source_match).toLowerCase() !== "true"
    ) {
      throw new Error(
        `Pilot row ${index + 2} does not meet the selected strong-medium criteria`,
      );
    }
    ids.add(sponsorId);
    domains.add(candidateHost);
  }
}

function emptyOutput(row: SourceRow, reason: string, conflict = ""): OutputRow {
  const candidateUrl = safeHttpsUrl(row.candidate_site_root);
  const candidateDomain = normalizedWebsiteHost(candidateUrl);
  return {
    sponsor_licence_id: clean(row.sponsor_licence_id),
    organisation_name: clean(row.organisation_name),
    normalized_organisation_name: normalizedOrganisationName(
      clean(row.organisation_name),
    ),
    town_city: clean(row.town_city),
    county: clean(row.county),
    region: clean(row.region),
    industry: clean(row.industry),
    original_confidence: clean(row.current_confidence),
    candidate_url: candidateUrl,
    candidate_domain: candidateDomain,
    verification_status: "inconclusive",
    new_confidence: clean(row.current_confidence),
    evidence_url_1: "",
    evidence_url_2: "",
    evidence_url_3: "",
    pages_checked: "0",
    signals_matched: "",
    conflicts_found: conflict,
    reason,
    notes: "",
  };
}

async function fetchPage(
  url: string,
  kind: VerificationPageKind,
  candidateDomain: string,
  fetcher: PublicSiteFetcher,
  pageCache: Map<string, CachedFetch>,
  metrics: RunMetrics,
  attempts: Attempt[],
): Promise<PageResult | null> {
  const key = canonicalUrl(url);
  const cached = pageCache.get(key);
  if (cached) {
    metrics.pageCacheHits += 1;
    attempts.push({
      url,
      kind,
      page: cached.page,
      error: cached.error,
      cacheHit: true,
    });
    if (cached.page) metrics.pagesChecked += 1;
    return cached.page;
  }
  if (attempts.length >= MAX_PAGES_PER_DOMAIN) {
    attempts.push({
      url,
      kind,
      page: null,
      error: "per-domain page limit reached",
      cacheHit: false,
    });
    return null;
  }

  metrics.pagesAttempted += 1;
  metrics.domainsChecked.add(candidateDomain);
  try {
    const page = await fetcher.fetch(url, candidateDomain);
    const finalHost = normalizedWebsiteHost(page.url);
    if (!finalHost || !sameSiteHost(finalHost, candidateDomain)) {
      throw new Error("fetch result ended outside the candidate's same-site boundary");
    }
    pageCache.set(key, { page, error: "" });
    attempts.push({ url, kind, page, error: "", cacheHit: false });
    metrics.pagesChecked += 1;
    return page;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    pageCache.set(key, { page: null, error: message });
    attempts.push({ url, kind, page: null, error: message, cacheHit: false });
    return null;
  }
}

function sameSiteHost(host: string, candidateDomain: string): boolean {
  const normalizedHost = normalizedWebsiteHost(host);
  const base = normalizedWebsiteHost(candidateDomain);
  return Boolean(
    normalizedHost &&
      base &&
      (normalizedHost === base ||
        normalizedHost.endsWith(`.${base}`) ||
        base.endsWith(`.${normalizedHost}`)),
  );
}

function toOutputRow(
  row: SourceRow,
  successfulPages: readonly VerificationPage[],
  attempts: readonly Attempt[],
): OutputRow {
  const candidateUrl = safeHttpsUrl(row.candidate_site_root);
  const candidateDomain = normalizedWebsiteHost(row.candidate_domain ?? "");
  const assessment = assessLiveWebsiteIdentity(
    {
      organisation_name: clean(row.organisation_name),
      town_city: clean(row.town_city),
      county: clean(row.county),
      region: clean(row.region),
    },
    candidateDomain,
    clean(row.contact_email_domain),
    successfulPages,
  );
  const evidenceUrls = [
    ...new Set(successfulPages.map((entry) => entry.page.url)),
  ].slice(0, 3);
  const errors = attempts.filter((attempt) => attempt.error);
  const errorNotes = errors.map(
    (attempt) => `${attempt.kind} ${attempt.url}: ${attempt.error}`,
  );
  const attemptNotes = attempts.map(
    (attempt) =>
      `${attempt.kind} ${attempt.url}: ${attempt.page ? "fetched" : "not fetched"}${
        attempt.cacheHit ? " (page cache hit)" : ""
      }${attempt.error ? ` (${attempt.error})` : ""}`,
  );
  const noteParts = [
    ...assessment.pageAssessmentNotes,
    assessment.structuredOrganizationNames.length
      ? `structured organization names: ${assessment.structuredOrganizationNames.join(" | ")}`
      : "",
    assessment.pageEmailDomains.length
      ? `email domains found on pages: ${assessment.pageEmailDomains.join(", ")}`
      : "",
    `page attempts: ${attemptNotes.join(" || ") || "none"}`,
    errorNotes.length ? `fetch errors: ${errorNotes.join(" || ")}` : "",
    `blocked_or_timeout=${errors.filter((attempt) => isBlockedOrTimeoutError(attempt.error)).length}`,
    `timeout_errors=${errors.filter((attempt) => isTimeoutError(attempt.error)).length}`,
  ].filter(Boolean);
  let reason = assessment.reason;
  if (
    assessment.verificationStatus === "inconclusive" &&
    errors.some((attempt) => isBlockedOrTimeoutError(attempt.error))
  ) {
    reason = `Verification was inconclusive because a site request was blocked or timed out: ${
      errors.find((attempt) => isBlockedOrTimeoutError(attempt.error))!.error
    }`;
  }

  return {
    sponsor_licence_id: clean(row.sponsor_licence_id),
    organisation_name: clean(row.organisation_name),
    normalized_organisation_name: normalizedOrganisationName(
      clean(row.organisation_name),
    ),
    town_city: clean(row.town_city),
    county: clean(row.county),
    region: clean(row.region),
    industry: clean(row.industry),
    original_confidence: clean(row.current_confidence),
    candidate_url: candidateUrl,
    candidate_domain: candidateDomain,
    verification_status: assessment.verificationStatus,
    new_confidence: assessment.newConfidence,
    evidence_url_1: evidenceUrls[0] ?? "",
    evidence_url_2: evidenceUrls[1] ?? "",
    evidence_url_3: evidenceUrls[2] ?? "",
    pages_checked: String(successfulPages.length),
    signals_matched: assessment.signalsMatched.join(";"),
    conflicts_found: assessment.conflictsFound.join(";"),
    reason,
    notes: csvEscapeNote(noteParts.join(" || ")),
  };
}

async function processCandidate(
  row: SourceRow,
  fetcher: PublicSiteFetcher,
  pageCache: Map<string, CachedFetch>,
  metrics: RunMetrics,
): Promise<OutputRow> {
  const candidateUrl = safeHttpsUrl(row.candidate_site_root);
  const candidateDomain = normalizedWebsiteHost(row.candidate_domain ?? "");
  const attempts: Attempt[] = [];
  const successfulPages: VerificationPage[] = [];
  const homepage = await fetchPage(
    candidateUrl,
    "homepage",
    candidateDomain,
    fetcher,
    pageCache,
    metrics,
    attempts,
  );
  if (homepage) {
    successfulPages.push({ kind: "homepage", page: homepage });
    const linked = extractLinkedVerificationPages(homepage, candidateDomain);
    for (const link of linked) {
      if (attempts.length >= MAX_PAGES_PER_DOMAIN) break;
      const page = await fetchPage(
        link.url,
        link.kind,
        candidateDomain,
        fetcher,
        pageCache,
        metrics,
        attempts,
      );
      if (page) successfulPages.push({ kind: link.kind, page });
    }
  }
  return toOutputRow(row, successfulPages, attempts);
}

function displayExamples(
  rows: readonly OutputRow[],
  status: "upgraded" | "rejected",
): string {
  const examples = rows.filter((row) => row.verification_status === status).slice(0, 5);
  if (examples.length === 0) return "None in this pilot.";
  return examples
    .map((row) => {
      const evidence = [
        row.evidence_url_1,
        row.evidence_url_2,
        row.evidence_url_3,
      ]
        .filter(Boolean)
        .join(", ");
      return `- **${row.organisation_name}** (${row.candidate_domain}) — ${row.reason}${
        evidence ? ` Evidence: ${evidence}` : ""
      }`;
    })
    .join("\n");
}

function buildReport(
  rows: readonly OutputRow[],
  metrics: RunMetrics,
  inputPath: string,
  pageCacheHits: number,
  hadInterruptedCandidates: boolean,
): string {
  const counts = {
    upgraded: rows.filter((row) => row.verification_status === "upgraded").length,
    medium: rows.filter((row) => row.verification_status === "kept_medium").length,
    rejected: rows.filter((row) => row.verification_status === "rejected").length,
    inconclusive: rows.filter((row) => row.verification_status === "inconclusive").length,
  };
  const blockedRows = rows.filter((row) => {
    const explicitCount = row.notes.match(/\bblocked_or_timeout=(\d+)\b/);
    return Number(explicitCount?.[1] ?? 0) > 0;
  }).length;
  const timeoutRows = rows.filter((row) => hasTimeoutSignalInNotes(row.notes)).length;
  const pageCacheRows = pageCacheHits;
  const requestCountNote = hadInterruptedCandidates
    ? "Some candidates were already in progress when an earlier run stopped; the report marks them inconclusive and does not refetch them. Their in-flight request count may not be included."
    : "HTTP request count includes page requests, robots.txt requests, and each same-site redirect hop. No retries or search requests were made.";
  const statusRows = rows.map((row) => `| ${row.verification_status} | ${row.new_confidence} | ${row.sponsor_licence_id} |`).join("\n");

  return `# Live website verification — selected 100-candidate pilot

**Generated:** ${new Date().toISOString()}  
**Input:** \`${inputPath}\`

## Results

- Total processed: **${rows.length}**
- Domains checked: **${metrics.domainsChecked.size}**
- HTTP requests made: **${metrics.httpRequestsMade}**
- Cache hits: **${metrics.cacheHits + pageCacheRows}** (robots cache: ${metrics.cacheHits}; page-response cache: ${pageCacheRows})
- Upgraded to high: **${counts.upgraded}**
- Stayed medium: **${counts.medium}**
- Rejected: **${counts.rejected}**
- Inconclusive: **${counts.inconclusive}**
- Rows with at least one blocked/timeout request: **${blockedRows}**
- Rows with a timeout signal: **${timeoutRows}**
- Successful pages checked: **${metrics.pagesChecked}**
- Page URLs attempted: **${metrics.pagesAttempted}** (maximum 5 per domain, including homepage; blocked attempts count toward the cap)

${requestCountNote}

## Status counts

| Verification status | New confidence | Sponsor rows |
|---|---|---:|
| upgraded | high | ${counts.upgraded} |
| kept_medium | medium | ${counts.medium} |
| rejected | none | ${counts.rejected} |
| inconclusive | original confidence retained | ${counts.inconclusive} |

## Examples of upgraded candidates

${displayExamples(rows, "upgraded")}

## Examples of rejected candidates

${displayExamples(rows, "rejected")}

## Verification scope and safety

- Only the selected pilot CSV was read as source data.
- Each candidate homepage was fetched from its listed URL. Additional pages were selected only from same-site About, Contact, or Careers/Jobs/Vacancies links found on that homepage.
- No search engine, domain guessing, external ATS, database, or production import was used.
- The controlled public-site fetcher enforced HTTPS, public-DNS checks, robots policy, same-site redirect boundaries, response-size limits, timeouts, and per-host pacing.
- Page cap: **5 per domain**, including the homepage. This pass selected at most one linked page in each of the About, Contact, and Careers categories.
- No retries were made; blocked, unsafe, and timeout outcomes remain inconclusive unless other fetched first-party pages independently established identity.

## Is this reliable enough to run on all 2,395 candidates?

**No—not on this pilot alone.** The pilot was deliberately biased toward strong medium-confidence candidates and contained no low-confidence candidates, so it does not estimate performance across the full set. Review the evidence for upgrades and rejects, resolve inconclusive cases, and test a separate representative sample before applying this process to all 2,395 rows.

## Data and deployment confirmation

- Production data changed: **No**
- Import performed: **No**
- Deployment performed: **No**

### Row status ledger

| Verification status | New confidence | Sponsor ID |
|---|---|---:|
${statusRows}
`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function runLiveWebsiteVerification(): Promise<{
  rows: OutputRow[];
  metrics: RunMetrics;
}> {
  const inputPath = resolve(REPO_ROOT, INPUT_PATH);
  const outputPath = resolve(REPO_ROOT, OUTPUT_PATH);
  const reportPath = resolve(REPO_ROOT, REPORT_PATH);
  if (await fileExists(outputPath)) {
    throw new Error(`Refusing to repeat live checks because output already exists: ${OUTPUT_PATH}`);
  }
  if (await fileExists(reportPath)) {
    throw new Error(`Refusing to overwrite existing report: ${REPORT_PATH}`);
  }

  const input = parseCsvObjects(await readFile(inputPath, "utf8"));
  validateInput(input);

  const metrics: RunMetrics = {
    httpRequestsMade: 0,
    cacheHits: 0,
    pageCacheHits: 0,
    domainsChecked: new Set<string>(),
    pagesAttempted: 0,
    pagesChecked: 0,
  };
  const fetcher = new PublicSiteFetcher(HOST_DELAY_MS, metrics);
  const pageCache = new Map<string, CachedFetch>();
  const results: OutputRow[] = [];

  console.log(
    `Starting live verification for ${input.length} selected rows only; max ${MAX_PAGES_PER_DOMAIN} page URLs per domain; no search, database, or import.`,
  );
  for (const [index, row] of input.entries()) {
    try {
      results.push(await processCandidate(row, fetcher, pageCache, metrics));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failed = emptyOutput(row, `Unexpected row-level verification error: ${message}`);
      failed.notes = `row-level error: ${message}; no other source rows were loaded`;
      results.push(failed);
    }
    if ((index + 1) % 5 === 0 || index + 1 === input.length) {
      console.log(
        `Progress: ${index + 1}/${input.length}; pages attempted ${metrics.pagesAttempted}; HTTP requests ${metrics.httpRequestsMade}.`,
      );
    }
  }

  const csv = stringifyCsv(results, OUTPUT_COLUMNS);
  const report = buildReport(results, metrics, INPUT_PATH, metrics.pageCacheHits, false);
  await writeFile(outputPath, csv, { encoding: "utf8", flag: "wx" });
  await writeFile(reportPath, report, { encoding: "utf8", flag: "wx" });
  console.log(
    `Live verification complete: ${results.length} processed, ${metrics.httpRequestsMade} HTTP requests, ${metrics.cacheHits + metrics.pageCacheHits} cache hits. Files: ${OUTPUT_PATH}, ${REPORT_PATH}.`,
  );
  return { rows: results, metrics };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runLiveWebsiteVerification().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}