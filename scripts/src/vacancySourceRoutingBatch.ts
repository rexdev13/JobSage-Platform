import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCsvObjects,
  stringifyCsv,
} from "./sponsor-contact-discovery/csv";
import {
  createOfficialRecordMatcher,
  officialRecordsFromFile,
} from "./sponsor-contact-discovery/discovery";
import {
  PublicSiteFetcher,
  type PageResult,
} from "./sponsor-contact-discovery/http";
import type { SponsorInput } from "./sponsor-contact-discovery/types";
import { selectSponsorListLead } from "./healthcareSponsorWebsiteBatch";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "../..");
const fromRepository = (path: string) => resolve(REPOSITORY_ROOT, path);
const DEFAULT_INPUT = fromRepository(
  ".local/reports/sponsor-enrichment/jobsage-sponsor-base-export.csv",
);
const DEFAULT_CQC = fromRepository("scripts/data/cache/cqc-directory-2026-09-14.csv");
const DEFAULT_KNOWN_SITES = fromRepository(
  ".local/reports/sponsor-enrichment/jobsage-company-site-existing.csv",
);
const DEFAULT_KNOWN_SOURCES = fromRepository(
  ".local/reports/sponsor-enrichment/jobsage-existing-vacancy-sources.csv",
);
const DEFAULT_SEARCH_CACHE = fromRepository(
  ".local/reports/sponsor-enrichment/vacancy-source-routing-search-cache.json",
);
const DEFAULT_OUTPUT_DIR = fromRepository("artifacts");
const DEFAULT_PREVIOUS_BATCH = fromRepository(
  "artifacts/healthcare-vacancy-source-routing-batch1-100.csv",
);
const SPONSORLIST_API_URL = "https://sponsorlist.co.uk/wp-json/uks/v1/sponsors";
const SPONSORLIST_HOST = "sponsorlist.co.uk";
const SPONSORLIST_PREFLIGHT_QUERY = "JOBSAGE-routing-runner-preflight-no-employer";
const CQC_EVIDENCE_URL = "https://www.cqc.org.uk/about-us/transparency/using-cqc-data";
const DEFAULT_DELAY_MS = 1_500;
const MAX_FETCH_ATTEMPTS = 3;
const MAX_BATCH_SIZE = 500;
const MAX_PAGES_PER_EMPLOYER = 12;

export const VACANCY_SOURCE_ROUTING_COLUMNS = [
  "sponsor_licence_id",
  "organisation_name",
  "normalized_organisation_name",
  "town_city",
  "county",
  "region",
  "industry",
  "existing_website",
  "existing_careers_url",
  "existing_ats_provider",
  "existing_ats_board_id",
  "discovered_source_url",
  "source_pipeline",
  "source_type",
  "provider",
  "board_id",
  "sample_vacancy_url",
  "evidence_url",
  "confidence",
  "should_import",
  "search_used",
  "cache_hit",
  "attempt_count",
  "notes",
] as const;

export type VacancySourceRoutingRow = Record<
  (typeof VACANCY_SOURCE_ROUTING_COLUMNS)[number],
  string
>;
type SourceRow = Record<string, string>;

export type RoutingOptions = {
  input: string;
  sector: string;
  cqc: string;
  previousFile: string;
  outputDir: string;
  output: string;
  report: string;
  progress: string;
  unresolvedFile: string;
  baselineFile: string;
  knownSitesFile: string;
  knownSourcesFile: string;
  searchCacheFile: string;
  batchSize: number;
  offset: number;
  batchNumber: number;
  includeProcessed: boolean;
  resume: boolean;
  delayMs: number;
  searchEnabled: boolean;
  cacheEnabled: boolean;
  maxSearchesPerSponsor: number;
  maxTotalSearches: number;
  maxConcurrency: number;
};

export type RoutingSelection = {
  exactSectorRows: SourceRow[];
  uniqueSectorRows: SourceRow[];
  selectedRows: SourceRow[];
  duplicateIds: number;
  duplicateFallbackKeys: number;
  skippedPreviouslyProcessed: number;
  excludedByUnresolvedFilter: number;
  selectedStart: number;
  selectedWithPriorSiteError: number;
  selectedWithMissingSignals: number;
};

export type AtsDetails = {
  provider: string;
  boardId: string;
  platformConfirmed: boolean;
};

type FetchResult = {
  page: PageResult | null;
  attempts: number;
  retries: number;
  error: string;
  cacheHit: boolean;
};

type SearchHit = {
  url: string;
  title: string;
  snippet: string;
};

type RoutingResult = {
  row: VacancySourceRoutingRow;
  attempts: number;
  retries: number;
  failureClass: string;
  secondaryRoutes: string[];
  searchCount: number;
  cacheHits: number;
  robotsBlocked: number;
  identityFailures: number;
};

type ProgressFile = {
  schemaVersion: 2;
  sector: string;
  inputPath: string;
  inputSha256: string;
  cqcPath: string;
  cqcSha256: string;
  previousFilePath: string;
  previousFileSha256: string;
  unresolvedFilePath: string;
  unresolvedFileSha256: string;
  knownSitesFileSha256: string;
  knownSourcesFileSha256: string;
  batchSize: number;
  offset: number;
  batchNumber: number;
  includeProcessed: boolean;
  searchEnabled: boolean;
  cacheEnabled: boolean;
  maxSearchesPerSponsor: number;
  maxTotalSearches: number;
  maxConcurrency: number;
  selectedKeys: string[];
  updatedAt: string;
  rows: Record<string, RoutingResult>;
};

type SearchCacheFile = {
  schemaVersion: 1;
  searchQueries: Record<string, { query: string; cachedAt: string; hits: SearchHit[] }>;
  sponsorListQueries: Record<
    string,
    { query: string; cachedAt: string; records: Array<Record<string, unknown>> }
  >;
};

type DiscoveryRuntime = {
  options: RoutingOptions;
  searchConfigured: boolean;
  searchCache: SearchCacheFile;
  searchCacheLoaded: boolean;
  pageRequests: Map<string, Promise<FetchResult>>;
  searchFlights: Map<string, Promise<SearchResult>>;
  sponsorListFlights: Map<string, Promise<{
    records: Array<Record<string, unknown>>;
    attempts: number;
    retries: number;
    error: string;
    cacheHit: boolean;
  }>>;
  totalSearches: number;
  searchCacheHits: number;
  pageCacheHits: number;
  cacheWriteChain: Promise<void>;
};

type SearchResult = {
  hits: SearchHit[];
  attempts: number;
  retries: number;
  error: string;
  searchCount: number;
  cacheHits: number;
};

type WebsiteCandidate = {
  url: string;
  evidenceUrl: string;
  source: string;
};

type BoardCandidate = {
  url: string;
  evidenceUrl: string;
  details: AtsDetails;
  linkedFromOfficialSite: boolean;
};

type CareerEvidence = {
  page: PageResult;
  confidence: "high" | "medium";
  sampleVacancyUrl: string;
};

type CvEvidence = {
  pageUrl: string;
  email: string;
  formUrl: string;
};

const CAREER_WORDS =
  /\b(careers?|jobs?|vacancies|vacant|work with us|work for us|working for us|join us|join our team|recruit(?:ment|ing)?|opportunities)\b/i;
const JOB_DETAIL_WORDS =
  /\b(job|jobs|vacancy|vacancies|role|position|apply|application|opportunity)\b/i;
const EXPLICIT_CV_WORDS =
  /\b(send|email|submit|forward|upload|return|attach|provide)\b.{0,70}\b(cv|curriculum vitae|resume|résumé|application form)\b|\b(current vacancies|job applications|employment enquiries|employment inquiries)\b/i;
const CAREER_PATHS = [
  "/careers",
  "/jobs",
  "/vacancies",
  "/current-vacancies",
  "/join-us",
  "/join-our-team",
  "/work-for-us",
  "/working-for-us",
  "/recruitment",
  "/opportunities",
];
const GENERIC_IDENTITY_WORDS = new Set([
  "a", "an", "and", "at", "care", "centre", "centres", "clinic", "clinics",
  "company", "co", "dental", "dentistry", "doctor", "doctors", "group",
  "health", "healthcare", "home", "homes", "hospital", "hospitals",
  "limited", "ltd", "medical", "medicine", "nursing", "pharmacy", "practice",
  "practices", "services", "surgery", "surgeries", "the", "uk", "united",
  "kingdom",
]);
const BLOCKED_WEBSITE_HOSTS = [
  "cqc.org.uk",
  "nhs.uk",
  "gov.uk",
  "find-and-update.company-information.service.gov.uk",
  "companieshouse.gov.uk",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "yell.com",
  "yelp.com",
  "trustpilot.com",
  "open.endole.co.uk",
  "pharmdata.co.uk",
];
const BING_API_URL = "https://api.bing.microsoft.com/v7.0/search";

let lastBingSearchAt = 0;
let bingSearchQueue = Promise.resolve();

function text(row: SourceRow, key: string): string {
  return row[key]?.trim() ?? "";
}

export function normalizeRoutingName(value: string): string {
  return value.normalize("NFKC")
    .toLocaleLowerCase("en-GB")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableKey(row: SourceRow): string {
  const id = text(row, "sponsor_licence_id");
  if (id) return `id:${id}`;
  return `name-town:${normalizeRoutingName(text(row, "organisation_name"))}|${normalizeRoutingName(text(row, "town_city"))}`;
}

function sectorSignalsMissing(row: SourceRow): number {
  return [
    "existing_website",
    "existing_careers_url",
    "existing_ats_provider",
    "existing_ats_board_id",
  ].filter((column) => !text(row, column)).length;
}

function hasPriorSiteError(row: SourceRow): boolean {
  return Boolean(text(row, "last_company_site_error"));
}

export function selectRoutingRows(
  sourceRows: SourceRow[],
  sector: string,
  batchSize: number,
  offset: number,
  previousRows: SourceRow[] = [],
  includeProcessed = false,
  unresolvedKeys?: Set<string>,
): RoutingSelection {
  if (!sector.trim()) throw new Error("Sector must not be blank.");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`Batch size must be between 1 and ${MAX_BATCH_SIZE}.`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("Offset must be a non-negative integer.");
  }

  const exactSectorRows = sourceRows.filter((row) => text(row, "industry") === sector);
  const seen = new Set<string>();
  const uniqueSectorRows: SourceRow[] = [];
  let duplicateIds = 0;
  let duplicateFallbackKeys = 0;
  for (const row of exactSectorRows) {
    const id = text(row, "sponsor_licence_id");
    const key = stableKey(row);
    if (seen.has(key)) {
      if (id) duplicateIds += 1;
      else duplicateFallbackKeys += 1;
      continue;
    }
    if (!text(row, "organisation_name")) {
      throw new Error("An exact-sector input row has a blank organisation_name.");
    }
    seen.add(key);
    uniqueSectorRows.push(row);
  }

  const previousKeys = new Set(previousRows.map(stableKey));
  const processedCandidates = includeProcessed
    ? uniqueSectorRows
    : uniqueSectorRows.filter((row) => !previousKeys.has(stableKey(row)));
  const candidates = unresolvedKeys
    ? processedCandidates.filter((row) => unresolvedKeys.has(stableKey(row)))
    : processedCandidates;
  const skippedPreviouslyProcessed = uniqueSectorRows.length - processedCandidates.length;
  const excludedByUnresolvedFilter = processedCandidates.length - candidates.length;
  const indexed = candidates.map((row, sourceIndex) => ({
    row,
    sourceIndex,
    missing: sectorSignalsMissing(row),
    siteError: hasPriorSiteError(row),
    unverified: Number(/unverified|invalid|low|none/i.test(text(row, "existing_ats_mapping_status"))) +
      Number(/unverified|low|none/i.test(text(row, "website_confidence"))) +
      Number(/unverified|low|none/i.test(text(row, "careers_confidence"))),
  }));
  indexed.sort((left, right) =>
    right.missing - left.missing ||
    Number(right.siteError) - Number(left.siteError) ||
    right.unverified - left.unverified ||
    left.sourceIndex - right.sourceIndex,
  );
  const selected = indexed.slice(offset, offset + batchSize);
  return {
    exactSectorRows,
    uniqueSectorRows,
    selectedRows: selected.map(({ row }) => row),
    duplicateIds,
    duplicateFallbackKeys,
    skippedPreviouslyProcessed,
    excludedByUnresolvedFilter,
    selectedStart: selected.length ? offset + 1 : 0,
    selectedWithPriorSiteError: selected.filter(({ siteError }) => siteError).length,
    selectedWithMissingSignals: selected.filter(({ missing }) => missing > 0).length,
  };
}

