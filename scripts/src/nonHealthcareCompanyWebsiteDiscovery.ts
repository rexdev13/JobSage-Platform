import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseCsvObjects, stringifyCsv } from "./sponsor-contact-discovery/csv";
import { PublicSiteFetcher, type PageResult } from "./sponsor-contact-discovery/http";
import {
  extractBingWebsiteLeads,
  normalizeWebsiteName,
  sponsorListWebsiteLead,
  verifyOfficialWebsiteIdentity,
  websiteCandidateFromEmail,
  websiteCandidateFromValue,
  type WebsiteCandidate,
} from "./nonHealthcareWebsiteIdentity";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_INPUT = ".local/reports/sponsor-enrichment/jobsage-sponsor-base-export.csv";
const DEFAULT_COMPANY_SITES =
  ".local/reports/sponsor-enrichment/jobsage-company-site-existing.csv";
const DEFAULT_VACANCY_SOURCES =
  ".local/reports/sponsor-enrichment/jobsage-existing-vacancy-sources.csv";
const DEFAULT_OUTPUT = "artifacts/non-healthcare-company-websites-all-sectors.csv";
const DEFAULT_OUTPUT_DIR = "artifacts/company-websites-by-sector";
const DEFAULT_REPORT = "artifacts/non-healthcare-company-websites-all-sectors-report.md";
const DEFAULT_PROGRESS =
  "artifacts/non-healthcare-company-websites-all-sectors-progress.json";
const DEFAULT_JOURNAL =
  "artifacts/non-healthcare-company-websites-all-sectors-progress.jsonl";
const MAX_PER_SECTOR = 3_000;
const DEFAULT_PAGE_DELAY_MS = 1_500;
const DEFAULT_MAX_PUBLIC_FETCH_CALLS = 50_000;
const DEFAULT_MAX_SPONSORLIST_QUERIES = 15_000;
const DEFAULT_MAX_SEARCH_QUERIES = 100;
const CHECKPOINT_EVERY = 25;
const RUN_SCHEMA_VERSION = 1;

export const NON_HEALTHCARE_WEBSITE_COLUMNS = [
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

type SourceRow = Record<string, string>;
type Confidence = "high" | "medium" | "low" | "unverified";
type OutputRow = Record<(typeof NON_HEALTHCARE_WEBSITE_COLUMNS)[number], string>;
type CachedCheck = {
  outcome: "verified" | "low" | "rejected";
  officialWebsiteUrl: string;
  evidenceUrl: string;
  confidence: "high" | "medium" | "none";
  reason: string;
};
type SponsorListCacheValue = {
  status: "lead" | "no_match" | "error" | "capped";
  candidate: WebsiteCandidate | null;
  reason: string;
};
type SearchCacheValue = {
  status: "leads" | "none" | "error" | "capped";
  candidates: WebsiteCandidate[];
  reason: string;
};
type Attempt = {
  domain: string;
  source: string;
  outcome: "verified" | "low" | "rejected" | "cache_hit" | "error" | "capped";
  confidence: "high" | "medium" | "none";
  officialWebsiteUrl: string;
  evidenceUrl: string;
  reason: string;
  cacheKey?: string;
  cacheWrite?: CachedCheck;
};
type JournalEntry = {
  sponsorKey: string;
  industry: string;
  cacheKeys: {
    normalizedName: string;
    emailDomain: string;
    existingWebsiteDomain: string;
    sponsorList: string;
    search: string;
  };
  output: OutputRow;
  attempts: Attempt[];
  failureCodes: string[];
  cacheHits: number;
  sponsorListCacheWrite?: { key: string; value: SponsorListCacheValue };
  searchCacheWrite?: { key: string; value: SearchCacheValue };
  completedAt: string;
};
type SectorSelection = {
  label: string;
  rows: SourceRow[];
  sourceCount: number;
  capApplied: boolean;
  slug: string;
};
type Options = {
  input: string;
  companySites: string;
  vacancySources: string;
  output: string;
  outputDir: string;
  report: string;
  progress: string;
  journal: string;
  maxPerSector: number;
  delayMs: number;
  maxPublicFetchCalls: number;
  maxSponsorListQueries: number;
  maxSearchQueries: number;
  fresh: boolean;
};
type ProgressState = {
  schemaVersion: number;
  signature: string;
  inputPath: string;
  inputRows: number;
  healthcareRowsExcluded: number;
  nonHealthcareRows: number;
  uniqueNonHealthcareRows: number;
  selectedRows: number;
  sectors: Array<{
    label: string;
    sourceCount: number;
    selectedCount: number;
    capApplied: boolean;
    slug: string;
  }>;
  processedCount: number;
  publicFetchCalls: number;
  siteFetchCalls: number;
  sponsorListQueries: number;
  searchQueries: number;
  searchConfigured: boolean;
  searchFailureCount: number;
  cacheHits: number;
  startedAt: string;
  updatedAt: string;
  complete: boolean;
  stopReason: string;
  journalPath: string;
  outputs: {
    combinedCsv: string;
    sectorDirectory: string;
    report: string;
    progress: string;
    journal: string;
  };
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function displaySector(label: string): string {
  return label === "" ? "(blank industry)" : label;
}

function sectorSlug(label: string): string {
  if (label === "") return "missing-industry";
  const slug = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "unnamed-industry";
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stableSponsorKey(row: SourceRow): string {
  const id = clean(row.sponsor_licence_id);
  if (id) return `id:${id}`;
  const name = normalizeWebsiteName(clean(row.organisation_name));
  const town = normalizeWebsiteName(clean(row.town_city));
  return `fallback:${name}|${town}`;
}

function emailDomain(email: string): string {
  const match = clean(email).match(/^[^@\s]+@([^@\s]+)$/);
  return match?.[1]?.toLowerCase().replace(/\.$/, "") ?? "";
}

function sponsorLookupKey(row: SourceRow): string {
  return [
    normalizeWebsiteName(clean(row.organisation_name)),
    normalizeWebsiteName(clean(row.town_city)),
    normalizeWebsiteName(clean(row.county)),
    emailDomain(row.existing_contact_email),
  ].join("|");
}

function identityCacheKey(row: SourceRow, candidate: WebsiteCandidate): string {
  return [
    candidate.domain.toLowerCase(),
    normalizeWebsiteName(clean(row.organisation_name)),
    normalizeWebsiteName(clean(row.town_city)),
    normalizeWebsiteName(clean(row.county)),
    emailDomain(row.existing_contact_email),
  ].join("|");
}

function parseOptions(argv: string[]): Options {
  const values = new Map<string, string>();
  let fresh = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--") continue;
    if (arg === "--fresh") {
      fresh = true;
      continue;
    }
    if (arg === "--resume") continue;
    if (!arg.startsWith("--")) throw new Error(`Unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for --${key}`);
    values.set(key, value);
    i += 1;
  }

  const numberOption = (key: string, fallback: number, min: number, max: number) => {
    const raw = values.get(key);
    if (raw === undefined) return fallback;
    const number = Number(raw);
    if (!Number.isInteger(number) || number < min || number > max) {
      throw new Error(`--${key} must be an integer from ${min} to ${max}`);
    }
    return number;
  };

  const options: Options = {
    input: values.get("input") ?? DEFAULT_INPUT,
    companySites: values.get("known-sites-file") ?? DEFAULT_COMPANY_SITES,
    vacancySources: values.get("known-sources-file") ?? DEFAULT_VACANCY_SOURCES,
    output: values.get("output") ?? DEFAULT_OUTPUT,
    outputDir: values.get("output-dir") ?? DEFAULT_OUTPUT_DIR,
    report: values.get("report") ?? DEFAULT_REPORT,
    progress: values.get("progress") ?? DEFAULT_PROGRESS,
    journal: values.get("journal") ?? DEFAULT_JOURNAL,
    maxPerSector: numberOption("max-per-sector", MAX_PER_SECTOR, 1, MAX_PER_SECTOR),
    delayMs: numberOption("delay-ms", DEFAULT_PAGE_DELAY_MS, 1_000, 60_000),
    maxPublicFetchCalls: numberOption(
      "max-public-fetch-calls",
      DEFAULT_MAX_PUBLIC_FETCH_CALLS,
      1,
      100_000,
    ),
    maxSponsorListQueries: numberOption(
      "max-sponsorlist-queries",
      DEFAULT_MAX_SPONSORLIST_QUERIES,
      0,
      20_000,
    ),
    maxSearchQueries: numberOption(
      "max-search-queries",
      DEFAULT_MAX_SEARCH_QUERIES,
      0,
      1_000,
    ),
    fresh,
  };
  return options;
}

function absolutePath(relativeOrAbsolute: string): string {
  return resolve(REPO_ROOT, relativeOrAbsolute);
}

async function requiredTextFile(path: string): Promise<string> {
  try {
    return await readFile(absolutePath(path), "utf8");
  } catch {
    throw new Error(`Required input file is missing or unreadable: ${path}`);
  }
}

function rowsByExactNormalizedName(rows: SourceRow[]): Map<string, SourceRow[]> {
  const result = new Map<string, SourceRow[]>();
  for (const row of rows) {
    const key = normalizeWebsiteName(clean(row.organisation_name));
    if (!key) continue;
    const group = result.get(key) ?? [];
    group.push(row);
    result.set(key, group);
  }
  return result;
}

export function selectNonHealthcareSectors(sourceRows: SourceRow[], maxPerSector: number): {
  sectors: SectorSelection[];
  uniqueNonHealthcareRows: SourceRow[];
  healthcareRowsExcluded: number;
  duplicateRowsSkipped: number;
} {
  const seen = new Set<string>();
  const grouped = new Map<string, SourceRow[]>();
  const uniqueNonHealthcareRows: SourceRow[] = [];
  let healthcareRowsExcluded = 0;
  let duplicateRowsSkipped = 0;

  for (const row of sourceRows) {
    const industry = row.industry ?? "";
    if (industry === "Healthcare") {
      healthcareRowsExcluded += 1;
      continue;
    }
    const key = stableSponsorKey(row);
    if (seen.has(key)) {
      duplicateRowsSkipped += 1;
      continue;
    }
    seen.add(key);
    uniqueNonHealthcareRows.push(row);
    const group = grouped.get(industry) ?? [];
    group.push(row);
    grouped.set(industry, group);
  }

  const sectors = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([label, rows]) => ({
      label,
      rows: rows.slice(0, maxPerSector),
      sourceCount: rows.length,
      capApplied: rows.length > maxPerSector,
      slug: sectorSlug(label),
    }));
  return { sectors, uniqueNonHealthcareRows, healthcareRowsExcluded, duplicateRowsSkipped };
}

function makeSupportIndexes(companySites: SourceRow[], vacancySources: SourceRow[]) {
  return {
    companySites: rowsByExactNormalizedName(companySites),
    vacancySources: rowsByExactNormalizedName(vacancySources),
  };
}

function validEmailAddress(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean(value));
}