export function atsDetails(value: string): AtsDetails | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const segments = url.pathname.split("/").filter(Boolean);
    const first = segments[0] ?? "";
    const lastLabel = host.split(".")[0] ?? "";
    const endsWith = (domain: string) => host === domain || host.endsWith(`.${domain}`);
    if (host === "jobs.ashbyhq.com" && first) {
      return { provider: "Ashby", boardId: first, platformConfirmed: true };
    }
    if ((host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") && first) {
      return { provider: "Greenhouse", boardId: first, platformConfirmed: true };
    }
    if (host === "jobs.lever.co" && first) {
      return { provider: "Lever", boardId: first, platformConfirmed: true };
    }
    if (endsWith("smartrecruiters.com")) {
      return {
        provider: "SmartRecruiters",
        boardId: first,
        platformConfirmed: true,
      };
    }
    if (endsWith("myworkdayjobs.com") || endsWith("workdayjobs.com")) {
      const tenant = host.split(".")[0] ?? "";
      return { provider: "Workday", boardId: tenant || first, platformConfirmed: true };
    }
    if (endsWith("teamtailor.com")) {
      return { provider: "Teamtailor", boardId: lastLabel, platformConfirmed: true };
    }
    if (endsWith("workable.com")) {
      const board = host === "apply.workable.com" ? first : lastLabel;
      return { provider: "Workable", boardId: board, platformConfirmed: true };
    }
    if (endsWith("pinpointhq.com")) {
      return { provider: "Pinpoint", boardId: lastLabel, platformConfirmed: true };
    }
    if (endsWith("bamboohr.com") && /jobs/i.test(url.pathname)) {
      return { provider: "BambooHR", boardId: lastLabel, platformConfirmed: true };
    }
    if (endsWith("successfactors.com") || endsWith("successfactors.eu")) {
      const boardId = url.searchParams.get("company") ?? first;
      return { provider: "SAP SuccessFactors", boardId, platformConfirmed: true };
    }
    if (host === "intasaccordcareers.com" || endsWith("intasaccordcareers.com")) {
      return {
        provider: "Accord Healthcare careers portal (underlying platform unconfirmed)",
        boardId: "",
        platformConfirmed: false,
      };
    }
    if (host === "apps.trac.jobs" || endsWith("trac.jobs")) {
      return { provider: "Trac Jobs", boardId: first, platformConfirmed: true };
    }
    if (host === "jobs.nhs.uk") {
      return { provider: "NHS Jobs", boardId: url.searchParams.get("employer") ?? "", platformConfirmed: true };
    }
    if (endsWith("indeed.com")) {
      return { provider: "Indeed", boardId: "", platformConfirmed: true };
    }
    if (endsWith("reed.co.uk")) {
      return { provider: "Reed", boardId: "", platformConfirmed: true };
    }
    if (endsWith("linkedin.com") && /\/jobs(?:\/|$)/i.test(url.pathname)) {
      return { provider: "LinkedIn Jobs", boardId: "", platformConfirmed: true };
    }
    if (endsWith("totaljobs.com")) {
      return { provider: "Totaljobs", boardId: "", platformConfirmed: true };
    }
    if (endsWith("cv-library.co.uk")) {
      return { provider: "CV-Library", boardId: "", platformConfirmed: true };
    }
    if (endsWith("glassdoor.co.uk") && /\/job/i.test(url.pathname)) {
      return { provider: "Glassdoor", boardId: "", platformConfirmed: true };
    }
    return null;
  } catch {
    return null;
  }
}

function secureHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (
      url.protocol !== "https:" ||
      !host.includes(".") ||
      url.username ||
      url.password ||
      BLOCKED_WEBSITE_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`))
    ) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

function htmlText(html: string): string {
  return decodeHtml(html
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " "));
}

type Anchor = { href: string; label: string; sourceUrl: string; raw: string };

function extractAnchors(html: string, pageUrl: string): Anchor[] {
  const result: Anchor[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const attributes = match[1] ?? "";
    const hrefMatch = attributes.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const rawHref = decodeHtml(hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "").trim();
    const label = `${htmlText(match[2] ?? "")} ${attributes.match(/\b(?:title|aria-label)\s*=\s*(?:"([^"]*)"|'([^']*)')/i)?.[1] ?? ""}`
      .replace(/\s+/g, " ")
      .trim();
    try {
      const url = new URL(rawHref, pageUrl);
      if (url.protocol !== "https:" || url.username || url.password) continue;
      result.push({ href: url.toString(), label, sourceUrl: pageUrl, raw: match[0] });
    } catch {
      // Ignore malformed and non-navigation anchors.
    }
  }
  return result;
}

function identityTokens(organisationName: string): string[] {
  return [...new Set(normalizeRoutingName(organisationName)
    .split(" ")
    .filter((token) => token.length >= 3 && !GENERIC_IDENTITY_WORDS.has(token)))];
}

function identityTokenGroups(organisationName: string): string[][] {
  const variants = organisationName
    .split(/\bt\s*\/\s*a\b|\btrading\s+as\b|\balso\s+known\s+as\b|\baka\b/i)
    .map((variant) => identityTokens(variant))
    .filter((tokens) => tokens.length > 0);
  return variants.length ? variants : [identityTokens(organisationName)];
}

export function verifyEmployerIdentity(
  source: SourceRow,
  page: PageResult,
): { accepted: boolean; confidence: "high" | "medium" | "none"; reason: string } {
  const tokenGroups = identityTokenGroups(text(source, "organisation_name"));
  if (tokenGroups.every((tokens) => tokens.length === 0)) {
    return { accepted: false, confidence: "none", reason: "organisation has no distinctive identity token" };
  }
  const body = normalizeRoutingName(htmlText(page.body));
  const host = normalizeRoutingName(new URL(page.url).hostname);
  const matches = tokenGroups.map((tokens) => ({
    page: tokens.filter((token) => body.includes(token)),
    host: tokens.filter((token) => host.includes(token)),
  })).filter((match) => match.page.length > 0);
  const best = matches.sort((left, right) =>
    (right.page.length + right.host.length) - (left.page.length + left.host.length),
  )[0];
  if (!best || (best.host.length === 0 && best.page.length < 2)) {
    return { accepted: false, confidence: "none", reason: "employer identity was not corroborated on the page" };
  }
  const locationTerms = [text(source, "town_city"), text(source, "county")]
    .map(normalizeRoutingName)
    .filter((value) => value.length >= 4);
  const locationMatches = locationTerms.some((value) => body.includes(value));
  return {
    accepted: true,
    confidence: locationMatches && (best.page.length >= 2 || best.host.length > 0)
      ? "high"
      : "medium",
    reason: locationMatches
      ? "distinctive employer identity and stored location corroborated"
      : "distinctive employer identity corroborated; location not present on the page",
  };
}

function looksLikeHiringPage(page: PageResult): boolean {
  return CAREER_WORDS.test(`${page.url} ${htmlText(page.body)}`) ||
    JOB_DETAIL_WORDS.test(`${page.url} ${htmlText(page.body)}`);
}

function sampleVacancyOnPage(page: PageResult): string {
  if (explicitSampleVacancy(page.url)) return page.url;
  const host = new URL(page.url).hostname;
  return extractAnchors(page.body, page.url)
    .find((anchor) =>
      sameSite(new URL(anchor.href).hostname, host) &&
      JOB_DETAIL_WORDS.test(`${anchor.label} ${anchor.href}`) &&
      explicitSampleVacancy(anchor.href),
    )?.href ?? "";
}

function makeBaseRow(source: SourceRow): VacancySourceRoutingRow {
  return {
    sponsor_licence_id: text(source, "sponsor_licence_id"),
    organisation_name: text(source, "organisation_name"),
    normalized_organisation_name: text(source, "normalized_organisation_name") ||
      normalizeRoutingName(text(source, "organisation_name")),
    town_city: text(source, "town_city"),
    county: text(source, "county"),
    region: text(source, "region"),
    industry: text(source, "industry"),
    existing_website: text(source, "existing_website"),
    existing_careers_url: text(source, "existing_careers_url"),
    existing_ats_provider: text(source, "existing_ats_provider"),
    existing_ats_board_id: text(source, "existing_ats_board_id"),
    discovered_source_url: "",
    source_pipeline: "unverified",
    source_type: "unverified",
    provider: "",
    board_id: "",
    sample_vacancy_url: "",
    evidence_url: "",
    confidence: "unverified",
    should_import: "no_unverified",
    search_used: "no",
    cache_hit: "no",
    attempt_count: "0",
    notes: "",
  };
}

function sponsorInput(source: SourceRow): SponsorInput {
  return {
    organisationName: text(source, "organisation_name"),
    townCity: text(source, "town_city"),
    county: text(source, "county"),
    industry: text(source, "industry"),
    website: text(source, "existing_website"),
    contactEmail: text(source, "existing_contact_email"),
    postcode: text(source, "postcode"),
  };
}

const PUBLIC_EMAIL_HOSTS = new Set([
  "aol.com", "btinternet.com", "fastmail.com", "gmail.com", "gmx.com", "gmx.co.uk",
  "hotmail.com", "hotmail.co.uk", "icloud.com", "live.com", "mail.com", "me.com",
  "outlook.com", "outlook.co.uk", "proton.me", "protonmail.com", "yahoo.com",
  "yahoo.co.uk", "ymail.com",
]);

function contactEmailDomainCandidate(source: SourceRow): WebsiteCandidate | null {
  const email = text(source, "existing_contact_email");
  const match = email.match(/^[^@\s]+@([^@\s]+)$/);
  const domain = match?.[1]?.toLowerCase().replace(/^www\./, "");
  if (!domain || PUBLIC_EMAIL_HOSTS.has(domain) ||
      domain.endsWith(".gov.uk") || domain.endsWith(".nhs.uk") ||
      domain.endsWith(".onmicrosoft.com")) return null;
  const url = secureHttpsUrl(`https://${domain}/`);
  return url ? { url, evidenceUrl: url, source: "Existing contact-email domain lead" } : null;
}

function uniqueExactNameMatch(source: SourceRow, rows: SourceRow[]): SourceRow | null {
  const name = normalizeRoutingName(text(source, "organisation_name"));
  if (!name) return null;
  const matches = rows.filter((row) =>
    normalizeRoutingName(text(row, "organisation_name")) === name,
  );
  return matches.length === 1 ? matches[0]! : null;
}

function knownSourceCandidates(
  source: SourceRow,
  companySiteRows: SourceRow[],
  vacancySourceRows: SourceRow[],
  baselineRow?: SourceRow,
): { websites: WebsiteCandidate[]; boards: BoardCandidate[] } {
  const websites: WebsiteCandidate[] = [];
  const boards: BoardCandidate[] = [];
  const addWebsite = (value: string, evidenceUrl: string, sourceLabel: string) => {
    const candidate = makeCandidateFromExistingUrl(value, sourceLabel);
    if (candidate && !websites.some((item) => normalizedRequestUrl(item.url) === normalizedRequestUrl(candidate.url))) {
      websites.push({ ...candidate, evidenceUrl: evidenceUrl || candidate.evidenceUrl });
    }
  };
  const addBoard = (value: string, evidenceUrl: string, linkedFromOfficialSite: boolean) => {
    const details = atsDetails(value);
    const url = secureHttpsUrl(value);
    if (details && url && !boards.some((item) => normalizedRequestUrl(item.url) === normalizedRequestUrl(url))) {
      boards.push({ url, evidenceUrl: evidenceUrl || url, details, linkedFromOfficialSite });
    }
  };

  const previousSite = text(baselineRow ?? {}, "discovered_source_url") ||
    text(baselineRow ?? {}, "evidence_url");
  if (previousSite) {
    if (atsDetails(previousSite)) addBoard(previousSite, previousSite, false);
    else addWebsite(previousSite, previousSite, "Previously identity-checked batch source");
  }

  const companySite = uniqueExactNameMatch(source, companySiteRows);
  if (companySite) {
    const careersUrl = text(companySite, "careers_url");
    if (careersUrl) {
      if (atsDetails(careersUrl)) addBoard(
        careersUrl,
        text(companySite, "ats_mapping_evidence_url") || careersUrl,
        text(companySite, "ats_mapping_status") === "verified",
      );
      else addWebsite(careersUrl, careersUrl, "Exact-name company-site cache lead");
    }
  }

  const sourceMatch = uniqueExactNameMatch(source, vacancySourceRows);
  if (sourceMatch && text(sourceMatch, "latest_verification_status").toLowerCase() === "live") {
    const sampleUrl = text(sourceMatch, "sample_detail_url") ||
      text(sourceMatch, "sample_application_url");
    const sourceType = text(sourceMatch, "source_type").toLowerCase();
    if (sampleUrl && atsDetails(sampleUrl)) {
      addBoard(sampleUrl, sampleUrl, false);
    } else if (sampleUrl && sourceType === "company_site") {
      const safe = secureHttpsUrl(sampleUrl);
      const host = safe ? new URL(safe).hostname : "";
      const priorHost = previousSite && secureHttpsUrl(previousSite)
        ? new URL(secureHttpsUrl(previousSite)!).hostname
        : "";
      const siteTokens = identityTokens(text(source, "organisation_name"));
      const hostMatchesName = siteTokens.some((token) =>
        normalizeRoutingName(host).includes(token),
      );
      const alreadyIdentityCheckedHost = Boolean(host && priorHost && sameSite(host, priorHost));
      if (safe && (hostMatchesName || alreadyIdentityCheckedHost)) {
        addWebsite(safe, safe, "Verified known company-site vacancy-source lead");
      }
    }
  }
  return { websites, boards };
}

function retryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP (?:408|425|429|5\d\d)|timed? ?out|timeout|fetch failed|ECONNRESET|EAI_AGAIN|socket/i.test(message);
}

async function fetchWithRetry(
  fetcher: PublicSiteFetcher,
  url: string,
  confirmedHost: string,
  runtime?: DiscoveryRuntime,
): Promise<FetchResult> {
  const cacheKey = normalizedRequestUrl(url);
  if (runtime?.options.cacheEnabled) {
    const cachedRequest = runtime.pageRequests.get(cacheKey);
    if (cachedRequest) {
      const cached = await cachedRequest;
      runtime.pageCacheHits += 1;
      return { ...cached, attempts: 0, retries: 0, cacheHit: true };
    }
    const request = fetchWithRetryUncached(fetcher, url, confirmedHost);
    runtime.pageRequests.set(cacheKey, request);
    return { ...(await request), cacheHit: false };
  }
  return fetchWithRetryUncached(fetcher, url, confirmedHost);
}

function normalizedRequestUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim();
  }
}

async function fetchWithRetryUncached(
  fetcher: PublicSiteFetcher,
  url: string,
  confirmedHost: string,
): Promise<FetchResult> {
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    try {
      return {
        page: await fetcher.fetch(url, confirmedHost),
        attempts: attempt,
        retries: attempt - 1,
        error: "",
        cacheHit: false,
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt >= MAX_FETCH_ATTEMPTS || !retryable(error)) {
        return { page: null, attempts: attempt, retries: attempt - 1, error: lastError, cacheHit: false };
      }
      await new Promise((resolveDelay) =>
        setTimeout(resolveDelay, Math.min(8_000, 1_000 * 2 ** (attempt - 1))),
      );
    }
  }
  return {
    page: null,
    attempts: MAX_FETCH_ATTEMPTS,
    retries: MAX_FETCH_ATTEMPTS - 1,
    error: lastError,
    cacheHit: false,
  };
}

function sponsorListUrl(searchTerm: string): string {
  const url = new URL(SPONSORLIST_API_URL);
  url.searchParams.set("search", searchTerm);
  url.searchParams.set("per_page", "100");
  return url.toString();
}

const LOOKUP_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

function createEmptySearchCache(): SearchCacheFile {
  return { schemaVersion: 1, searchQueries: {}, sponsorListQueries: {} };
}

function cacheEntryIsFresh(cachedAt: string): boolean {
  const timestamp = Date.parse(cachedAt);
  return Number.isFinite(timestamp) && Date.now() - timestamp < LOOKUP_CACHE_TTL_MS;
}

function lookupCacheKey(provider: string, query: string): string {
  return sha256(`${provider}:${normalizeRoutingName(query)}`);
}

function saveSearchCache(runtime: DiscoveryRuntime): Promise<void> {
  if (!runtime.options.cacheEnabled) return Promise.resolve();
  const snapshot = `${JSON.stringify(runtime.searchCache, null, 2)}\n`;
  runtime.cacheWriteChain = runtime.cacheWriteChain.then(() =>
    atomicReplace(runtime.options.searchCacheFile, snapshot),
  );
  return runtime.cacheWriteChain;
}

async function sponsorListSearch(
  fetcher: PublicSiteFetcher,
  searchTerm: string,
  runtime?: DiscoveryRuntime,
  cacheable = true,
): Promise<{
  records: Array<Record<string, unknown>>;
  attempts: number;
  retries: number;
  error: string;
  cacheHit: boolean;
}> {
  const normalizedQuery = normalizeRoutingName(searchTerm);
  const cacheKey = lookupCacheKey("sponsorlist", normalizedQuery);
  if (runtime?.options.cacheEnabled && cacheable) {
    const cached = runtime.searchCache.sponsorListQueries[cacheKey];
    if (cached && cacheEntryIsFresh(cached.cachedAt)) {
      runtime.searchCacheHits += 1;
      return { records: cached.records, attempts: 0, retries: 0, error: "", cacheHit: true };
    }
    const inFlight = runtime.sponsorListFlights.get(cacheKey);
    if (inFlight) {
      const shared = await inFlight;
      runtime.searchCacheHits += 1;
      return { ...shared, attempts: 0, retries: 0, cacheHit: true };
    }
  }

  const request = (async () => {
    const fetched = await fetchWithRetry(fetcher, sponsorListUrl(searchTerm), SPONSORLIST_HOST, runtime);
    if (!fetched.page) {
      return {
        records: [],
        attempts: fetched.attempts,
        retries: fetched.retries,
        error: fetched.error,
        cacheHit: fetched.cacheHit,
      };
    }
    try {
      const payload = JSON.parse(fetched.page.body) as { sponsors?: Array<Record<string, unknown>> };
      if (!Array.isArray(payload.sponsors)) {
        return {
          records: [],
          attempts: fetched.attempts,
          retries: fetched.retries,
          error: "SponsorList response did not contain a sponsors array",
          cacheHit: fetched.cacheHit,
        };
      }
      const records = payload.sponsors.map((sponsor) => {
        const enrichment = sponsor.enrichment && typeof sponsor.enrichment === "object"
          ? sponsor.enrichment as Record<string, unknown>
          : {};
        return {
          name: typeof sponsor.name === "string" ? sponsor.name : "",
          city: typeof sponsor.city === "string" ? sponsor.city : "",
          county: typeof sponsor.county === "string" ? sponsor.county : "",
          url: typeof sponsor.url === "string" ? sponsor.url : "",
          enrichment: {
            website: typeof enrichment.website === "string" ? enrichment.website : "",
          },
        };
      });
      const result = {
        records,
        attempts: fetched.attempts,
        retries: fetched.retries,
        error: "",
        cacheHit: fetched.cacheHit,
      };
      if (runtime?.options.cacheEnabled && cacheable) {
        runtime.searchCache.sponsorListQueries[cacheKey] = {
          query: normalizedQuery,
          cachedAt: new Date().toISOString(),
          records: result.records,
        };
        await saveSearchCache(runtime);
      }
      return result;
    } catch (error) {
      return {
        records: [],
        attempts: fetched.attempts,
        retries: fetched.retries,
        error: `invalid SponsorList JSON: ${String(error)}`,
        cacheHit: fetched.cacheHit,
      };
    }
  })();
  if (runtime?.options.cacheEnabled && cacheable) {
    runtime.sponsorListFlights.set(cacheKey, request);
  }
  try {
    return await request;
  } finally {
    runtime?.sponsorListFlights.delete(cacheKey);
  }
}

async function verifySearchAvailability(
  fetcher: PublicSiteFetcher,
  bingConfigured: boolean,
  runtime: DiscoveryRuntime,
): Promise<{ sponsorListAvailable: boolean; message: string; attempts: number; retries: number }> {
  const preflight = await sponsorListSearch(fetcher, SPONSORLIST_PREFLIGHT_QUERY, runtime, false);
  if (!preflight.error) {
    return {
      sponsorListAvailable: true,
      message: bingConfigured && runtime.options.searchEnabled
        ? "SponsorList available; optional Bing search configured"
        : "SponsorList available; web search disabled or not configured",
      attempts: preflight.attempts,
      retries: preflight.retries,
    };
  }
  if (bingConfigured) {
    return {
      sponsorListAvailable: false,
      message: runtime.options.searchEnabled
        ? `SponsorList unavailable; optional Bing search configured (${preflight.error})`
        : `SponsorList unavailable; web search disabled (${preflight.error})`,
      attempts: preflight.attempts,
      retries: preflight.retries,
    };
  }
  return {
    sponsorListAvailable: false,
    message: `SponsorList unavailable; Bing search not configured, continuing with local and first-party checks (${preflight.error})`,
    attempts: preflight.attempts,
    retries: preflight.retries,
  };
}

async function sponsorListCandidate(
  source: SourceRow,
  fetcher: PublicSiteFetcher,
  enabled: boolean,
  runtime: DiscoveryRuntime,
): Promise<{
  candidate: WebsiteCandidate | null;
  attempts: number;
  retries: number;
  error: string;
  cacheHit: boolean;
}> {
  if (!enabled) {
    return { candidate: null, attempts: 0, retries: 0, error: "SponsorList unavailable", cacheHit: false };
  }
  const result = await sponsorListSearch(fetcher, text(source, "organisation_name"), runtime);
  if (result.error) {
    return {
      candidate: null,
      attempts: result.attempts,
      retries: result.retries,
      error: result.error,
      cacheHit: result.cacheHit,
    };
  }
  const lead = selectSponsorListLead(source, result.records as Array<{
    name?: string;
    city?: string;
    county?: string;
    url?: string;
    enrichment?: { website?: string };
  }>);
  return {
    candidate: lead
      ? { url: lead.website, evidenceUrl: lead.evidenceUrl, source: "SponsorList exact-name/location lead" }
      : null,
    attempts: result.attempts,
    retries: result.retries,
    error: "",
    cacheHit: result.cacheHit,
  };
}

function bingQueriesForSponsor(source: SourceRow): string[] {
  const quote = (value: string) => `"${value.replace(/"/g, " ").replace(/\s+/g, " ").trim()}"`;
  const name = text(source, "organisation_name");
  const location = [text(source, "town_city"), text(source, "county")].filter(Boolean).join(" ");
  const place = location ? ` ${quote(location)}` : "";
  return [
    `${quote(name)}${place} (careers OR jobs OR vacancies)`,
    `${quote(name)}${place} (recruitment OR "send CV" OR apply)`,
  ];
}

async function waitForBingTurn(delayMs: number): Promise<void> {
  let release = () => {};
  const previous = bingSearchQueue;
  bingSearchQueue = new Promise<void>((resolveQueue) => { release = resolveQueue; });
  await previous;
  try {
    const elapsed = Date.now() - lastBingSearchAt;
    if (elapsed < delayMs) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs - elapsed));
    }
    lastBingSearchAt = Date.now();
  } finally {
    release();
  }
}

async function bingSearch(
  query: string,
  delayMs: number,
  runtime: DiscoveryRuntime,
): Promise<SearchResult> {
  if (!runtime.searchConfigured || !runtime.options.searchEnabled) {
    return {
      hits: [],
      attempts: 0,
      retries: 0,
      error: runtime.searchConfigured ? "web search disabled by configuration" : "Bing is not configured",
      searchCount: 0,
      cacheHits: 0,
    };
  }
  const cacheKey = lookupCacheKey("bing", query);
  if (runtime.options.cacheEnabled) {
    const cached = runtime.searchCache.searchQueries[cacheKey];
    if (cached && cacheEntryIsFresh(cached.cachedAt)) {
      runtime.searchCacheHits += 1;
      return { hits: cached.hits, attempts: 0, retries: 0, error: "", searchCount: 0, cacheHits: 1 };
    }
  }
  const inFlight = runtime.searchFlights.get(cacheKey);
  if (inFlight) {
    await inFlight;
    runtime.searchCacheHits += 1;
    return { ...(await inFlight), attempts: 0, retries: 0, searchCount: 0, cacheHits: 1 };
  }
  if (runtime.totalSearches >= runtime.options.maxTotalSearches) {
    return {
      hits: [],
      attempts: 0,
      retries: 0,
      error: "total web-search budget reached",
      searchCount: 0,
      cacheHits: 0,
    };
  }

  const request = (async (): Promise<SearchResult> => {
    const key = process.env.BING_SEARCH_API_KEY;
    if (!key) {
      return {
        hits: [],
        attempts: 0,
        retries: 0,
        error: "Bing is not configured",
        searchCount: 0,
        cacheHits: 0,
      };
    }
    runtime.totalSearches += 1;
    await waitForBingTurn(delayMs);
    const url = new URL(BING_API_URL);
    url.search = new URLSearchParams({ q: query, count: "10", safeSearch: "Strict" }).toString();
    let lastError = "";
    for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: { "Ocp-Apim-Subscription-Key": key, Accept: "application/json" },
          signal: AbortSignal.timeout(12_000),
        });
        if (!response.ok) {
          lastError = `HTTP ${response.status}`;
          if (attempt < MAX_FETCH_ATTEMPTS && retryable(new Error(lastError))) {
            await new Promise((resolveDelay) =>
              setTimeout(resolveDelay, Math.min(8_000, 1_000 * 2 ** (attempt - 1))),
            );
            continue;
          }
          return {
            hits: [],
            attempts: attempt,
            retries: attempt - 1,
            error: lastError,
            searchCount: 1,
            cacheHits: 0,
          };
        }
        const result = await response.json() as {
          webPages?: { value?: Array<{ url?: string; name?: string; snippet?: string }> };
        };
        const hits = (result.webPages?.value ?? [])
          .filter((hit) => Boolean(hit.url))
          .map((hit) => ({ url: hit.url!, title: hit.name ?? "", snippet: hit.snippet ?? "" }));
        if (runtime.options.cacheEnabled) {
          runtime.searchCache.searchQueries[cacheKey] = {
            query,
            cachedAt: new Date().toISOString(),
            hits,
          };
          await saveSearchCache(runtime);
        }
        return {
          hits,
          attempts: attempt,
          retries: attempt - 1,
          error: "",
          searchCount: 1,
          cacheHits: 0,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (attempt >= MAX_FETCH_ATTEMPTS || !retryable(error)) {
          return {
            hits: [],
            attempts: attempt,
            retries: attempt - 1,
            error: lastError,
            searchCount: 1,
            cacheHits: 0,
          };
        }
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, Math.min(8_000, 1_000 * 2 ** (attempt - 1))),
        );
      }
    }
    return {
      hits: [],
      attempts: MAX_FETCH_ATTEMPTS,
      retries: MAX_FETCH_ATTEMPTS - 1,
      error: lastError,
      searchCount: 1,
      cacheHits: 0,
    };
  })();
  runtime.searchFlights.set(cacheKey, request);
  try {
    return await request;
  } finally {
    runtime.searchFlights.delete(cacheKey);
  }
}

function searchHitMentionsEmployer(source: SourceRow, hit: SearchHit): boolean {
  const evidence = normalizeRoutingName(`${hit.title} ${hit.snippet}`);
  return identityTokenGroups(text(source, "organisation_name"))
    .some((group) => group.some((token) => evidence.includes(token)));
}

function sameSite(hostname: string, baseHost: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  const base = baseHost.toLowerCase().replace(/^www\./, "");
  return host === base || host.endsWith(`.${base}`);
}

function makeCandidateFromExistingUrl(
  value: string,
  source: string,
): WebsiteCandidate | null {
  const safe = secureHttpsUrl(value);
  return safe ? { url: safe, evidenceUrl: safe, source } : null;
}