function existingSourceEvidenceCount(
  row: SourceRow,
  support: ReturnType<typeof makeSupportIndexes>,
): boolean {
  const name = normalizeWebsiteName(clean(row.organisation_name));
  if (!name) return false;
  if ((support.companySites.get(name)?.length ?? 0) > 0) return true;
  return (support.vacancySources.get(name) ?? []).some(
    (source) =>
      clean(source.source_type).toLowerCase() === "company_site" &&
      clean(source.latest_verification_status).toLowerCase() === "live" &&
      Boolean(clean(source.url_host)),
  );
}

function makeOutputBase(row: SourceRow): Omit<
  OutputRow,
  | "official_website_url"
  | "website_confidence"
  | "website_evidence_url"
  | "source"
  | "notes"
> {
  return {
    sponsor_licence_id: clean(row.sponsor_licence_id),
    organisation_name: clean(row.organisation_name),
    normalized_organisation_name:
      clean(row.normalized_organisation_name) ||
      normalizeWebsiteName(clean(row.organisation_name)),
    town_city: clean(row.town_city),
    county: clean(row.county),
    region: clean(row.region),
    industry: row.industry ?? "",
    route: clean(row.route),
    sub_route: clean(row.sub_route),
    existing_website: clean(row.existing_website),
    existing_contact_email: clean(row.existing_contact_email),
    existing_careers_url: clean(row.existing_careers_url),
  };
}

function addCandidate(
  list: WebsiteCandidate[],
  candidate: WebsiteCandidate | null,
): void {
  if (!candidate) return;
  const existing = list.find((item) => item.domain === candidate.domain);
  if (existing) {
    const sources = new Set(existing.source.split("+"));
    sources.add(candidate.source);
    existing.source = [...sources].join("+");
    if (!existing.evidenceUrl && candidate.evidenceUrl) {
      existing.evidenceUrl = candidate.evidenceUrl;
    }
    return;
  }
  list.push(candidate);
}