function careersPathCandidate(website: string, path: string): string {
  const url = new URL(website);
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function shouldInspectLink(anchor: Anchor, employerHost: string): boolean {
  try {
    const url = new URL(anchor.href);
    if (atsDetails(anchor.href)) return true;
    if (sameSite(url.hostname, employerHost)) {
      return CAREER_WORDS.test(`${anchor.label} ${anchor.href}`) ||
        JOB_DETAIL_WORDS.test(`${anchor.label} ${anchor.href}`);
    }
    return JOB_DETAIL_WORDS.test(`${anchor.label} ${anchor.href}`) &&
      identityTokens(url.hostname).some((token) =>
        identityTokens(anchor.href).includes(token),
      );
  } catch {
    return false;
  }
}

function extractCvEvidence(page: PageResult): CvEvidence | null {
  const visibleText = htmlText(page.body);
  if (!EXPLICIT_CV_WORDS.test(visibleText)) return null;
  const emailMatches = [...page.body.matchAll(/\bhref\s*=\s*(?:"mailto:([^"'?#>]+)[^"]*"|'mailto:([^'?#>]+)[^']*')/gi)]
    .map((match) => decodeHtml(match[1] ?? match[2] ?? "").split("?")[0]?.trim().toLowerCase() ?? "")
    .filter((email) => /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email));
  const anchors = extractAnchors(page.body, page.url);
  const cvForm = anchors.find((anchor) =>
    /cv|curriculum vitae|application form|send.*application|submit.*application/i.test(
      `${anchor.label} ${anchor.href}`,
    ),
  );
  if (emailMatches[0]) return { pageUrl: page.url, email: emailMatches[0], formUrl: "" };
  if (cvForm) return { pageUrl: page.url, email: "", formUrl: cvForm.href };
  return null;
}

export function explicitSampleVacancy(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const segments = url.pathname.toLowerCase().split("/").filter(Boolean);
  if (segments.length === 0) return false;
  const listingPages = new Set([
    "all", "all-jobs", "careers", "current", "current-jobs", "current-vacancies",
    "employment", "job-list", "job-search", "jobs", "open-roles", "opportunities",
    "search", "vacancies", "work-for-us",
  ]);
  const roleMarkers = new Set(["job", "jobs", "position", "positions", "role", "roles", "vacancy", "vacancies"]);
  const isGenericApplicationPath = (segment: string) =>
    /^(?:job[-_]application(?:[-_]form)?|application[-_]form|apply(?:[-_]now)?)$/i.test(segment);
  const genericApplicationIndex = segments.findIndex(isGenericApplicationPath);
  if (
    genericApplicationIndex >= 0 &&
    !segments.slice(0, genericApplicationIndex).some((segment, index) =>
      roleMarkers.has(segment) &&
      index + 1 < genericApplicationIndex &&
      !listingPages.has(segments[index + 1]!) &&
      !isGenericApplicationPath(segments[index + 1]!),
    )
  ) {
    return false;
  }
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (roleMarkers.has(segments[index]!) && !listingPages.has(segments[index + 1]!)) {
      return true;
    }
  }
  if (
    /\/(?:job|position|role|vacancy)[-_][a-z0-9][a-z0-9-]{2,}(?:\/|$)/i.test(url.pathname) &&
    !listingPages.has(segments.at(-1)!)
  ) {
    return true;
  }
  if (/\/viewjob\/?$/i.test(url.pathname)) {
    return [...url.searchParams.entries()].some(([key, id]) =>
      /^(?:jk|jobid|job_id|positionid|requisitionid)$/i.test(key) && id.trim().length >= 4,
    );
  }
  return false;
}

function recommendation(confidence: "high" | "medium" | "low" | "unverified"): string {
  if (confidence === "high") return "yes_high_confidence";
  if (confidence === "medium") return "review_medium_confidence";
  if (confidence === "low") return "no_low_confidence";
  return "no_unverified";
}

function setAcceptedRoute(
  row: VacancySourceRoutingRow,
  values: {
    pipeline: "company_website" | "job_board" | "send_cv";
    sourceType: string;
    provider?: string;
    boardId?: string;
    sampleVacancyUrl?: string;
    discoveredSourceUrl: string;
    evidenceUrl: string;
    confidence: "high" | "medium" | "low";
  },
): void {
  row.source_pipeline = values.pipeline;
  row.source_type = values.sourceType;
  row.provider = values.provider ?? "";
  row.board_id = values.boardId ?? "";
  row.sample_vacancy_url = values.sampleVacancyUrl ?? "";
  row.discovered_source_url = values.discoveredSourceUrl;
  row.evidence_url = values.evidenceUrl;
  row.confidence = values.confidence;
  row.should_import = recommendation(values.confidence);
}

function commonFailureClass(reasons: string[]): string {
  if (reasons.some((reason) => /robots|could not be safely checked|private or unresolved/i.test(reason))) {
    return "robots_or_policy_block";
  }
  if (reasons.some((reason) => /HTTP|timed? ?out|timeout|fetch failed|unreachable/i.test(reason))) {
    return "source_unreachable";
  }
  if (reasons.some((reason) => /identity|mismatch|corroborated/i.test(reason))) {
    return "identity_not_confirmed";
  }
  if (reasons.some((reason) => /SponsorList|search provider/i.test(reason))) {
    return "search_source_unavailable_or_no_match";
  }
  return "no_verified_hiring_route";
}

async function verifyBoardCandidate(
  candidate: BoardCandidate,
  source: SourceRow,
  fetcher: PublicSiteFetcher,
  identityConfidence: "high" | "medium",
  runtime: DiscoveryRuntime,
): Promise<{
  accepted: boolean;
  details: AtsDetails;
  page: PageResult | null;
  confidence: "high" | "medium";
  sampleVacancyUrl: string;
  attempts: number;
  retries: number;
  cacheHit: boolean;
  reason: string;
}> {
  const host = new URL(candidate.url).hostname;
  const fetched = await fetchWithRetry(fetcher, candidate.url, host, runtime);
  if (!fetched.page) {
    return {
      accepted: false,
      details: candidate.details,
      page: null,
      confidence: identityConfidence,
      sampleVacancyUrl: "",
      attempts: fetched.attempts,
      retries: fetched.retries,
      cacheHit: fetched.cacheHit,
      reason: `linked board could not be safely checked: ${fetched.error}`,
    };
  }
  const boardIdentity = verifyEmployerIdentity(source, fetched.page);
  const hiringEvidence = looksLikeHiringPage(fetched.page);
  const sample = explicitSampleVacancy(fetched.page.url)
    ? fetched.page.url
    : extractAnchors(fetched.page.body, fetched.page.url)
      .find((anchor) =>
        sameSite(new URL(anchor.href).hostname, host) &&
        JOB_DETAIL_WORDS.test(`${anchor.label} ${anchor.href}`) &&
        explicitSampleVacancy(anchor.href),
      )?.href ?? "";
  const accepted = hiringEvidence && Boolean(sample) && (
    boardIdentity.accepted || candidate.linkedFromOfficialSite
  );
  const confidence = boardIdentity.accepted
    ? boardIdentity.confidence === "none" ? "medium" : boardIdentity.confidence
    : candidate.linkedFromOfficialSite
      ? identityConfidence
      : "medium";
  return {
    accepted,
    details: candidate.details,
    page: fetched.page,
    confidence,
    sampleVacancyUrl: sample,
    attempts: fetched.attempts,
    retries: fetched.retries,
    cacheHit: fetched.cacheHit,
    reason: accepted
      ? ""
      : !hiringEvidence
        ? "board page did not show hiring evidence"
        : !sample
          ? "board page did not expose an explicit sample vacancy"
          : boardIdentity.reason,
  };
}

async function discoverSponsor(
  source: SourceRow,
  options: RoutingOptions,
  fetcher: PublicSiteFetcher,
  cqcMatcher: ReturnType<typeof createOfficialRecordMatcher>,
  sponsorListAvailable: boolean,
  runtime: DiscoveryRuntime,
  companySiteRows: SourceRow[],
  vacancySourceRows: SourceRow[],
  baselineByKey: Map<string, SourceRow>,
): Promise<RoutingResult> {
  const row = makeBaseRow(source);
  const reasons: string[] = [];
  const secondaryRoutes: string[] = [];
  let attempts = 0;
  let retries = 0;
  let cacheHits = 0;
  let searchCount = 0;
  let searchUsed = false;
  let robotsBlocked = 0;
  let identityFailures = 0;
  let failureClass = "no_verified_hiring_route";
  const sourceLabel = text(source, "organisation_name");
  const directBoards: BoardCandidate[] = [];
  let searchHits: SearchHit[] = [];
  const recordFetch = (fetched: FetchResult) => {
    attempts += fetched.attempts;
    retries += fetched.retries;
    if (fetched.cacheHit) cacheHits += 1;
    if (/robots|policy|blocked/i.test(fetched.error)) robotsBlocked += 1;
  };
  const finish = (): RoutingResult => {
    row.search_used = searchUsed ? "yes" : "no";
    row.cache_hit = cacheHits > 0 ? "yes" : "no";
    row.attempt_count = String(attempts);
    return {
      row,
      attempts,
      retries,
      failureClass,
      secondaryRoutes,
      searchCount,
      cacheHits,
      robotsBlocked,
      identityFailures,
    };
  };

  const existingCareersUrl = text(source, "existing_careers_url");
  const existingBoardDetails = existingCareersUrl ? atsDetails(existingCareersUrl) : null;
  if (existingBoardDetails) {
    const safe = secureHttpsUrl(existingCareersUrl);
    if (safe) {
      directBoards.push({
        url: safe,
        evidenceUrl: text(source, "existing_ats_mapping_evidence_url") || existingCareersUrl,
        details: existingBoardDetails,
        linkedFromOfficialSite: text(source, "existing_ats_mapping_status") === "verified",
      });
    }
  }

  const websiteCandidates: WebsiteCandidate[] = [];
  const existingWebsite = text(source, "existing_website");
  if (existingWebsite && !atsDetails(existingWebsite)) {
    const candidate = makeCandidateFromExistingUrl(existingWebsite, "Existing sponsor website field");
    if (candidate) websiteCandidates.push(candidate);
    else reasons.push("existing website field was not eligible for safe HTTPS verification");
  }
  const cqcMatch = cqcMatcher(sponsorInput(source));
  if (cqcMatch?.record.website) {
    const candidate = makeCandidateFromExistingUrl(cqcMatch.record.website, "CQC exact/strict match lead");
    if (candidate && !websiteCandidates.some((item) => item.url === candidate.url)) {
      websiteCandidates.push({
        ...candidate,
        evidenceUrl: cqcMatch.record.evidenceUrl || CQC_EVIDENCE_URL,
      });
    }
  }
  if (existingCareersUrl && !existingBoardDetails) {
    const candidate = makeCandidateFromExistingUrl(existingCareersUrl, "Existing careers URL field");
    if (candidate) {
      const host = new URL(candidate.url).hostname;
      if (identityTokens(host).some((token) =>
        identityTokens(text(source, "organisation_name")).includes(token),
      )) {
        websiteCandidates.push(candidate);
      }
    }
  }
  const emailDomainLead = contactEmailDomainCandidate(source);
  if (emailDomainLead && !websiteCandidates.some((item) =>
    normalizedRequestUrl(item.url) === normalizedRequestUrl(emailDomainLead.url),
  )) websiteCandidates.push(emailDomainLead);

  const priorRow = baselineByKey.get(stableKey(source));
  const known = knownSourceCandidates(source, companySiteRows, vacancySourceRows, priorRow);
  for (const candidate of known.websites) {
    if (!websiteCandidates.some((item) =>
      normalizedRequestUrl(item.url) === normalizedRequestUrl(candidate.url),
    )) websiteCandidates.push(candidate);
  }
  for (const candidate of known.boards) {
    if (!directBoards.some((item) =>
      normalizedRequestUrl(item.url) === normalizedRequestUrl(candidate.url),
    )) directBoards.push(candidate);
  }

  let sponsorListSearched = false;
  if (websiteCandidates.length === 0) {
    sponsorListSearched = true;
    const sponsorList = await sponsorListCandidate(source, fetcher, sponsorListAvailable, runtime);
    attempts += sponsorList.attempts;
    retries += sponsorList.retries;
    if (sponsorList.cacheHit) cacheHits += 1;
    if (sponsorList.candidate) websiteCandidates.push(sponsorList.candidate);
    else if (sponsorList.error) reasons.push(`SponsorList lookup unavailable: ${sponsorList.error}`);
    else reasons.push("SponsorList had no exact employer name/location website match");
  }

  let homePage: PageResult | null = null;
  let homeConfidence: "high" | "medium" = "medium";
  let verifiedWebsiteUrl = "";
  let firstPartyEvidenceUrl = "";
  const triedWebsiteCandidates = new Set<string>();
  const tryWebsiteCandidate = async (candidate: WebsiteCandidate): Promise<{
    page: PageResult;
    confidence: "high" | "medium";
    evidenceUrl: string;
  } | null> => {
    const safe = secureHttpsUrl(candidate.url);
    if (!safe || triedWebsiteCandidates.has(safe)) return null;
    triedWebsiteCandidates.add(safe);
    const host = new URL(safe).hostname;
    const fetched = await fetchWithRetry(fetcher, new URL("/", safe).toString(), host, runtime);
    recordFetch(fetched);
    if (!fetched.page) {
      reasons.push(`candidate employer page could not be safely checked: ${fetched.error}`);
      return null;
    }
    const identity = verifyEmployerIdentity(source, fetched.page);
    if (!identity.accepted) {
      identityFailures += 1;
      reasons.push(identity.reason);
      return null;
    }
    reasons.push(`${candidate.source}: ${identity.reason}`);
    return {
      page: fetched.page,
      confidence: identity.confidence === "none" ? "medium" : identity.confidence,
      evidenceUrl: candidate.evidenceUrl || fetched.page.url,
    };
  };
  for (const candidate of websiteCandidates.slice(0, 4)) {
    const verified = await tryWebsiteCandidate(candidate);
    if (!verified) continue;
    homePage = verified.page;
    homeConfidence = verified.confidence;
    verifiedWebsiteUrl = verified.page.url;
    firstPartyEvidenceUrl = verified.evidenceUrl;
    row.discovered_source_url = verified.evidenceUrl;
    break;
  }

  if (!homePage && !sponsorListSearched) {
    sponsorListSearched = true;
    const sponsorList = await sponsorListCandidate(source, fetcher, sponsorListAvailable, runtime);
    attempts += sponsorList.attempts;
    retries += sponsorList.retries;
    if (sponsorList.cacheHit) cacheHits += 1;
    if (sponsorList.candidate) {
      websiteCandidates.push(sponsorList.candidate);
      const verified = await tryWebsiteCandidate(sponsorList.candidate);
      if (verified) {
        homePage = verified.page;
        homeConfidence = verified.confidence;
        verifiedWebsiteUrl = verified.page.url;
        firstPartyEvidenceUrl = verified.evidenceUrl;
        row.discovered_source_url = verified.evidenceUrl;
      }
    } else if (sponsorList.error) {
      reasons.push(`SponsorList lookup unavailable: ${sponsorList.error}`);
    } else {
      reasons.push("SponsorList had no exact employer name/location website match");
    }
  }

  if (homePage) {
    const employerHost = new URL(homePage.url).hostname;
    const pages: CareerEvidence[] = [];
    const inspected = new Set<string>();
    const sourcePages = [homePage];
    const anchors = extractAnchors(homePage.body, homePage.url);

    if (existingCareersUrl && !existingBoardDetails) {
      const safeCareers = secureHttpsUrl(existingCareersUrl);
      if (safeCareers) {
        const host = new URL(safeCareers).hostname;
        if (sameSite(host, employerHost)) {
          anchors.unshift({
            href: safeCareers,
            label: "Existing careers URL",
            sourceUrl: text(source, "existing_ats_mapping_evidence_url") || homePage.url,
            raw: "",
          });
        }
      }
    }

    const linkedBoardCandidates: BoardCandidate[] = [...directBoards];
    for (const anchor of anchors) {
      const details = atsDetails(anchor.href);
      if (!details) continue;
      const safe = secureHttpsUrl(anchor.href);
      if (!safe || linkedBoardCandidates.some((board) => board.url === safe)) continue;
      linkedBoardCandidates.push({
        url: safe,
        evidenceUrl: anchor.sourceUrl,
        details,
        linkedFromOfficialSite: true,
      });
    }

    let pagesChecked = 0;
    for (const anchor of anchors) {
      if (pagesChecked >= MAX_PAGES_PER_EMPLOYER) break;
      if (!shouldInspectLink(anchor, employerHost)) continue;
      const details = atsDetails(anchor.href);
      if (details) continue;
      const safe = secureHttpsUrl(anchor.href);
      if (!safe || inspected.has(safe)) continue;
      const host = new URL(safe).hostname;
      const sameEmployerSite = sameSite(host, employerHost);
      const hostMatchesEmployer = identityTokens(host).some((token) =>
        identityTokens(text(source, "organisation_name")).includes(token),
      );
      if (!sameEmployerSite && !hostMatchesEmployer) continue;
      inspected.add(safe);
      pagesChecked += 1;
      const fetched = await fetchWithRetry(fetcher, safe, host, runtime);
      recordFetch(fetched);
      if (!fetched.page) {
        reasons.push(`linked hiring page could not be checked: ${fetched.error}`);
        continue;
      }
      const identity = verifyEmployerIdentity(source, fetched.page);
      if (identity.accepted && looksLikeHiringPage(fetched.page)) {
        pages.push({
          page: fetched.page,
          confidence: identity.confidence === "none" ? "medium" : identity.confidence,
          sampleVacancyUrl: sampleVacancyOnPage(fetched.page),
        });
        sourcePages.push(fetched.page);
        break;
      }
      if (!identity.accepted) identityFailures += 1;
      reasons.push(identity.reason);
    }

    if (pages.length === 0) {
      for (const path of CAREER_PATHS) {
        if (pagesChecked >= MAX_PAGES_PER_EMPLOYER) break;
        const candidateUrl = careersPathCandidate(homePage.url, path);
        if (inspected.has(candidateUrl)) continue;
        inspected.add(candidateUrl);
        pagesChecked += 1;
        const fetched = await fetchWithRetry(fetcher, candidateUrl, employerHost, runtime);
        recordFetch(fetched);
        if (!fetched.page) continue;
        const identity = verifyEmployerIdentity(source, fetched.page);
        if (identity.accepted && looksLikeHiringPage(fetched.page)) {
          pages.push({
            page: fetched.page,
            confidence: identity.confidence === "none" ? "medium" : identity.confidence,
            sampleVacancyUrl: sampleVacancyOnPage(fetched.page),
          });
          sourcePages.push(fetched.page);
          break;
        }
        if (!identity.accepted) identityFailures += 1;
      }
    }

    const verifiedCareer = pages[0] ?? null;
    const cvEvidence = sourcePages
      .map(extractCvEvidence)
      .find((item): item is CvEvidence => item !== null) ?? null;
    if (cvEvidence) {
      const detail = cvEvidence.email
        ? `explicit CV/application instruction lists ${cvEvidence.email}`
        : `explicit CV/application form at ${cvEvidence.formUrl}`;
      reasons.push(`Send CV evidence: ${detail}`);
    }

    const boardCandidates = linkedBoardCandidates.slice(0, 5);
    let verifiedBoard: {
      candidate: BoardCandidate;
      result: Awaited<ReturnType<typeof verifyBoardCandidate>>;
    } | null = null;
    for (const candidate of boardCandidates) {
      const verified = await verifyBoardCandidate(candidate, source, fetcher, homeConfidence, runtime);
      attempts += verified.attempts;
      retries += verified.retries;
      if (verified.cacheHit) cacheHits += 1;
      if (/robots|policy|blocked/i.test(verified.reason)) robotsBlocked += 1;
      if (!verified.accepted && /identity/i.test(verified.reason)) identityFailures += 1;
      if (verified.accepted) {
        verifiedBoard = { candidate, result: verified };
        break;
      }
      reasons.push(verified.reason);
    }

    const companyHasRoleListing = Boolean(verifiedCareer?.sampleVacancyUrl);
    const companyCareerPage = verifiedCareer?.page ?? null;
    if (companyCareerPage) {
      row.discovered_source_url = row.discovered_source_url || companyCareerPage.url;
      row.evidence_url = companyCareerPage.url;
    } else {
      row.evidence_url = verifiedWebsiteUrl;
    }

    if (companyCareerPage && companyHasRoleListing) {
      setAcceptedRoute(row, {
        pipeline: "company_website",
        sourceType: "company_recruitment_page",
        sampleVacancyUrl: verifiedCareer.sampleVacancyUrl,
        discoveredSourceUrl: companyCareerPage.url,
        evidenceUrl: companyCareerPage.url,
        confidence: verifiedCareer?.confidence ?? homeConfidence,
      });
      if (verifiedBoard) {
        secondaryRoutes.push(
          `job_board=${verifiedBoard.candidate.details.provider}:${verifiedBoard.candidate.url}`,
        );
      }
      if (cvEvidence) secondaryRoutes.push(
        `send_cv=${cvEvidence.email || cvEvidence.formUrl}`,
      );
      failureClass = "";
    } else if (verifiedBoard) {
      setAcceptedRoute(row, {
        pipeline: "job_board",
        sourceType: "ats_board",
        provider: verifiedBoard.candidate.details.provider,
        boardId: verifiedBoard.candidate.details.boardId,
        sampleVacancyUrl: verifiedBoard.result.sampleVacancyUrl,
        discoveredSourceUrl: verifiedBoard.candidate.url,
        evidenceUrl: verifiedBoard.candidate.evidenceUrl ||
          companyCareerPage?.url ||
          verifiedWebsiteUrl,
        confidence: verifiedBoard.result.confidence,
      });
      if (companyCareerPage) secondaryRoutes.push(`company_website=${companyCareerPage.url}`);
      if (cvEvidence) secondaryRoutes.push(
        `send_cv=${cvEvidence.email || cvEvidence.formUrl}`,
      );
      failureClass = "";
    } else if (cvEvidence) {
      setAcceptedRoute(row, {
        pipeline: "send_cv",
        sourceType: cvEvidence.email ? "send_cv_email" : "send_cv_contact_form",
        provider: "",
        sampleVacancyUrl: "",
        discoveredSourceUrl: cvEvidence.pageUrl,
        evidenceUrl: cvEvidence.pageUrl,
        confidence: homeConfidence,
      });
      if (companyCareerPage) secondaryRoutes.push(`company_website=${companyCareerPage.url}`);
      failureClass = "";
    } else {
      reasons.push("first-party website identity was verified, but no employer-specific hiring route was found");
      failureClass = "no_verified_hiring_route";
    }
  }

  if (!homePage) {
    for (const candidate of directBoards.slice(0, 3)) {
      const verified = await verifyBoardCandidate(candidate, source, fetcher, "medium", runtime);
      attempts += verified.attempts;
      retries += verified.retries;
      if (verified.cacheHit) cacheHits += 1;
      if (/robots|policy|blocked/i.test(verified.reason)) robotsBlocked += 1;
      if (!verified.accepted && /identity/i.test(verified.reason)) identityFailures += 1;
      if (!verified.accepted) {
        reasons.push(verified.reason);
        continue;
      }
      setAcceptedRoute(row, {
        pipeline: "job_board",
        sourceType: "ats_board",
        provider: candidate.details.provider,
        boardId: candidate.details.boardId,
        sampleVacancyUrl: verified.sampleVacancyUrl,
        discoveredSourceUrl: candidate.url,
        evidenceUrl: candidate.evidenceUrl,
        confidence: verified.confidence,
      });
      failureClass = "";
      break;
    }
  }

  if (
    row.source_pipeline === "unverified" &&
    runtime.searchConfigured &&
    options.searchEnabled &&
    options.maxSearchesPerSponsor > 0 &&
    options.maxTotalSearches > 0
  ) {
    const queries = bingQueriesForSponsor(source).slice(0, options.maxSearchesPerSponsor);
    for (const query of queries) {
      const search = await bingSearch(query, options.delayMs, runtime);
      attempts += search.attempts;
      retries += search.retries;
      searchCount += search.searchCount;
      cacheHits += search.cacheHits;
      if (search.searchCount > 0 || search.cacheHits > 0) searchUsed = true;
      if (search.error) {
        reasons.push(`Optional Bing search unavailable: ${search.error}`);
        if (search.error === "total web-search budget reached") break;
      }
      const hits = search.hits.filter((hit) => searchHitMentionsEmployer(source, hit));
      searchHits.push(...hits);
      for (const hit of hits) {
        const safe = secureHttpsUrl(hit.url);
        if (!safe) continue;
        const details = atsDetails(safe);
        if (details) {
          const candidate: BoardCandidate = {
            url: safe,
            evidenceUrl: safe,
            details,
            linkedFromOfficialSite: false,
          };
          if (!directBoards.some((board) => normalizedRequestUrl(board.url) === normalizedRequestUrl(safe))) {
            const verified = await verifyBoardCandidate(candidate, source, fetcher, "medium", runtime);
            attempts += verified.attempts;
            retries += verified.retries;
            if (verified.cacheHit) cacheHits += 1;
            if (/robots|policy|blocked/i.test(verified.reason)) robotsBlocked += 1;
            if (!verified.accepted && /identity/i.test(verified.reason)) identityFailures += 1;
            if (verified.accepted) {
              setAcceptedRoute(row, {
                pipeline: "job_board",
                sourceType: "ats_board",
                provider: details.provider,
                boardId: details.boardId,
                sampleVacancyUrl: verified.sampleVacancyUrl,
                discoveredSourceUrl: safe,
                evidenceUrl: safe,
                confidence: verified.confidence,
              });
              failureClass = "";
              break;
            }
            reasons.push(verified.reason);
          }
          continue;
        }

        const candidate = makeCandidateFromExistingUrl(safe, "Identity-aligned Bing result lead");
        if (!candidate) continue;
        const verifiedHome = await tryWebsiteCandidate(candidate);
        if (!verifiedHome) continue;
        const employerHost = new URL(verifiedHome.page.url).hostname;
        const anchors = extractAnchors(verifiedHome.page.body, verifiedHome.page.url);
        const pageCandidates = [safe];
        for (const anchor of anchors) {
          if (!shouldInspectLink(anchor, employerHost) || atsDetails(anchor.href)) continue;
          const anchorUrl = secureHttpsUrl(anchor.href);
          if (!anchorUrl || !sameSite(new URL(anchorUrl).hostname, employerHost)) continue;
          if (!pageCandidates.includes(anchorUrl)) pageCandidates.push(anchorUrl);
        }
        for (const path of CAREER_PATHS) {
          const pathUrl = careersPathCandidate(verifiedHome.page.url, path);
          if (!pageCandidates.includes(pathUrl)) pageCandidates.push(pathUrl);
        }

        let verifiedCareer: CareerEvidence | null = null;
        for (const pageUrl of pageCandidates.slice(0, MAX_PAGES_PER_EMPLOYER)) {
          const host = new URL(pageUrl).hostname;
          const fetched = await fetchWithRetry(fetcher, pageUrl, host, runtime);
          recordFetch(fetched);
          if (!fetched.page) continue;
          const identity = verifyEmployerIdentity(source, fetched.page);
          if (!identity.accepted) {
            identityFailures += 1;
            reasons.push(identity.reason);
            continue;
          }
          if (looksLikeHiringPage(fetched.page)) {
            verifiedCareer = {
              page: fetched.page,
              confidence: identity.confidence === "none" ? "medium" : identity.confidence,
              sampleVacancyUrl: sampleVacancyOnPage(fetched.page),
            };
            break;
          }
        }

        const linkedBoards: BoardCandidate[] = anchors
          .map((anchor) => {
            const boardDetails = atsDetails(anchor.href);
            const boardUrl = secureHttpsUrl(anchor.href);
            return boardDetails && boardUrl
              ? {
                url: boardUrl,
                evidenceUrl: anchor.sourceUrl,
                details: boardDetails,
                linkedFromOfficialSite: true,
              }
              : null;
          })
          .filter((item): item is BoardCandidate => item !== null);
        let verifiedBoard: { candidate: BoardCandidate; result: Awaited<ReturnType<typeof verifyBoardCandidate>> } | null = null;
        for (const board of linkedBoards.slice(0, 3)) {
          const result = await verifyBoardCandidate(board, source, fetcher, verifiedHome.confidence, runtime);
          attempts += result.attempts;
          retries += result.retries;
          if (result.cacheHit) cacheHits += 1;
          if (/robots|policy|blocked/i.test(result.reason)) robotsBlocked += 1;
          if (!result.accepted && /identity/i.test(result.reason)) identityFailures += 1;
          if (result.accepted) {
            verifiedBoard = { candidate: board, result };
            break;
          }
          reasons.push(result.reason);
        }
        const sourcePages = [verifiedHome.page, ...(verifiedCareer ? [verifiedCareer.page] : [])];
        const cvEvidence = sourcePages
          .map(extractCvEvidence)
          .find((item): item is CvEvidence => item !== null) ?? null;
        const hasRoleListing = Boolean(verifiedCareer?.sampleVacancyUrl);
        if (verifiedCareer && hasRoleListing) {
          setAcceptedRoute(row, {
            pipeline: "company_website",
            sourceType: "company_recruitment_page",
            sampleVacancyUrl: verifiedCareer.sampleVacancyUrl,
            discoveredSourceUrl: verifiedCareer.page.url,
            evidenceUrl: verifiedCareer.page.url,
            confidence: verifiedCareer.confidence,
          });
          row.discovered_source_url = verifiedCareer.page.url;
          row.evidence_url = verifiedCareer.page.url;
          if (verifiedBoard) secondaryRoutes.push(
            `job_board=${verifiedBoard.candidate.details.provider}:${verifiedBoard.candidate.url}`,
          );
          if (cvEvidence) secondaryRoutes.push(`send_cv=${cvEvidence.email || cvEvidence.formUrl}`);
          failureClass = "";
        } else if (verifiedBoard) {
          setAcceptedRoute(row, {
            pipeline: "job_board",
            sourceType: "ats_board",
            provider: verifiedBoard.candidate.details.provider,
            boardId: verifiedBoard.candidate.details.boardId,
            sampleVacancyUrl: verifiedBoard.result.sampleVacancyUrl,
            discoveredSourceUrl: verifiedBoard.candidate.url,
            evidenceUrl: verifiedBoard.candidate.evidenceUrl,
            confidence: verifiedBoard.result.confidence,
          });
          if (verifiedCareer) secondaryRoutes.push(`company_website=${verifiedCareer.page.url}`);
          if (cvEvidence) secondaryRoutes.push(`send_cv=${cvEvidence.email || cvEvidence.formUrl}`);
          failureClass = "";
        } else if (cvEvidence) {
          setAcceptedRoute(row, {
            pipeline: "send_cv",
            sourceType: cvEvidence.email ? "send_cv_email" : "send_cv_contact_form",
            provider: "",
            sampleVacancyUrl: "",
            discoveredSourceUrl: cvEvidence.pageUrl,
            evidenceUrl: cvEvidence.pageUrl,
            confidence: verifiedHome.confidence,
          });
          failureClass = "";
        }
        if (row.source_pipeline !== "unverified") break;
      }
      if (row.source_pipeline !== "unverified") break;
    }
  }

  if (row.source_pipeline === "unverified") {
    failureClass = commonFailureClass(reasons);
    row.notes = [...new Set(reasons)].join("; ") ||
      "No verified employer-specific company, ATS/job-board, or Send CV route was found.";
  } else {
    const routeNotes = [
      ...reasons,
      `Accepted ${row.source_pipeline} route with ${row.confidence} confidence.`,
      ...(secondaryRoutes.length ? [`Additional verified sources: ${secondaryRoutes.join("; ")}`] : []),
    ];
    row.notes = [...new Set(routeNotes)].join("; ");
  }
  if (!row.discovered_source_url && existingWebsite) {
    row.discovered_source_url = secureHttpsUrl(existingWebsite) ?? "";
  }
  if (!row.evidence_url && firstPartyEvidenceUrl) row.evidence_url = firstPartyEvidenceUrl;
  if (!row.evidence_url && directBoards[0]) row.evidence_url = directBoards[0].evidenceUrl;
  if (!row.discovered_source_url && searchHits[0]) row.discovered_source_url = searchHits[0].url;
  if (row.source_pipeline === "unverified" && verifiedWebsiteUrl) {
    row.discovered_source_url = row.discovered_source_url || verifiedWebsiteUrl;
    row.evidence_url = row.evidence_url || verifiedWebsiteUrl;
  }
  return finish();
}

function slug(value: string): string {
  return normalizeRoutingName(value).replace(/\s+/g, "-") || "sector";
}

function parseOptions(args: string[]): RoutingOptions {
  let input = DEFAULT_INPUT;
  let sector = "Healthcare";
  let cqc = DEFAULT_CQC;
  let previousFile = "";
  let previousFileSpecified = false;
  let unresolvedFile = "";
  let baselineFile = "";
  let knownSitesFile = DEFAULT_KNOWN_SITES;
  let knownSourcesFile = DEFAULT_KNOWN_SOURCES;
  let searchCacheFile = DEFAULT_SEARCH_CACHE;
  let outputDir = DEFAULT_OUTPUT_DIR;
  let output = "";
  let report = "";
  let progress = "";
  let batchSize = 100;
  let offset = 0;
  let batchNumber = 1;
  let includeProcessed = false;
  let resume = true;
  let delayMs = DEFAULT_DELAY_MS;
  let searchEnabled = true;
  let cacheEnabled = true;
  let maxSearchesPerSponsor = 2;
  let maxTotalSearches = 100;
  let maxConcurrency = 3;
  let outputSpecified = false;
  let reportSpecified = false;
  let progressSpecified = false;

  const values = new Map<string, (value: string) => void>([
    ["--input", (value) => { input = fromRepository(value); }],
    ["--sector", (value) => { sector = value.trim(); }],
    ["--cqc", (value) => { cqc = fromRepository(value); }],
    ["--previous-file", (value) => { previousFile = fromRepository(value); previousFileSpecified = true; }],
    ["--unresolved-file", (value) => { unresolvedFile = fromRepository(value); }],
    ["--baseline-file", (value) => { baselineFile = fromRepository(value); }],
    ["--known-sites-file", (value) => { knownSitesFile = fromRepository(value); }],
    ["--known-sources-file", (value) => { knownSourcesFile = fromRepository(value); }],
    ["--search-cache-file", (value) => { searchCacheFile = fromRepository(value); }],
    ["--output-dir", (value) => { outputDir = fromRepository(value); }],
    ["--output", (value) => { output = fromRepository(value); outputSpecified = true; }],
    ["--report", (value) => { report = fromRepository(value); reportSpecified = true; }],
    ["--progress", (value) => { progress = fromRepository(value); progressSpecified = true; }],
    ["--batch-size", (value) => { batchSize = Number(value); }],
    ["--offset", (value) => { offset = Number(value); }],
    ["--batch-number", (value) => { batchNumber = Number(value); }],
    ["--delay-ms", (value) => { delayMs = Number(value); }],
    ["--max-searches-per-sponsor", (value) => { maxSearchesPerSponsor = Number(value); }],
    ["--max-total-searches", (value) => { maxTotalSearches = Number(value); }],
    ["--max-concurrency", (value) => { maxConcurrency = Number(value); }],
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--") continue;
    if (argument === "--include-processed") {
      includeProcessed = true;
      continue;
    }
    if (argument === "--fresh") {
      resume = false;
      continue;
    }
    if (argument === "--resume") {
      resume = true;
      continue;
    }
    if (argument === "--search-enabled") {
      searchEnabled = true;
      continue;
    }
    if (argument === "--search-disabled") {
      searchEnabled = false;
      continue;
    }
    if (argument === "--cache-enabled") {
      cacheEnabled = true;
      continue;
    }
    if (argument === "--cache-disabled") {
      cacheEnabled = false;
      continue;
    }
    const setter = values.get(argument);
    if (!setter) throw new Error(`Unknown option: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    setter(value);
    index += 1;
  }

  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`--batch-size must be between 1 and ${MAX_BATCH_SIZE}.`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("--offset must be a non-negative integer.");
  }
  if (!Number.isInteger(batchNumber) || batchNumber < 1) {
    throw new Error("--batch-number must be a positive integer.");
  }
  if (!Number.isInteger(delayMs) || delayMs < 1_000) {
    throw new Error("--delay-ms must be at least 1000 to respect public-host rate limits.");
  }
  if (!Number.isInteger(maxSearchesPerSponsor) || maxSearchesPerSponsor < 0 || maxSearchesPerSponsor > 10) {
    throw new Error("--max-searches-per-sponsor must be between 0 and 10.");
  }
  if (!Number.isInteger(maxTotalSearches) || maxTotalSearches < 0 || maxTotalSearches > 10_000) {
    throw new Error("--max-total-searches must be between 0 and 10000.");
  }
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 8) {
    throw new Error("--max-concurrency must be between 1 and 8.");
  }
  if (!previousFileSpecified && sector === "Healthcare") previousFile = DEFAULT_PREVIOUS_BATCH;
  if (!baselineFile && unresolvedFile) baselineFile = unresolvedFile;
  const baseName = `${slug(sector)}-vacancy-source-routing-batch${batchNumber}-${batchSize}`;
  if (!outputSpecified) output = resolve(outputDir, `${baseName}.csv`);
  if (!reportSpecified) report = resolve(outputDir, `${baseName}-report.md`);
  if (!progressSpecified) progress = resolve(outputDir, `${slug(sector)}-vacancy-source-routing-progress.json`);

  return {
    input,
    sector,
    cqc,
    previousFile,
    outputDir,
    output,
    report,
    progress,
    unresolvedFile,
    baselineFile,
    knownSitesFile,
    knownSourcesFile,
    searchCacheFile,
    batchSize,
    offset,
    batchNumber,
    includeProcessed,
    resume,
    delayMs,
    searchEnabled,
    cacheEnabled,
    maxSearchesPerSponsor,
    maxTotalSearches,
    maxConcurrency,
  };
}

async function readOptionalFile(path: string): Promise<{ exists: boolean; text: string }> {
  if (!path) return { exists: false, text: "" };
  try {
    return { exists: true, text: await readFile(path, "utf8") };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { exists: false, text: "" };
    throw error;
  }
}

async function atomicReplace(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}

async function writeExclusive(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, { encoding: "utf8", flag: "wx" });
}

async function loadProgress(path: string): Promise<ProgressFile | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as ProgressFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Cannot read progress file ${path}: ${String(error)}`);
  }
}

async function loadSearchCache(path: string, enabled: boolean): Promise<SearchCacheFile> {
  if (!enabled) return createEmptySearchCache();
  const state = await readOptionalFile(path);
  if (!state.exists) return createEmptySearchCache();
  try {
    const parsed = JSON.parse(state.text) as Partial<SearchCacheFile>;
    if (
      parsed.schemaVersion !== 1 ||
      !parsed.searchQueries ||
      typeof parsed.searchQueries !== "object" ||
      !parsed.sponsorListQueries ||
      typeof parsed.sponsorListQueries !== "object"
    ) {
      throw new Error("invalid cache schema");
    }
    return parsed as SearchCacheFile;
  } catch (error) {
    throw new Error(`Cannot read lookup cache ${path}: ${String(error)}`);
  }
}

function validateProgress(
  progress: ProgressFile,
  options: RoutingOptions,
  inputHash: string,
  cqcHash: string,
  previousHash: string,
  unresolvedHash: string,
  knownSitesHash: string,
  knownSourcesHash: string,
  selectedKeys: string[],
): void {
  if (
    progress.schemaVersion !== 2 ||
    progress.sector !== options.sector ||
    progress.inputPath !== options.input ||
    progress.inputSha256 !== inputHash ||
    progress.cqcPath !== options.cqc ||
    progress.cqcSha256 !== cqcHash ||
    progress.previousFilePath !== options.previousFile ||
    progress.previousFileSha256 !== previousHash ||
    progress.unresolvedFilePath !== options.unresolvedFile ||
    progress.unresolvedFileSha256 !== unresolvedHash ||
    progress.knownSitesFileSha256 !== knownSitesHash ||
    progress.knownSourcesFileSha256 !== knownSourcesHash ||
    progress.batchSize !== options.batchSize ||
    progress.offset !== options.offset ||
    progress.batchNumber !== options.batchNumber ||
    progress.includeProcessed !== options.includeProcessed ||
    progress.searchEnabled !== options.searchEnabled ||
    progress.cacheEnabled !== options.cacheEnabled ||
    progress.maxSearchesPerSponsor !== options.maxSearchesPerSponsor ||
    progress.maxTotalSearches !== options.maxTotalSearches ||
    progress.maxConcurrency !== options.maxConcurrency ||
    JSON.stringify(progress.selectedKeys) !== JSON.stringify(selectedKeys)
  ) {
    throw new Error(
      "Progress file belongs to different input or batch options; use a new --progress path. Existing progress was not changed.",
    );
  }
}

function countBy(rows: VacancySourceRoutingRow[], key: keyof VacancySourceRoutingRow): Record<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[key] || "(blank)";
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((left, right) =>
    right[1] - left[1] || left[0].localeCompare(right[0]),
  ));
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function reportMarkdown(args: {
  options: RoutingOptions;
  inputRows: number;
  selection: RoutingSelection;
  rows: VacancySourceRoutingRow[];
  results: RoutingResult[];
  searchStatus: string;
  bingConfigured: boolean;
  cqcRecords: number;
  previousRows: SourceRow[];
  baselineRows: SourceRow[];
  cqcPathPresent: boolean;
  searchCacheHits: number;
  pageCacheHits: number;
  sponsorListAvailable: boolean;
  searchAccessAttempts: number;
  runtimeMs: number;
  knownCompanySiteRows: number;
  knownVacancySourceRows: number;
  outputPath: string;
  reportPath: string;
  progressPath: string;
}): string {
  const {
    options, inputRows, selection, rows, results, searchStatus, bingConfigured,
    cqcRecords, previousRows, baselineRows, cqcPathPresent, searchCacheHits,
    pageCacheHits, sponsorListAvailable, searchAccessAttempts, runtimeMs, knownCompanySiteRows,
    knownVacancySourceRows, outputPath, reportPath, progressPath,
  } = args;
  const routes = countBy(rows, "source_pipeline");
  const confidence = countBy(rows, "confidence");
  const recommendations = countBy(rows, "should_import");
  const providers = new Map<string, number>();
  for (const row of rows) {
    if (row.provider && row.source_pipeline === "job_board") {
      providers.set(row.provider, (providers.get(row.provider) ?? 0) + 1);
    }
  }
  const failures = new Map<string, number>();
  for (const result of results) {
    if (result.failureClass) {
      failures.set(result.failureClass, (failures.get(result.failureClass) ?? 0) + 1);
    }
  }
  const useful = rows.filter((row) => row.source_pipeline !== "unverified").length;
  const high = rows.filter((row) => row.confidence === "high").length;
  const medium = rows.filter((row) => row.confidence === "medium").length;
  const searchCount = results.reduce((total, result) => total + (result.searchCount ?? 0), 0);
  const cacheHits = results.reduce((total, result) => total + (result.cacheHits ?? 0), 0);
  const blockedCount = results.reduce((total, result) => total + (result.robotsBlocked ?? 0), 0);
  const identityFailureCount = results.reduce((total, result) => total + (result.identityFailures ?? 0), 0);
  const requestCount = results.reduce((total, result) => total + result.attempts, searchAccessAttempts);
  const baselineByKey = new Map(baselineRows.map((row) => [stableKey(row), row]));
  const selectedBaselineRows = selection.selectedRows
    .map((source) => baselineByKey.get(stableKey(source)))
    .filter((row): row is SourceRow => Boolean(row));
  const baselineRoutes = baselineRows.length
    ? countBy(baselineRows as VacancySourceRoutingRow[], "source_pipeline")
    : {};
  const baselineUseful = baselineRows.filter((row) =>
    text(row, "source_pipeline") && text(row, "source_pipeline") !== "unverified",
  ).length;
  const selectedBaselineUnverified = selectedBaselineRows.filter((row) =>
    text(row, "source_pipeline") === "unverified",
  ).length;
  const newlyVerified = rows.filter((row) => row.source_pipeline !== "unverified").length;
  const batch1 = previousRows.length
    ? countBy(previousRows as VacancySourceRoutingRow[], "source_pipeline")
    : {};
  const batch1Useful = previousRows.filter((row) => row.source_pipeline && row.source_pipeline !== "unverified").length;
  const batch1High = previousRows.filter((row) => row.confidence === "high").length;
  const previousKeys = new Set(previousRows.map(stableKey));
  const priorOverlap = rows.filter((row) => previousKeys.has(stableKey(row))).length;
  const combinedUniqueRows = previousRows.length + rows.length - priorOverlap;
  const routeLines = (values: Record<string, number>) =>
    Object.entries(values).map(([name, count]) => `| ${markdownCell(name)} | ${count} |`).join("\n") ||
    "| (none) | 0 |";
  const pipelineLines = ["company_website", "job_board", "send_cv", "unverified"]
    .map((name) => `| ${name} | ${routes[name] ?? 0} |`)
    .join("\n");
  const confidenceLines = ["high", "medium", "low", "unverified"]
    .map((name) => `| ${name} | ${confidence[name] ?? 0} |`)
    .join("\n");
  const providerLines = [...providers.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([provider, count]) => `| ${markdownCell(provider)} | ${count} |`)
    .join("\n") || "| (none verified) | 0 |";
  const failureLines = [...failures.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason, count]) => `- \`${reason}\`: ${count}`)
    .join("\n") || "- No failures were recorded.";
  const exampleLines = (route: string, max: number) => rows
    .filter((row) => row.source_pipeline === route && row.evidence_url)
    .slice(0, max)
    .map((row) =>
      `- [${markdownCell(row.organisation_name)}](${row.evidence_url}) — ${row.confidence} confidence; ${markdownCell(row.source_type)}${row.provider ? ` (${markdownCell(row.provider)})` : ""}${row.sample_vacancy_url ? `; [sample vacancy](${row.sample_vacancy_url})` : ""}.`,
    )
    .join("\n") || "- No verified examples.";
  const unverifiedExamples = rows
    .filter((row) => row.source_pipeline === "unverified" && (row.discovered_source_url || row.evidence_url))
    .slice(0, 5)
    .map((row) =>
      `- **${markdownCell(row.organisation_name)}** — ${markdownCell(row.notes)}${row.evidence_url ? ` [evidence](${row.evidence_url})` : ""}.`,
    )
    .join("\n") || "- No unverified leads with an evidence URL.";
  const routeRate = rows.length ? useful / rows.length : 0;
  const highShare = useful ? high / useful : 0;
  const scaleRecommendation = !bingConfigured || !options.searchEnabled
    ? "No larger search-enabled batch is justified by this run: optional web search was not configured or was disabled. Keep the pilot capped, and do not expand beyond Healthcare until a configured search run has been measured."
    : useful >= Math.min(10, rows.length) && highShare >= 0.7
      ? "A larger capped Healthcare batch may be tested next, but do not expand to other sectors yet. Confirm that identity precision and blocked-result rates remain acceptable."
      : "Not yet. Review this pilot and improve source coverage or identity verification before testing a larger Healthcare batch. Do not expand to other sectors.";
  const pilotTitle = options.unresolvedFile
    ? `${options.sector} vacancy source routing — unresolved ${rows.length}-row pilot`
    : `${options.sector} vacancy source routing — batch ${options.batchNumber} (${rows.length} sponsor rows)`;
  const generatedDate = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date()).split("/").reverse().join("-");

  return `# ${pilotTitle}

Generated: ${generatedDate}

**Review only.** No source was imported; no database or production data was written.

## Source and cohort

- Source CSV: \`${options.input}\`
- Read-only unresolved/baseline CSV: \`${options.unresolvedFile || options.baselineFile || "(not supplied)"}\`
- Input rows: **${inputRows.toLocaleString("en-GB")}**
- Exact \`${options.sector}\` rows: **${selection.exactSectorRows.length.toLocaleString("en-GB")}**
- Unique exact-sector rows after ID/fallback-key deduplication: **${selection.uniqueSectorRows.length.toLocaleString("en-GB")}**
- Duplicate sponsor IDs skipped: **${selection.duplicateIds}**
- Duplicate blank-ID normalized-name/town keys skipped: **${selection.duplicateFallbackKeys}**
- Previously routed IDs excluded: **${options.includeProcessed ? 0 : selection.skippedPreviouslyProcessed}**${options.includeProcessed ? " (override enabled; previous IDs were included)" : ""}
${options.unresolvedFile ? `- Rows excluded outside the unresolved cohort: **${selection.excludedByUnresolvedFilter}**\n` : ""}
- Selected rows with at least one missing source signal: **${selection.selectedWithMissingSignals}**
- Selected rows with a previous company-site error: **${selection.selectedWithPriorSiteError}**
- Selection: priority by missing source fields, previous site error, unverified mapping status, then stable source order; offset ${options.offset}; requested size ${options.batchSize}
- \`sponsor_licence_id\` is retained exactly from the input. It is the JOBSAGE sponsor-row key, not an official licence number.

## Search and verification

- Search access: **${markdownCell(searchStatus)}**
- Bing key configured: **${bingConfigured ? "yes" : "no"}**
- Optional web search enabled for this run: **${bingConfigured && options.searchEnabled ? "yes" : "no"}**
- Per-sponsor search cap: **${options.maxSearchesPerSponsor}**; total search cap: **${options.maxTotalSearches}**
- Search and URL cache enabled: **${options.cacheEnabled ? "yes" : "no"}**
- Bing search requests issued (cache misses): **${searchCount}**
- Reused cache results: **${cacheHits} total** (${searchCacheHits} persisted lookup/search cache hits; ${pageCacheHits} page-fetch cache hits)
- Public HTTP attempts for selected sponsors: **${requestCount}**; elapsed runtime: **${(runtimeMs / 1_000).toFixed(1)} seconds**
- Robots/policy-blocked checks: **${blockedCount}**; employer-identity checks rejected: **${identityFailureCount}**
- CQC local records loaded: **${cqcRecords.toLocaleString("en-GB")}** (${cqcPathPresent ? options.cqc : "cache file not present"})
- SponsorList availability: **${sponsorListAvailable ? "available" : "unavailable"}**. It is a website lead only; matching requires exact normalized employer name and location overlap.
- Local support inputs: company-site cache **${options.knownSitesFile}** (${knownCompanySiteRows.toLocaleString("en-GB")} rows); prior vacancy-source cache **${options.knownSourcesFile}** (${knownVacancySourceRows.toLocaleString("en-GB")} rows).
- Contact-email domains and known company/site source URLs are leads only. They are checked against employer identity before any route can be accepted.
- First-party pages are fetched with the existing public-site safety client: HTTPS, public-DNS checks, same-site redirect limits, robots.txt, request pacing, response-size limits, timeouts, and transient retries.
- Search results/directories are leads only. A route is accepted only after employer identity and hiring-path evidence are checked. Unsupported or ambiguous sources remain \`unverified\`.
- No agent-per-row manual search was used.

## Routing results

| Pipeline | Sponsor rows |
|---|---:|
${pipelineLines}
| **Total processed** | **${rows.length}** |

### Confidence and import recommendation

| Confidence | Rows |
|---|---:|
${confidenceLines}

| Recommendation | Rows |
|---|---:|
${routeLines(recommendations)}

- Useful verified routes: **${useful}/${rows.length} (${(routeRate * 100).toFixed(1)}%)**
- High-confidence rows: **${high}**
- Medium-confidence rows requiring review: **${medium}**
- Low-confidence or unverified findings are not importable.
- Secondary verified routes are retained in \`notes\`; one CSV row is emitted per selected sponsor record.

### Job-board and ATS providers

| Provider | Rows |
|---|---:|
${providerLines}

## Common failure reasons

${failureLines}

## Examples of newly recovered matches

Each example below was unverified in the batch-2 baseline before this pilot.

### Company website

${exampleLines("company_website", 5)}

### Job board / ATS

${exampleLines("job_board", 5)}

### Send CV / recruitment contact

${exampleLines("send_cv", 5)}

### Unverified examples

${unverifiedExamples}

## Baseline comparison

${baselineRows.length
    ? `- Batch 2 baseline: **${baselineRows.length}** rows; useful routes: **${baselineUseful}/${baselineRows.length} (${(baselineUseful / baselineRows.length * 100).toFixed(1)}%)**; unverified: **${baselineRows.filter((row) => text(row, "source_pipeline") === "unverified").length}**; route totals: ${Object.entries(baselineRoutes).map(([route, count]) => `\`${route}\` ${count}`).join(", ")}.
- Selected pilot cohort: **${selectedBaselineRows.length}** baseline rows; **${selectedBaselineUnverified}** were unverified before this pilot.
- Newly verified in the pilot: **${newlyVerified}/${rows.length}**; pilot current coverage: **${useful}/${rows.length} (${(routeRate * 100).toFixed(1)}%)**.
- Batch 2 was used only as a read-only cohort/baseline; its CSV, report, and progress checkpoint were not rewritten.`
    : "- No separate baseline routing CSV was supplied; cohort-level comparison was unavailable."}
${previousRows.length
    ? `\n- Batch 1 non-overlap reference: **${previousRows.length}** rows; useful routes **${batch1Useful}/${previousRows.length}**; high confidence **${batch1High}**; pilot overlap with batch 1 **${priorOverlap}**; combined unique rows **${combinedUniqueRows}**.`
    : ""}

## Recommendation

**${scaleRecommendation}**

The recommendation uses this sample's verified-route yield (${useful}/${rows.length}), high-confidence share among verified routes (${(highShare * 100).toFixed(1)}%), search availability, cache use, and blocked-result count. It does not authorize automatic import or imply that unverified rows have no vacancies.

## File handling and safety

- CSV: \`${outputPath}\`
- Report: \`${reportPath}\`
- Resumable progress: \`${progressPath}\`
- Reusable lookup cache: \`${options.searchCacheFile}\` (written only when caching is enabled)
- Progress is checkpointed after every sponsor. Existing output CSV/report files are never overwritten.
- This run performs public HTTP GET/search requests only. It does not write to a database, import findings, modify production data, or deploy.
`;
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(() => true).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  });
}

export async function runVacancySourceRoutingBatch(
  args: string[] = process.argv.slice(2),
): Promise<void> {
  const runtimeStartedAt = Date.now();
  const options = parseOptions(args);
  const sourceText = await readFile(options.input, "utf8");
  const sourceRows = parseCsvObjects(sourceText);
  const requiredColumns = ["sponsor_licence_id", "organisation_name", "industry"];
  const headers = Object.keys(sourceRows[0] ?? {});
  const missing = requiredColumns.filter((column) => !headers.includes(column));
  if (missing.length) {
    throw new Error(`Input CSV is missing required columns: ${missing.join(", ")}`);
  }

  const previousFile = await readOptionalFile(options.previousFile);
  if (options.previousFile && !previousFile.exists && !options.includeProcessed) {
    throw new Error(
      `Previous routing file not found at ${options.previousFile}; cannot guarantee non-overlap. Pass --include-processed to explicitly override.`,
    );
  }
  const previousRows = previousFile.exists ? parseCsvObjects(previousFile.text) : [];
  const previousHeaders = Object.keys(previousRows[0] ?? {});
  if (previousRows.length && !previousHeaders.includes("sponsor_licence_id")) {
    throw new Error(`Previous routing file ${options.previousFile} is missing sponsor_licence_id.`);
  }
  for (const prior of previousRows) {
    if (text(prior, "industry") && text(prior, "industry") !== options.sector) {
      throw new Error(`Previous routing file contains a row outside exact sector ${options.sector}.`);
    }
  }
  const priorIdSet = new Set<string>();
  for (const prior of previousRows) {
    const id = text(prior, "sponsor_licence_id");
    if (id && priorIdSet.has(id)) {
      throw new Error(`Previous routing file contains duplicate sponsor_licence_id ${id}.`);
    }
    if (id) priorIdSet.add(id);
  }
  const unresolvedFile = options.unresolvedFile
    ? await readOptionalFile(options.unresolvedFile)
    : { exists: false, text: "" };
  if (options.unresolvedFile && !unresolvedFile.exists) {
    throw new Error(`Unresolved-cohort file not found: ${options.unresolvedFile}`);
  }
  const baselineFile = options.baselineFile === options.unresolvedFile
    ? unresolvedFile
    : await readOptionalFile(options.baselineFile);
  if (options.baselineFile && !baselineFile.exists) {
    throw new Error(`Baseline routing file not found: ${options.baselineFile}`);
  }
  const baselineRows = baselineFile.exists ? parseCsvObjects(baselineFile.text) : [];
  const unresolvedRows = unresolvedFile.exists ? parseCsvObjects(unresolvedFile.text) : [];
  const unresolvedKeys = unresolvedFile.exists
    ? new Set(unresolvedRows
      .filter((row) => text(row, "source_pipeline") === "unverified")
      .map(stableKey))
    : undefined;
  if (unresolvedFile.exists) {
    const unresolvedHeaders = Object.keys(unresolvedRows[0] ?? {});
    if (!unresolvedHeaders.includes("sponsor_licence_id") ||
        !unresolvedHeaders.includes("source_pipeline")) {
      throw new Error(`Unresolved-cohort file ${options.unresolvedFile} must contain sponsor_licence_id and source_pipeline.`);
    }
    const invalidSector = unresolvedRows.find((row) =>
      text(row, "industry") && text(row, "industry") !== options.sector,
    );
    if (invalidSector) {
      throw new Error(`Unresolved-cohort file contains a row outside exact sector ${options.sector}.`);
    }
    if (!unresolvedKeys?.size) {
      throw new Error(`Unresolved-cohort file has no rows with source_pipeline=unverified.`);
    }
    const inputKeys = new Set(sourceRows
      .filter((row) => text(row, "industry") === options.sector)
      .map(stableKey));
    const missingCohortRows = [...unresolvedKeys].filter((key) => !inputKeys.has(key));
    if (missingCohortRows.length) {
      throw new Error(
        `Unresolved cohort contains ${missingCohortRows.length} sponsor rows missing from the input CSV; refusing a partial pilot.`,
      );
    }
  }
  const knownSitesState = await readOptionalFile(options.knownSitesFile);
  const knownSourcesState = await readOptionalFile(options.knownSourcesFile);
  if (!knownSitesState.exists) {
    throw new Error(`Known company-site cache not found: ${options.knownSitesFile}`);
  }
  if (!knownSourcesState.exists) {
    throw new Error(`Known vacancy-source cache not found: ${options.knownSourcesFile}`);
  }
  const knownCompanySiteRows = parseCsvObjects(knownSitesState.text);
  const knownVacancySourceRows = parseCsvObjects(knownSourcesState.text);
  const baselineByKey = new Map(baselineRows.map((row) => [stableKey(row), row]));

  const selection = selectRoutingRows(
    sourceRows,
    options.sector,
    options.batchSize,
    options.offset,
    previousRows,
    options.includeProcessed,
    unresolvedKeys,
  );
  if (selection.selectedRows.length === 0) {
    throw new Error(`No exact-${options.sector} sponsor rows remain for this batch selection.`);
  }

  if (await pathExists(options.output)) {
    throw new Error(`Refusing to overwrite existing output CSV ${options.output}. Choose a new --output path.`);
  }
  if (await pathExists(options.report)) {
    throw new Error(`Refusing to overwrite existing report ${options.report}. Choose a new --report path.`);
  }
  const inputHash = sha256(sourceText);
  const cqcState = await readOptionalFile(options.cqc);
  const cqcHash = cqcState.exists ? sha256(cqcState.text) : sha256("no-cqc-file");
  const previousHash = previousFile.exists ? sha256(previousFile.text) : sha256("no-previous-file");
  const unresolvedHash = unresolvedFile.exists ? sha256(unresolvedFile.text) : sha256("no-unresolved-file");
  const knownSitesHash = sha256(knownSitesState.text);
  const knownSourcesHash = sha256(knownSourcesState.text);
  const selectedKeys = selection.selectedRows.map(stableKey);
  const existingProgress = await loadProgress(options.progress);
  if (existingProgress && !options.resume) {
    throw new Error(
      `Progress file already exists at ${options.progress}; it was not replaced. Pass --resume or choose a new --progress path.`,
    );
  }
  if (existingProgress) {
    validateProgress(
      existingProgress,
      options,
      inputHash,
      cqcHash,
      previousHash,
      unresolvedHash,
      knownSitesHash,
      knownSourcesHash,
      selectedKeys,
    );
  }

  const progress: ProgressFile = existingProgress ?? {
    schemaVersion: 2,
    sector: options.sector,
    inputPath: options.input,
    inputSha256: inputHash,
    cqcPath: options.cqc,
    cqcSha256: cqcHash,
    previousFilePath: options.previousFile,
    previousFileSha256: previousHash,
    unresolvedFilePath: options.unresolvedFile,
    unresolvedFileSha256: unresolvedHash,
    knownSitesFileSha256: knownSitesHash,
    knownSourcesFileSha256: knownSourcesHash,
    batchSize: options.batchSize,
    offset: options.offset,
    batchNumber: options.batchNumber,
    includeProcessed: options.includeProcessed,
    searchEnabled: options.searchEnabled,
    cacheEnabled: options.cacheEnabled,
    maxSearchesPerSponsor: options.maxSearchesPerSponsor,
    maxTotalSearches: options.maxTotalSearches,
    maxConcurrency: options.maxConcurrency,
    selectedKeys,
    updatedAt: new Date().toISOString(),
    rows: {},
  };

  const cqcRecords = cqcState.exists && options.sector === "Healthcare"
    ? await officialRecordsFromFile(options.cqc, "cqc", CQC_EVIDENCE_URL)
    : [];
  const cqcMatcher = createOfficialRecordMatcher(cqcRecords);
  const fetcher = new PublicSiteFetcher(options.delayMs);
  const bingConfigured = Boolean(process.env.BING_SEARCH_API_KEY);
  const runtime: DiscoveryRuntime = {
    options,
    searchConfigured: bingConfigured,
    searchCache: await loadSearchCache(options.searchCacheFile, options.cacheEnabled),
    searchCacheLoaded: true,
    pageRequests: new Map(),
    searchFlights: new Map(),
    sponsorListFlights: new Map(),
    totalSearches: Object.values(progress.rows).reduce(
      (total, result) => total + (result.searchCount ?? 0),
      0,
    ),
    searchCacheHits: 0,
    pageCacheHits: 0,
    cacheWriteChain: Promise.resolve(),
  };
  const searchAccess = await verifySearchAvailability(fetcher, bingConfigured, runtime);
  console.log(`[vacancy-source-routing] ${searchAccess.message}`);
  console.log(
    `[vacancy-source-routing] selected ${selection.selectedRows.length}/${options.batchSize} exact-${options.sector} sponsors; resuming ${selection.selectedRows.filter((source) => progress.rows[stableKey(source)]).length} completed rows`,
  );

  let nextIndex = 0;
  let progressWriteChain = Promise.resolve();
  const checkpointProgress = (): Promise<void> => {
    const snapshot = `${JSON.stringify({
      ...progress,
      updatedAt: new Date().toISOString(),
    }, null, 2)}\n`;
    progressWriteChain = progressWriteChain.then(() => atomicReplace(options.progress, snapshot));
    return progressWriteChain;
  };
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= selection.selectedRows.length) return;
      const source = selection.selectedRows[index]!;
      const key = stableKey(source);
      if (progress.rows[key]) {
        console.log(`[vacancy-source-routing] ${index + 1}/${selection.selectedRows.length} resumed ${key}`);
        continue;
      }
      const displayId = text(source, "sponsor_licence_id") || key;
      console.log(
        `[vacancy-source-routing] ${index + 1}/${selection.selectedRows.length} checking ${displayId} ${text(source, "organisation_name")}`,
      );
      let result: RoutingResult;
      try {
        result = await discoverSponsor(
          source,
          options,
          fetcher,
          cqcMatcher,
          searchAccess.sponsorListAvailable,
          runtime,
          knownCompanySiteRows,
          knownVacancySourceRows,
          baselineByKey,
        );
      } catch (error) {
        const row = makeBaseRow(source);
        const message = error instanceof Error ? error.message : String(error);
        row.notes = `Discovery failed explicitly: ${message}`;
        result = {
          row,
          attempts: 0,
          retries: 0,
          failureClass: "unexpected_discovery_error",
          secondaryRoutes: [],
          searchCount: 0,
          cacheHits: 0,
          robotsBlocked: 0,
          identityFailures: 0,
        };
      }
      progress.rows[key] = result;
      await checkpointProgress();
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(options.maxConcurrency, selection.selectedRows.length) },
    () => worker(),
  ));
  await progressWriteChain;
  await runtime.cacheWriteChain;

  const results = selection.selectedRows.map((source) => progress.rows[stableKey(source)]!);
  const rows = results.map((result) => result.row);
  const report = reportMarkdown({
    options,
    inputRows: sourceRows.length,
    selection,
    rows,
    results,
    searchStatus: searchAccess.message,
    bingConfigured,
    cqcRecords: cqcRecords.length,
    previousRows,
    baselineRows,
    cqcPathPresent: cqcState.exists,
    searchCacheHits: runtime.searchCacheHits,
    pageCacheHits: runtime.pageCacheHits,
    sponsorListAvailable: searchAccess.sponsorListAvailable,
    searchAccessAttempts: searchAccess.attempts,
    runtimeMs: Date.now() - runtimeStartedAt,
    knownCompanySiteRows: knownCompanySiteRows.length,
    knownVacancySourceRows: knownVacancySourceRows.length,
    outputPath: options.output,
    reportPath: options.report,
    progressPath: options.progress,
  });

  await writeExclusive(options.output, stringifyCsv(rows, VACANCY_SOURCE_ROUTING_COLUMNS));
  await writeExclusive(options.report, report);
  const attempts = results.reduce((total, result) => total + result.attempts, searchAccess.attempts);
  const retries = results.reduce((total, result) => total + result.retries, searchAccess.retries);
  const totalSearchCount = results.reduce((total, result) => total + result.searchCount, 0);
  const totalCacheHits = results.reduce((total, result) => total + result.cacheHits, 0);
  const totalBlocked = results.reduce((total, result) => total + result.robotsBlocked, 0);
  const totalIdentityFailures = results.reduce((total, result) => total + result.identityFailures, 0);
  progress.updatedAt = new Date().toISOString();
  await atomicReplace(options.progress, `${JSON.stringify({
    ...progress,
    updatedAt: progress.updatedAt,
    completion: {
      completedRows: rows.length,
      output: options.output,
      report: options.report,
      routeCounts: countBy(rows, "source_pipeline"),
      confidenceCounts: countBy(rows, "confidence"),
      attempts,
      retries,
      searchCount: totalSearchCount,
      cacheHits: totalCacheHits,
      robotsBlocked: totalBlocked,
      identityFailures: totalIdentityFailures,
      runtimeMs: Date.now() - runtimeStartedAt,
      searchAccess: searchAccess.message,
    },
  }, null, 2)}\n`);
  console.log(JSON.stringify({
    sector: options.sector,
    batchNumber: options.batchNumber,
    batchSize: options.batchSize,
    offset: options.offset,
    exactSectorRows: selection.exactSectorRows.length,
    uniqueSectorRows: selection.uniqueSectorRows.length,
    skippedPreviouslyProcessed: options.includeProcessed ? 0 : selection.skippedPreviouslyProcessed,
    processedSponsors: rows.length,
    routeCounts: countBy(rows, "source_pipeline"),
    confidenceCounts: countBy(rows, "confidence"),
    recommendationCounts: countBy(rows, "should_import"),
    attempts,
    retries,
    searchCount: totalSearchCount,
    cacheHits: totalCacheHits,
    robotsBlocked: totalBlocked,
    identityFailures: totalIdentityFailures,
    runtimeMs: Date.now() - runtimeStartedAt,
    output: options.output,
    report: options.report,
    progress: options.progress,
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runVacancySourceRoutingBatch()
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    });
}