function localWebsiteCandidates(
  row: SourceRow,
  support: ReturnType<typeof makeSupportIndexes>,
): { candidates: WebsiteCandidate[]; diagnostics: string[] } {
  const candidates: WebsiteCandidate[] = [];
  const diagnostics: string[] = [];

  if (clean(row.existing_website)) {
    const candidate = websiteCandidateFromValue(
      row.existing_website,
      "existing_website",
    );
    if (candidate) addCandidate(candidates, candidate);
    else diagnostics.push("existing_website_not_eligible");
  }

  if (clean(row.existing_contact_email)) {
    const candidate = websiteCandidateFromEmail(row.existing_contact_email);
    if (candidate) addCandidate(candidates, candidate);
    else if (validEmailAddress(row.existing_contact_email)) {
      diagnostics.push("contact_email_domain_not_used_as_website_lead");
    }
  }

  if (clean(row.existing_careers_url)) {
    const candidate = websiteCandidateFromValue(
      row.existing_careers_url,
      "existing_careers_url_domain",
    );
    if (candidate) addCandidate(candidates, candidate);
    else diagnostics.push("existing_careers_url_not_employer_domain");
  }

  const normalizedName = normalizeWebsiteName(clean(row.organisation_name));
  const companyRows = support.companySites.get(normalizedName) ?? [];
  if (companyRows.length === 1) {
    const careersUrl = clean(companyRows[0]!.careers_url);
    if (careersUrl) {
      const candidate = websiteCandidateFromValue(
        careersUrl,
        "company_site_existing_file",
      );
      if (candidate) addCandidate(candidates, candidate);
      else diagnostics.push("company_site_cache_url_not_employer_domain");
    }
  } else if (companyRows.length > 1) {
    diagnostics.push("company_site_support_name_ambiguous");
  }

  const sourceRows = support.vacancySources.get(normalizedName) ?? [];
  const eligibleSourceRows = sourceRows.filter(
    (source) =>
      clean(source.source_type).toLowerCase() === "company_site" &&
      clean(source.latest_verification_status).toLowerCase() === "live" &&
      clean(source.url_host),
  );
  const uniqueSourceHosts = new Set(
    eligibleSourceRows.map((source) => clean(source.url_host).toLowerCase()),
  );
  if (uniqueSourceHosts.size === 1) {
    const host = [...uniqueSourceHosts][0]!;
    const candidate = websiteCandidateFromValue(
      host,
      "verified_company_site_source_host",
    );
    if (candidate) addCandidate(candidates, candidate);
    else diagnostics.push("company_site_source_host_not_eligible");
  } else if (uniqueSourceHosts.size > 1) {
    diagnostics.push("company_site_source_host_ambiguous");
  }

  return { candidates, diagnostics };
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failureCode(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("robots.txt") || lower.includes("robots")) return "robots_or_policy_block";
  if (lower.includes("private") || lower.includes("unresolved destination")) return "unsafe_or_unresolved_host";
  if (lower.includes("redirect left") || lower.includes("too many redirects")) {
    return "unsafe_or_external_redirect";
  }
  if (lower.includes("size limit")) return "page_over_size_limit";
  if (lower.includes("http 404") || lower.includes("http 410")) return "website_not_found";
  if (lower.includes("http 403") || lower.includes("http 401")) return "website_access_denied";
  if (lower.includes("http 429")) return "website_rate_limited";
  if (/http 5\d\d/.test(lower)) return "website_server_error";
  if (lower.includes("timeout") || lower.includes("abort")) return "website_timeout";
  if (lower.includes("https")) return "https_or_url_policy";
  return "website_fetch_failed";
}

function isRetryable(message: string): boolean {
  const lower = message.toLowerCase();
  if (
    lower.includes("robots") ||
    lower.includes("private") ||
    lower.includes("redirect") ||
    lower.includes("size limit") ||
    lower.includes("http 429") ||
    lower.includes("http 404") ||
    lower.includes("http 403") ||
    lower.includes("http 401")
  ) {
    return false;
  }
  return (
    lower.includes("timeout") ||
    lower.includes("abort") ||
    lower.includes("fetch failed") ||
    lower.includes("econnreset") ||
    lower.includes("eai_again") ||
    lower.includes("socket") ||
    /http 5\d\d/.test(lower)
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function originRoot(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}/`;
}

function sponsorListUrl(row: SourceRow): string {
  const url = new URL("https://sponsorlist.co.uk/wp-json/uks/v1/sponsors");
  url.searchParams.set("search", clean(row.organisation_name));
  url.searchParams.set("per_page", "100");
  return url.toString();
}

function bingQuery(row: SourceRow): string {
  return [
    clean(row.organisation_name),
    clean(row.town_city),
    clean(row.county),
    "official website",
  ]
    .filter(Boolean)
    .join(" ");
}

async function bingWebsiteLeads(
  row: SourceRow,
  apiKey: string,
): Promise<WebsiteCandidate[]> {
  const endpoint = new URL("https://api.bing.microsoft.com/v7.0/search");
  endpoint.searchParams.set("q", bingQuery(row));
  endpoint.searchParams.set("count", "5");
  endpoint.searchParams.set("responseFilter", "Webpages");
  const response = await fetch(endpoint, {
    headers: {
      Accept: "application/json",
      "Ocp-Apim-Subscription-Key": apiKey,
    },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Bing HTTP ${response.status}`);
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > 2_000_000) throw new Error("Bing response exceeds size limit");
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > 2_000_000) {
    throw new Error("Bing response exceeds size limit");
  }
  return extractBingWebsiteLeads(JSON.parse(body) as unknown);
}

async function readProgress(path: string): Promise<ProgressState | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as ProgressState;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Progress file is unreadable: ${path}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temp, content, "utf8");
  await rename(temp, path);
}

async function backupFile(path: string, timestamp: string): Promise<void> {
  if (!(await exists(path))) return;
  await rename(path, `${path}.${timestamp}.bak`);
}

async function readJournal(path: string): Promise<JournalEntry[]> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  if (!content) return [];

  const lines = content.split("\n");
  const hasFinalNewline = content.endsWith("\n");
  const parseLines = hasFinalNewline ? lines.slice(0, -1) : lines.slice(0, -1);
  const entries: JournalEntry[] = [];
  for (const line of parseLines) {
    if (!line) continue;
    try {
      entries.push(JSON.parse(line) as JournalEntry);
    } catch {
      throw new Error("Progress journal has a corrupt complete row; refusing to resume.");
    }
  }
  if (!hasFinalNewline) {
    await writeAtomic(path, `${parseLines.filter(Boolean).join("\n")}\n`);
  }
  return entries;
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function percent(numerator: number, denominator: number): string {
  if (!denominator) return "0.0%";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function createReport(
  state: ProgressState,
  selections: SectorSelection[],
  sourceRows: SourceRow[],
  support: ReturnType<typeof makeSupportIndexes>,
  completedByKey: Map<string, JournalEntry>,
  searchConfigured: boolean,
  duplicateRowsSkipped: number,
): string {
  const allCompleted = selections.flatMap((sector) =>
    sector.rows
      .map((row) => completedByKey.get(stableSponsorKey(row)))
      .filter((entry): entry is JournalEntry => Boolean(entry)),
  );
  const sourceRowsByIndustry = new Map<string, SourceRow[]>();
  let healthcareRows = 0;
  let nonHealthcareRows = 0;
  for (const row of sourceRows) {
    const industry = row.industry ?? "";
    if (industry === "Healthcare") {
      healthcareRows += 1;
      continue;
    }
    nonHealthcareRows += 1;
    const group = sourceRowsByIndustry.get(industry) ?? [];
    group.push(row);
    sourceRowsByIndustry.set(industry, group);
  }

  const sectorStats = selections.map((sector) => {
    const entries = sector.rows
      .map((row) => completedByKey.get(stableSponsorKey(row)))
      .filter((entry): entry is JournalEntry => Boolean(entry));
    const high = entries.filter((entry) => entry.output.website_confidence === "high").length;
    const medium = entries.filter((entry) => entry.output.website_confidence === "medium").length;
    const low = entries.filter((entry) => entry.output.website_confidence === "low").length;
    const unverified = entries.filter((entry) => entry.output.website_confidence === "unverified").length;
    const found = high + medium;
    return {
      ...sector,
      processed: entries.length,
      high,
      medium,
      low,
      unverified,
      found,
      coverage: entries.length ? found / entries.length : 0,
    };
  });

  const existingSignalStats = selections.map((sector) => {
    const rows = sourceRowsByIndustry.get(sector.label) ?? [];
    const website = rows.filter((row) => Boolean(clean(row.existing_website))).length;
    const careers = rows.filter((row) => Boolean(clean(row.existing_careers_url))).length;
    const email = rows.filter((row) => validEmailAddress(row.existing_contact_email)).length;
    const priorEvidence = rows.filter((row) => existingSourceEvidenceCount(row, support)).length;
    return {
      label: sector.label,
      rows: rows.length,
      website,
      careers,
      email,
      priorEvidence,
    };
  });

  const failureCounts = new Map<string, number>();
  const sourceCounts = new Map<string, number>();
  for (const entry of allCompleted) {
    for (const code of entry.failureCodes) {
      failureCounts.set(code, (failureCounts.get(code) ?? 0) + 1);
    }
    for (const source of entry.output.source.split("+").filter(Boolean)) {
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    }
  }

  const ranked = [...sectorStats]
    .filter((sector) => sector.processed > 0)
    .sort((a, b) => b.coverage - a.coverage || b.processed - a.processed);
  const sufficientlySampled = ranked.filter((sector) => sector.processed >= 50);
  const topSectors = sufficientlySampled.slice(0, 3);
  const bottomSectors = [...sufficientlySampled].reverse().slice(0, 3);
  const recommended = topSectors.filter((sector) => sector.found > 0);
  const totalFound = allCompleted.filter(
    (entry) =>
      entry.output.website_confidence === "high" ||
      entry.output.website_confidence === "medium",
  ).length;
  const processedCount = allCompleted.length;
  const capExcluded = selections.reduce(
    (sum, sector) => sum + Math.max(0, sector.sourceCount - sector.rows.length),
    0,
  );
  const completionLabel = state.complete ? "Complete" : "Incomplete / resumable";
  const now = new Date().toISOString();
  const sectorRows = sectorStats
    .map(
      (sector) =>
        `| ${markdownCell(displaySector(sector.label))} | ${sector.sourceCount} | ${sector.rows.length} | ${sector.capApplied ? "Yes" : "No"} | ${sector.processed} | ${sector.found} (${percent(sector.found, sector.processed)}) | ${sector.high} | ${sector.medium} | ${sector.low} | ${sector.unverified} |`,
    )
    .join("\n");
  const inventoryRows = existingSignalStats
    .map(
      (sector) =>
        `| ${markdownCell(displaySector(sector.label))} | ${sector.rows} | ${sector.website} | ${sector.careers} | ${sector.email} | ${sector.priorEvidence} |`,
    )
    .join("\n");
  const failureRows = [...failureCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, count]) => `| ${markdownCell(code)} | ${count} |`)
    .join("\n");
  const sourceRowsMd = [...sourceCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => `| ${markdownCell(source)} | ${count} |`)
    .join("\n");
  const recommendationList = recommended.length
    ? recommended
        .map(
          (sector) =>
            `- **${displaySector(sector.label)}** — ${sector.found}/${sector.processed} verified websites (${percent(sector.found, sector.processed)}).`,
        )
        .join("\n")
    : "- No sector has verified website coverage in the completed sample yet.";
  const skipList = bottomSectors.length
    ? bottomSectors
        .map(
          (sector) =>
            `- **${displaySector(sector.label)}** — lowest measured website coverage among sectors with at least 50 processed (${sector.found}/${sector.processed}, ${percent(sector.found, sector.processed)}); review the failure mix before prioritizing.`,
        )
        .join("\n")
    : "- Not enough processed rows to identify lower-coverage sectors reliably.";

  return `# Non-Healthcare company website discovery — all sectors

**Status:** ${completionLabel}  
**Updated:** ${now}

## Scope and inputs

- Source CSV: \`${state.inputPath}\`
- Rows in source CSV: **${sourceRows.length.toLocaleString("en-GB")}**
- Exact \`Healthcare\` rows excluded: **${healthcareRows.toLocaleString("en-GB")}**
- Non-Healthcare sponsor rows considered, including blank \`industry\`: **${nonHealthcareRows.toLocaleString("en-GB")}**
- Unique non-Healthcare rows after stable sponsor-ID deduplication: **${state.uniqueNonHealthcareRows.toLocaleString("en-GB")}**
- Selected under the per-sector cap: **${state.selectedRows.toLocaleString("en-GB")}**
- Processed so far: **${processedCount.toLocaleString("en-GB")}**; verified website found (high + medium): **${totalFound.toLocaleString("en-GB")}**
- Rows skipped by the 3,000-per-sector cap: **${capExcluded.toLocaleString("en-GB")}**
- Duplicate source rows skipped: **${duplicateRowsSkipped}**
- The blank industry value is kept as its own \`(blank industry)\` group; only the exact value \`Healthcare\` is excluded.
- Sector selection follows the stable order of the supplied export; within each exact industry, the first 3,000 unique sponsor rows are selected.
- Search configured: **${searchConfigured ? "yes" : "no"}**; Bing queries used: **${state.searchQueries}**. SponsorList queries: **${state.sponsorListQueries}**. PublicSiteFetcher calls (site and SponsorList): **${state.publicFetchCalls}**, including retries. Company homepage checks: **${state.siteFetchCalls}**.

## Existing signal inventory

These counts cover only existing website, careers URL, public contact email, and company-site evidence fields. Prior source evidence means an exact normalized-name match in the supplied company-site file or a live \`company_site\` source row.

| Exact industry label | Source sponsors | Existing website | Existing careers URL | Valid contact email | Prior source evidence |
|---|---:|---:|---:|---:|---:|
${inventoryRows}

## Results by sector

“Websites found” counts only first-party identity-verified high/medium results. Low-confidence candidates remain review-only and have no accepted \`official_website_url\`.

| Exact industry label | Available | Selected | Cap applied | Processed | Websites found (coverage) | High | Medium | Low | Unverified |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
${sectorRows}

## Sources used

The run tried existing website first, then a usable existing contact-email domain, an employer-domain existing careers URL, exact-name company-site support, a live company-site host clue from the vacancy-source support file, SponsorList, and finally optional configured Bing search. Cached vacancy-detail/application URLs were never followed or accepted as websites.

| Lead source used for rows | Rows |
|---|---:|
${sourceRowsMd || "| (none yet) | 0 |"}

## Common failure reasons

Failure counts may exceed processed rows because one sponsor can have multiple failed candidate leads before another lead verifies.

| Reason code | Occurrences |
|---|---:|
${failureRows || "| (none yet) | 0 |"}

## Website coverage priorities

Best verified website coverage among sectors with at least 50 processed:

${topSectors.length
  ? topSectors
      .map(
        (sector) =>
          `- **${displaySector(sector.label)}** — ${sector.found}/${sector.processed} verified websites (${percent(sector.found, sector.processed)}).`,
      )
      .join("\n")
  : "- Not enough completed rows to rank sectors."}

Lowest coverage among sectors with at least 50 processed:

${skipList}

Use these sectors as the strongest website-identity starting points:

${recommendationList}

No ATS/job-board discovery, vacancy discovery or routing, import, database write, production change, or deployment was performed.

## Files and resume

- Combined CSV: \`${state.outputs.combinedCsv}\` (${processedCount} processed rows currently written)
- Per-sector CSVs: \`${state.outputs.sectorDirectory}/<sector-slug>-company-websites.csv\`
- Progress JSON: \`${state.outputs.progress}\`
- Append-only resume journal: \`${state.outputs.journal}\`
- This report: \`${state.outputs.report}\`
- Run signature: \`${state.signature}\`

${state.complete ? "This run is complete." : `This run is resumable. Continue with \`pnpm --filter @workspace/scripts non-healthcare-company-websites -- --resume\`; the runner validates the input/support hashes and resumes from the journal. Stop reason: ${state.stopReason || "not yet completed"}.`}

No database was queried or changed. The supplied export and support CSVs were read as local files only.
`;
}

function outputRowsInOrder(
  sectors: SectorSelection[],
  completedByKey: Map<string, JournalEntry>,
): OutputRow[] {
  return sectors.flatMap((sector) =>
    sector.rows
      .map((row) => completedByKey.get(stableSponsorKey(row))?.output)
      .filter((output): output is OutputRow => Boolean(output)),
  );
}

async function writeOutputsAndReport(
  state: ProgressState,
  sectors: SectorSelection[],
  sourceRows: SourceRow[],
  support: ReturnType<typeof makeSupportIndexes>,
  completedByKey: Map<string, JournalEntry>,
  searchConfigured: boolean,
  duplicateRowsSkipped: number,
): Promise<void> {
  const combinedRows = outputRowsInOrder(sectors, completedByKey);
  await writeAtomic(
    absolutePath(state.outputs.combinedCsv),
    stringifyCsv(combinedRows, NON_HEALTHCARE_WEBSITE_COLUMNS),
  );

  for (const sector of sectors) {
    const rows = sector.rows
      .map((row) => completedByKey.get(stableSponsorKey(row))?.output)
      .filter((output): output is OutputRow => Boolean(output));
    const sectorFile = join(state.outputs.sectorDirectory, `${sector.slug}-company-websites.csv`);
    await writeAtomic(
      absolutePath(sectorFile),
      stringifyCsv(rows, NON_HEALTHCARE_WEBSITE_COLUMNS),
    );
  }

  state.processedCount = combinedRows.length;
  state.updatedAt = new Date().toISOString();
  const report = createReport(
    state,
    sectors,
    sourceRows,
    support,
    completedByKey,
    searchConfigured,
    duplicateRowsSkipped,
  );
  await writeAtomic(absolutePath(state.outputs.report), report);
  await writeAtomic(absolutePath(state.outputs.progress), `${JSON.stringify(state, null, 2)}\n`);
}

function restoreCaches(entries: JournalEntry[]): {
  completedByKey: Map<string, JournalEntry>;
  verificationCache: Map<string, CachedCheck>;
  sponsorListCache: Map<string, SponsorListCacheValue>;
  searchCache: Map<string, SearchCacheValue>;
} {
  const completedByKey = new Map<string, JournalEntry>();
  const verificationCache = new Map<string, CachedCheck>();
  const sponsorListCache = new Map<string, SponsorListCacheValue>();
  const searchCache = new Map<string, SearchCacheValue>();
  for (const entry of entries) {
    completedByKey.set(entry.sponsorKey, entry);
    for (const attempt of entry.attempts) {
      if (attempt.cacheKey && attempt.cacheWrite) {
        verificationCache.set(attempt.cacheKey, attempt.cacheWrite);
      }
    }
    if (entry.sponsorListCacheWrite) {
      sponsorListCache.set(
        entry.sponsorListCacheWrite.key,
        entry.sponsorListCacheWrite.value,
      );
    }
    if (entry.searchCacheWrite) {
      searchCache.set(entry.searchCacheWrite.key, entry.searchCacheWrite.value);
    }
  }
  return { completedByKey, verificationCache, sponsorListCache, searchCache };
}

async function readBingKey(): Promise<string> {
  return process.env.BING_SEARCH_API_KEY ?? "";
}

function cacheCheckIsPermanent(message: string): boolean {
  const code = failureCode(message);
  return [
    "robots_or_policy_block",
    "unsafe_or_unresolved_host",
    "unsafe_or_external_redirect",
    "page_over_size_limit",
    "website_not_found",
    "website_access_denied",
    "https_or_url_policy",
  ].includes(code);
}

async function fetchPage(
  candidate: WebsiteCandidate,
  fetcher: PublicSiteFetcher,
  state: ProgressState,
  maxPublicFetchCalls: number,
): Promise<{ page: PageResult | null; error: string; capped: boolean }> {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (state.publicFetchCalls >= maxPublicFetchCalls) {
      return { page: null, error: "public_fetch_budget_reached", capped: true };
    }
    state.publicFetchCalls += 1;
    state.siteFetchCalls += 1;
    try {
      return {
        page: await fetcher.fetch(candidate.url),
        error: "",
        capped: false,
      };
    } catch (error) {
      lastError = errorReason(error);
      if (attempt === 0 && isRetryable(lastError)) {
        await delay(1_000);
        continue;
      }
      return { page: null, error: lastError, capped: false };
    }
  }
  return { page: null, error: lastError || "website_fetch_failed", capped: false };
}

async function fetchSponsorList(
  row: SourceRow,
  cacheKey: string,
  cache: Map<string, SponsorListCacheValue>,
  fetcher: PublicSiteFetcher,
  state: ProgressState,
  options: Options,
): Promise<{ value: SponsorListCacheValue; cacheWrite?: { key: string; value: SponsorListCacheValue } }> {
  const cached = cache.get(cacheKey);
  if (cached) {
    state.cacheHits += 1;
    return { value: cached };
  }
  if (state.sponsorListQueries >= options.maxSponsorListQueries) {
    const value: SponsorListCacheValue = {
      status: "capped",
      candidate: null,
      reason: "sponsorlist_query_budget_reached",
    };
    return { value };
  }
  if (state.publicFetchCalls >= options.maxPublicFetchCalls) {
    const value: SponsorListCacheValue = {
      status: "capped",
      candidate: null,
      reason: "public_fetch_budget_reached",
    };
    return { value };
  }

  state.sponsorListQueries += 1;
  state.publicFetchCalls += 1;
  let value: SponsorListCacheValue;
  try {
    const page = await fetcher.fetch(sponsorListUrl(row));
    let payload: unknown;
    try {
      payload = JSON.parse(page.body) as unknown;
    } catch {
      value = {
        status: "error",
        candidate: null,
        reason: "sponsorlist_response_not_json",
      };
      cache.set(cacheKey, value);
      return { value, cacheWrite: { key: cacheKey, value } };
    }
    const candidate = sponsorListWebsiteLead(row, payload);
    value = candidate
      ? { status: "lead", candidate, reason: "exact_name_location_lead" }
      : { status: "no_match", candidate: null, reason: "no_exact_name_location_lead" };
  } catch (error) {
    value = {
      status: "error",
      candidate: null,
      reason: failureCode(errorReason(error)),
    };
  }
  cache.set(cacheKey, value);
  return { value, cacheWrite: { key: cacheKey, value } };
}

async function fetchBing(
  row: SourceRow,
  cacheKey: string,
  apiKey: string,
  cache: Map<string, SearchCacheValue>,
  state: ProgressState,
  maxQueries: number,
): Promise<{ value: SearchCacheValue; cacheWrite?: { key: string; value: SearchCacheValue } }> {
  const cached = cache.get(cacheKey);
  if (cached) {
    state.cacheHits += 1;
    return { value: cached };
  }
  if (state.searchFailureCount >= 3) {
    const value: SearchCacheValue = {
      status: "error",
      candidates: [],
      reason: "bing_disabled_after_three_failures",
    };
    return { value };
  }
  if (state.searchQueries >= maxQueries) {
    const value: SearchCacheValue = {
      status: "capped",
      candidates: [],
      reason: "bing_query_budget_reached",
    };
    return { value };
  }
  state.searchQueries += 1;
  try {
    const candidates = await bingWebsiteLeads(row, apiKey);
    const value: SearchCacheValue = {
      status: candidates.length ? "leads" : "none",
      candidates,
      reason: candidates.length ? "search_results_are_leads_only" : "no_search_results",
    };
    cache.set(cacheKey, value);
    return { value, cacheWrite: { key: cacheKey, value } };
  } catch (error) {
    state.searchFailureCount += 1;
    const value: SearchCacheValue = {
      status: "error",
      candidates: [],
      reason: errorReason(error).slice(0, 160),
    };
    cache.set(cacheKey, value);
    return { value, cacheWrite: { key: cacheKey, value } };
  }
}

async function discoverOne(
  row: SourceRow,
  sector: SectorSelection,
  support: ReturnType<typeof makeSupportIndexes>,
  fetcher: PublicSiteFetcher,
  state: ProgressState,
  options: Options,
  apiKey: string,
  verificationCache: Map<string, CachedCheck>,
  sponsorListCache: Map<string, SponsorListCacheValue>,
  searchCache: Map<string, SearchCacheValue>,
): Promise<JournalEntry> {
  const sponsorKey = stableSponsorKey(row);
  const base = makeOutputBase(row);
  const attempts: Attempt[] = [];
  const diagnostics: string[] = [];
  const failures = new Set<string>();
  const cacheHitsAtStart = state.cacheHits;
  const allCandidates: WebsiteCandidate[] = [];
  const local = localWebsiteCandidates(row, support);
  diagnostics.push(...local.diagnostics);
  for (const candidate of local.candidates) addCandidate(allCandidates, candidate);

  const cacheKeys = {
    normalizedName: normalizeWebsiteName(clean(row.organisation_name)),
    emailDomain: emailDomain(row.existing_contact_email),
    existingWebsiteDomain:
      websiteCandidateFromValue(row.existing_website ?? "", "existing_website")?.domain ?? "",
    sponsorList: sponsorLookupKey(row),
    search: sponsorLookupKey(row),
  };
  let bestLow: { officialWebsiteUrl: string; evidenceUrl: string; source: string; reason: string } | null =
    null;
  let chosen: {
    candidate: WebsiteCandidate;
    result: CachedCheck;
    cacheHit: boolean;
  } | null = null;
  let stopForBudget = false;

  const tryCandidates = async (candidates: WebsiteCandidate[]) => {
    for (const candidate of candidates) {
      if (chosen || stopForBudget) break;
      const key = identityCacheKey(row, candidate);
      const cached = verificationCache.get(key);
      if (cached) {
        state.cacheHits += 1;
        const outcome =
          cached.outcome === "verified"
            ? "verified"
            : cached.outcome === "low"
              ? "low"
              : "rejected";
        attempts.push({
          domain: candidate.domain,
          source: candidate.source,
          outcome: "cache_hit",
          confidence: cached.confidence,
          officialWebsiteUrl: cached.officialWebsiteUrl,
          evidenceUrl: cached.evidenceUrl,
          reason: `domain_identity_cache:${outcome}:${cached.reason}`,
          cacheKey: key,
        });
        if (cached.outcome === "verified") {
          chosen = { candidate, result: cached, cacheHit: true };
        } else if (cached.outcome === "low" && !bestLow) {
          bestLow = {
            officialWebsiteUrl: "",
            evidenceUrl: cached.evidenceUrl,
            source: candidate.source,
            reason: cached.reason,
          };
          failures.add("identity_not_confirmed");
        } else if (cached.outcome === "rejected") {
          failures.add(cached.reason);
        }
        continue;
      }

      const fetched = await fetchPage(
        candidate,
        fetcher,
        state,
        options.maxPublicFetchCalls,
      );
      if (fetched.capped) {
        stopForBudget = true;
        failures.add("public_fetch_budget_reached");
        attempts.push({
          domain: candidate.domain,
          source: candidate.source,
          outcome: "capped",
          confidence: "none",
          officialWebsiteUrl: "",
          evidenceUrl: "",
          reason: fetched.error,
        });
        break;
      }
      if (!fetched.page) {
        const code = failureCode(fetched.error);
        failures.add(code);
        const cacheWrite: CachedCheck | undefined = cacheCheckIsPermanent(fetched.error)
          ? {
              outcome: "rejected",
              officialWebsiteUrl: "",
              evidenceUrl: "",
              confidence: "none",
              reason: code,
            }
          : undefined;
        if (cacheWrite) verificationCache.set(key, cacheWrite);
        attempts.push({
          domain: candidate.domain,
          source: candidate.source,
          outcome: "error",
          confidence: "none",
          officialWebsiteUrl: "",
          evidenceUrl: "",
          reason: code,
          ...(cacheWrite ? { cacheKey: key, cacheWrite } : {}),
        });
        continue;
      }

      const identity = verifyOfficialWebsiteIdentity(row, fetched.page);
      if (identity.accepted) {
        const cacheWrite: CachedCheck = {
          outcome: "verified",
          officialWebsiteUrl: originRoot(fetched.page.url),
          evidenceUrl: fetched.page.url,
          confidence: identity.confidence,
          reason: identity.reason,
        };
        verificationCache.set(key, cacheWrite);
        attempts.push({
          domain: candidate.domain,
          source: candidate.source,
          outcome: "verified",
          confidence: identity.confidence,
          officialWebsiteUrl: cacheWrite.officialWebsiteUrl,
          evidenceUrl: cacheWrite.evidenceUrl,
          reason: identity.reason,
          cacheKey: key,
          cacheWrite,
        });
        chosen = { candidate, result: cacheWrite, cacheHit: false };
        continue;
      }

      const cacheWrite: CachedCheck | undefined = identity.potential
        ? {
            outcome: "low",
            officialWebsiteUrl: "",
            evidenceUrl: fetched.page.url,
            confidence: "none",
            reason: identity.reason,
          }
        : undefined;
      if (cacheWrite) verificationCache.set(key, cacheWrite);
      failures.add("identity_not_confirmed");
      if (identity.potential && !bestLow) {
        bestLow = {
          officialWebsiteUrl: "",
          evidenceUrl: fetched.page.url,
          source: candidate.source,
          reason: identity.reason,
        };
      }
      attempts.push({
        domain: candidate.domain,
        source: candidate.source,
        outcome: identity.potential ? "low" : "rejected",
        confidence: "none",
        officialWebsiteUrl: "",
        evidenceUrl: fetched.page.url,
        reason: identity.reason,
        ...(cacheWrite ? { cacheKey: key, cacheWrite } : {}),
      });
    }
  };

  await tryCandidates(allCandidates);

  let sponsorListCacheWrite: JournalEntry["sponsorListCacheWrite"];
  if (!chosen && !stopForBudget) {
    const result = await fetchSponsorList(
      row,
      cacheKeys.sponsorList,
      sponsorListCache,
      fetcher,
      state,
      options,
    );
    if (result.cacheWrite) sponsorListCacheWrite = result.cacheWrite;
    if (result.value.status === "lead" && result.value.candidate) {
      await tryCandidates([result.value.candidate]);
    } else {
      failures.add(result.value.reason);
      if (result.value.status === "capped") {
        stopForBudget = true;
      }
    }
  }

  let searchCacheWrite: JournalEntry["searchCacheWrite"];
  if (
    !chosen &&
    !stopForBudget &&
    apiKey &&
    state.searchFailureCount < 3 &&
    state.searchQueries < options.maxSearchQueries
  ) {
    const result = await fetchBing(
      row,
      cacheKeys.search,
      apiKey,
      searchCache,
      state,
      options.maxSearchQueries,
    );
    if (result.cacheWrite) searchCacheWrite = result.cacheWrite;
    if (result.value.status === "leads") {
      await tryCandidates(result.value.candidates);
    } else if (result.value.status !== "capped") {
      failures.add(result.value.status === "error" ? "bing_search_error" : "bing_no_results");
    }
  } else if (!chosen && !stopForBudget && apiKey && state.searchQueries >= options.maxSearchQueries) {
    failures.add("bing_query_budget_reached");
  } else if (!chosen && !stopForBudget && apiKey && state.searchFailureCount >= 3) {
    failures.add("bing_disabled_after_three_failures");
  }

  if (stopForBudget) state.stopReason = "public request budget reached";
  // TypeScript does not track assignments made inside the async tryCandidates closure.
  const finalChosen = chosen as {
    candidate: WebsiteCandidate;
    result: CachedCheck;
    cacheHit: boolean;
  } | null;
  const finalBestLow = bestLow as {
    officialWebsiteUrl: string;
    evidenceUrl: string;
    source: string;
    reason: string;
  } | null;
  const output: OutputRow = {
    ...base,
    official_website_url: finalChosen?.result.officialWebsiteUrl ?? "",
    website_confidence: finalChosen?.result.confidence ?? (finalBestLow ? "low" : "unverified"),
    website_evidence_url: finalChosen?.result.evidenceUrl ?? finalBestLow?.evidenceUrl ?? "",
    source: finalChosen?.candidate.source ?? finalBestLow?.source ?? "",
    notes: [
      finalChosen
        ? `${finalChosen.result.reason}${finalChosen.cacheHit ? "; verified_domain_identity_cache_hit" : ""}`
        : finalBestLow
          ? `possible_lead_not_accepted:${finalBestLow.reason}`
          : "no_first_party_identity_verified",
      `attempt_count:${attempts.length}`,
      ...diagnostics.slice(0, 8),
    ]
      .filter(Boolean)
      .join("; ")
      .slice(0, 1_000),
  };

  return {
    sponsorKey,
    industry: sector.label,
    cacheKeys,
    output,
    attempts,
    failureCodes: [...failures],
    cacheHits: state.cacheHits - cacheHitsAtStart,
    ...(sponsorListCacheWrite ? { sponsorListCacheWrite } : {}),
    ...(searchCacheWrite ? { searchCacheWrite } : {}),
    completedAt: new Date().toISOString(),
  };
}

function setupProgress(
  signature: string,
  options: Options,
  sourceRows: SourceRow[],
  selections: SectorSelection[],
  excludedHealthcare: number,
  uniqueNonHealthcare: number,
  searchConfigured: boolean,
): ProgressState {
  const selectedRows = selections.reduce((sum, sector) => sum + sector.rows.length, 0);
  const now = new Date().toISOString();
  return {
    schemaVersion: RUN_SCHEMA_VERSION,
    signature,
    inputPath: options.input,
    inputRows: sourceRows.length,
    healthcareRowsExcluded: excludedHealthcare,
    nonHealthcareRows: sourceRows.length - excludedHealthcare,
    uniqueNonHealthcareRows: uniqueNonHealthcare,
    selectedRows,
    sectors: selections.map((sector) => ({
      label: sector.label,
      sourceCount: sector.sourceCount,
      selectedCount: sector.rows.length,
      capApplied: sector.capApplied,
      slug: sector.slug,
    })),
    processedCount: 0,
    publicFetchCalls: 0,
    siteFetchCalls: 0,
    sponsorListQueries: 0,
    searchQueries: 0,
    searchConfigured,
    searchFailureCount: 0,
    cacheHits: 0,
    startedAt: now,
    updatedAt: now,
    complete: false,
    stopReason: "",
    journalPath: options.journal,
    outputs: {
      combinedCsv: options.output,
      sectorDirectory: options.outputDir,
      report: options.report,
      progress: options.progress,
      journal: options.journal,
    },
  };
}

async function backupRunFiles(
  options: Options,
  selections: SectorSelection[],
): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const paths = [
    options.output,
    options.report,
    options.progress,
    options.journal,
    ...selections.map((sector) =>
      join(options.outputDir, `${sector.slug}-company-websites.csv`),
    ),
  ];
  for (const relative of paths) {
    await backupFile(absolutePath(relative), timestamp);
  }
}

async function run(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const [inputText, companySiteText, vacancySourceText] = await Promise.all([
    requiredTextFile(options.input),
    requiredTextFile(options.companySites),
    requiredTextFile(options.vacancySources),
  ]);
  const sourceRows = parseCsvObjects(inputText);
  const companySites = parseCsvObjects(companySiteText);
  const vacancySources = parseCsvObjects(vacancySourceText);
  const requiredHeaders = [
    "sponsor_licence_id",
    "organisation_name",
    "industry",
    "existing_website",
    "existing_contact_email",
    "existing_careers_url",
  ];
  const headers = new Set(Object.keys(sourceRows[0] ?? {}));
  const missingHeaders = requiredHeaders.filter((header) => !headers.has(header));
  if (missingHeaders.length) {
    throw new Error(`Sponsor export is missing required columns: ${missingHeaders.join(", ")}`);
  }

  const selection = selectNonHealthcareSectors(sourceRows, options.maxPerSector);
  const { sectors, uniqueNonHealthcareRows, healthcareRowsExcluded, duplicateRowsSkipped } =
    selection;
  const support = makeSupportIndexes(companySites, vacancySources);
  const selectedRows = sectors.flatMap((sector) =>
    sector.rows.map((row) => ({ sector, row })),
  );
  const signatureInput = {
    schemaVersion: RUN_SCHEMA_VERSION,
    inputHash: sha256(inputText),
    companySitesHash: sha256(companySiteText),
    vacancySourcesHash: sha256(vacancySourceText),
    maxPerSector: options.maxPerSector,
    delayMs: options.delayMs,
    maxPublicFetchCalls: options.maxPublicFetchCalls,
    maxSponsorListQueries: options.maxSponsorListQueries,
    maxSearchQueries: options.maxSearchQueries,
    searchConfigured: Boolean(process.env.BING_SEARCH_API_KEY),
    inputPath: options.input,
    output: options.output,
    outputDir: options.outputDir,
    report: options.report,
  };
  const signature = sha256(JSON.stringify(signatureInput));
  const apiKey = await readBingKey();
  const searchConfigured = Boolean(apiKey);
  const progressPath = absolutePath(options.progress);
  const journalPath = absolutePath(options.journal);
  const existingProgress = await readProgress(progressPath);

  if (options.fresh) {
    await backupRunFiles(options, sectors);
  } else if (existingProgress) {
    if (existingProgress.signature !== signature) {
      throw new Error(
        "Existing progress belongs to different inputs or options. Use --fresh to archive only these non-Healthcare output files.",
      );
    }
    if (existingProgress.complete) {
      console.log(
        `This exact run is already complete. Existing outputs remain at ${options.output} and ${options.report}.`,
      );
      return;
    }
  } else if (await exists(journalPath)) {
    throw new Error("A progress journal exists without its progress JSON. Use --fresh to archive it.");
  } else {
    const outputPaths = [
      options.output,
      options.report,
      ...sectors.map((sector) =>
        join(options.outputDir, `${sector.slug}-company-websites.csv`),
      ),
    ];
    for (const relative of outputPaths) {
      if (await exists(absolutePath(relative))) {
        throw new Error(
          `Output already exists: ${relative}. Use --fresh to archive this non-Healthcare run before starting again.`,
        );
      }
    }
  }

  await mkdir(dirname(journalPath), { recursive: true });
  let state =
    existingProgress && !options.fresh
      ? existingProgress
      : setupProgress(
          signature,
          options,
          sourceRows,
          sectors,
          healthcareRowsExcluded,
          uniqueNonHealthcareRows.length,
          searchConfigured,
        );
  if (state.signature !== signature) {
    throw new Error("Progress signature mismatch; refusing to mix output rows.");
  }
  state.searchConfigured = searchConfigured;
  if (!existingProgress || options.fresh) {
    state.updatedAt = new Date().toISOString();
    await writeAtomic(progressPath, `${JSON.stringify(state, null, 2)}\n`);
  }

  const journalEntries = options.fresh ? [] : await readJournal(journalPath);
  if (
    existingProgress &&
    !options.fresh &&
    existingProgress.processedCount > 0 &&
    !(await exists(journalPath))
  ) {
    throw new Error("Progress reports completed sponsors but its resume journal is missing.");
  }
  const caches = restoreCaches(journalEntries);
  const completedByKey = caches.completedByKey;
  const selectedKeys = new Set(selectedRows.map(({ row }) => stableSponsorKey(row)));
  for (const key of completedByKey.keys()) {
    if (!selectedKeys.has(key)) {
      throw new Error(`Progress journal includes a row outside the current selection: ${key}`);
    }
  }
  state.processedCount = [...completedByKey.keys()].filter((key) => selectedKeys.has(key)).length;
  state.publicFetchCalls = journalEntries.reduce(
    (sum, entry) =>
      sum +
      entry.attempts.filter(
        (attempt) => attempt.outcome !== "cache_hit" && attempt.outcome !== "capped",
      ).length +
      (entry.sponsorListCacheWrite ? 1 : 0),
    0,
  );
  state.siteFetchCalls = journalEntries.reduce(
    (sum, entry) =>
      sum +
      entry.attempts.filter(
        (attempt) =>
          attempt.outcome !== "cache_hit" &&
          attempt.outcome !== "capped" &&
          attempt.domain !== "sponsorlist.co.uk",
      ).length,
    0,
  );
  state.sponsorListQueries = journalEntries.filter((entry) => entry.sponsorListCacheWrite).length;
  state.searchQueries = journalEntries.filter((entry) => entry.searchCacheWrite).length;
  state.searchFailureCount = journalEntries.filter(
    (entry) => entry.searchCacheWrite?.value.status === "error",
  ).length;
  state.cacheHits = journalEntries.reduce((sum, entry) => sum + (entry.cacheHits ?? 0), 0);
  state.stopReason = "";

  let stopRequested = false;
  const requestStop = (signal: string) => {
    stopRequested = true;
    state.stopReason = `received ${signal}; will stop after the current sponsor`;
    console.log(state.stopReason);
  };
  const onSigint = () => requestStop("SIGINT");
  const onSigterm = () => requestStop("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  const fetcher = new PublicSiteFetcher(options.delayMs);
  let newlyCompleted = 0;
  const totalSelected = selectedRows.length;
  console.log(
    `Website-only run: ${totalSelected} selected across ${sectors.length} exact non-Healthcare labels; ${state.processedCount} already checkpointed; search ${searchConfigured ? "configured" : "not configured"}; concurrency 1.`,
  );
  try {
    for (let index = 0; index < selectedRows.length; index += 1) {
      const { sector, row } = selectedRows[index]!;
      if (stopRequested) break;
      const sponsorKey = stableSponsorKey(row);
      if (!completedByKey.has(sponsorKey)) {
        const entry = await discoverOne(
          row,
          sector,
          support,
          fetcher,
          state,
          options,
          apiKey,
          caches.verificationCache,
          caches.sponsorListCache,
          caches.searchCache,
        );
        await appendFile(journalPath, `${JSON.stringify(entry)}\n`, "utf8");
        completedByKey.set(sponsorKey, entry);
        newlyCompleted += 1;
        state.processedCount = completedByKey.size;

        if (newlyCompleted % CHECKPOINT_EVERY === 0) {
          const currentSector = displaySector(sector.label);
          console.log(
            `Processed ${state.processedCount}/${totalSelected}; current sector ${currentSector}; SponsorList queries ${state.sponsorListQueries}; search queries ${state.searchQueries}.`,
          );
          state.updatedAt = new Date().toISOString();
          await writeAtomic(
            progressPath,
            `${JSON.stringify(state, null, 2)}\n`,
          );
        }
      }
      if (state.stopReason === "public request budget reached") {
        stopRequested = true;
        break;
      }
      const next = selectedRows[index + 1];
      if (!next || next.sector.label !== sector.label) {
        await writeOutputsAndReport(
          state,
          sectors,
          sourceRows,
          support,
          completedByKey,
          searchConfigured,
          duplicateRowsSkipped,
        );
      }
    }

    const allProcessed = state.processedCount >= totalSelected;
    state.complete = allProcessed;
    if (allProcessed) state.stopReason = "";
    else if (!state.stopReason) state.stopReason = "run stopped before all selected sponsors completed";

    await writeOutputsAndReport(
      state,
      sectors,
      sourceRows,
      support,
      completedByKey,
      searchConfigured,
      duplicateRowsSkipped,
    );
    console.log(
      `${state.complete ? "Completed" : "Paused"}: ${state.processedCount}/${totalSelected} sponsors processed. Files: ${options.output}, ${options.report}, ${options.progress}.`,
    );
    if (!state.complete) {
      console.log(
        `Resume with: pnpm --filter @workspace/scripts non-healthcare-company-websites -- --resume`,
      );
    }
  } catch (error) {
    state.complete = false;
    state.stopReason = `runner_error:${errorReason(error).slice(0, 200)}`;
    await writeOutputsAndReport(
      state,
      sectors,
      sourceRows,
      support,
      completedByKey,
      searchConfigured,
      duplicateRowsSkipped,
    );
    throw error;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

export async function runNonHealthcareCompanyWebsiteDiscovery(
  args = process.argv.slice(2),
): Promise<void> {
  await run(args);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}