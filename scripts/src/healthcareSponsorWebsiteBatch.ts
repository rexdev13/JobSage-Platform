import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseCsvObjects,
  readCsvFile,
  stringifyCsv,
} from "./sponsor-contact-discovery/csv";
import {
  createOfficialRecordMatcher,
  officialRecordsFromFile,
} from "./sponsor-contact-discovery/discovery";
import { PublicSiteFetcher, type PageResult } from "./sponsor-contact-discovery/http";
import type { SponsorInput } from "./sponsor-contact-discovery/types";

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "../..");
const resolveRepositoryPath = (path: string) => resolve(REPOSITORY_ROOT, path);
const DEFAULT_INPUT = resolve(
  REPOSITORY_ROOT,
  ".local/reports/sponsor-enrichment/jobsage-sponsor-base-export.csv",
);
const DEFAULT_CQC = resolve(
  REPOSITORY_ROOT,
  "scripts/data/cache/cqc-directory-2026-09-14.csv",
);
const DEFAULT_OUTPUT = resolve(
  REPOSITORY_ROOT,
  "artifacts/healthcare-sponsor-website-enrichment-batch1.csv",
);
const DEFAULT_REPORT = resolve(
  REPOSITORY_ROOT,
  "artifacts/healthcare-sponsor-website-enrichment-batch1-report.md",
);
const DEFAULT_CHECKPOINT = resolve(
  REPOSITORY_ROOT,
  ".local/state/healthcare-sponsor-website-batch/progress.json",
);
const CQC_EVIDENCE_URL = "https://www.cqc.org.uk/about-us/transparency/using-cqc-data";
const SPONSORLIST_API_URL = "https://sponsorlist.co.uk/wp-json/uks/v1/sponsors";
const SPONSORLIST_HOST = "sponsorlist.co.uk";
const MAX_BATCH_SIZE = 500;
const DEFAULT_DELAY_MS = 1_500;
const MAX_FETCH_ATTEMPTS = 3;

export const HEALTHCARE_BATCH_COLUMNS = [
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

type SourceRow = Record<string, string>;

export type HealthcareBatchRow = Record<(typeof HEALTHCARE_BATCH_COLUMNS)[number], string>;

type BatchOptions = {
  input: string;
  cqc: string;
  output: string;
  report: string;
  checkpoint: string;
  limit: number;
  offset: number;
  batchNumber: number;
  previousBatchPaths: string[];
  targetHealthcareLocation: boolean;
  delayMs: number;
  overwrite: boolean;
  fresh: boolean;
  noNetwork: boolean;
};

type DiscoveryResult = {
  row: HealthcareBatchRow;
  attempts: number;
  retryCount: number;
  failureClass: string;
};

type Checkpoint = {
  schemaVersion: 1;
  inputPath: string;
  inputSha256: string;
  cqcPath: string;
  cqcSha256: string;
  limit: number;
  offset: number;
  batchNumber?: number;
  previousBatchHashes?: string[];
  selectionMode?: "source-order" | "targeted-healthcare-location";
  updatedAt: string;
  rows: Record<string, DiscoveryResult>;
};

type TargetingMetrics = {
  remainingAfterProcessedExclusion: number;
  excludedPriorFailureRows: number;
  priorFailureEmployerNames: number;
  uniqueEmployerNames: number;
  rowsWithTownCity: number;
  careClinicNameRows: number;
  employerNamesContainingTownOrCounty: number;
  rowsMeetingAllFocusCriteria: number;
  selectedUniqueEmployerNames: number;
  selectedWithTownCity: number;
  selectedCareClinicNames: number;
  selectedWithNameLocationClue: number;
  selectedMeetingAllFocusCriteria: number;
};

type Selection = {
  exactHealthcareRows: SourceRow[];
  needsEnrichmentRows: SourceRow[];
  selectedRows: SourceRow[];
  duplicateIds: number;
  duplicateEntityKeys: number;
  repeatedNameTownPairs: number;
  selectionMode: "source-order" | "targeted-healthcare-location";
  previouslyProcessedRowsExcluded: number;
  selectedStart: number;
  targeting?: TargetingMetrics;
};

const EXISTING_SIGNAL_COLUMNS = [
  "existing_website",
  "existing_careers_url",
  "existing_ats_provider",
  "existing_ats_board_id",
  "existing_ats_mapping_status",
  "existing_ats_mapping_evidence_url",
] as const;

const CAREER_WORDS = /\b(careers?|jobs?|vacancies|work with us|join us|recruit(?:ment|ing)?)\b/i;
const CAREER_PATHS = ["/careers", "/jobs", "/vacancies", "/work-with-us", "/join-us"];
const CARE_HOME_OR_CLINIC_NAME =
  /\b(care home|care homes|nursing home|nursing homes|residential home|residential homes|clinic|clinics|medical centre|medical centers?|health centre|health centers?|dental practice|dental clinic|surgery|surgeries)\b/i;
const GENERIC_IDENTITY_WORDS = new Set([
  "a", "an", "and", "at", "care", "centre", "centres", "clinic", "clinics",
  "dental", "dentistry", "doctor", "doctors", "group", "health", "healthcare",
  "home", "homes", "hospital", "hospitals", "limited", "ltd", "medical",
  "medicine", "nursing", "pharmacy", "practice", "practices", "services",
  "surgery", "surgeries", "the", "uk", "united", "kingdom", "company", "co",
]);
const BLOCKED_OFFICIAL_HOSTS = [
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
  "indeed.com",
  "reed.co.uk",
  "glassdoor.com",
  "visajob.co.uk",
  "open.endole.co.uk",
  "pharmdata.co.uk",
];

function text(row: SourceRow, key: string): string {
  return row[key]?.trim() ?? "";
}

function normalizeName(value: string): string {
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

function rowHasExistingSignal(row: SourceRow): boolean {
  return EXISTING_SIGNAL_COLUMNS.some((column) => Boolean(text(row, column)));
}

function stableEntityKey(row: SourceRow): string {
  const id = text(row, "sponsor_licence_id");
  if (id) return `id:${id}`;
  return `name-town:${normalizeName(text(row, "organisation_name"))}|${normalizeName(text(row, "town_city"))}`;
}

export function selectHealthcareRows(
  sourceRows: SourceRow[],
  limit = MAX_BATCH_SIZE,
  offset = 0,
  config: {
    previousBatchRows?: SourceRow[];
    targetHealthcareLocation?: boolean;
  } = {},
): Selection {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH_SIZE) {
    throw new Error(`Batch limit must be between 1 and ${MAX_BATCH_SIZE}.`);
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("Batch offset must be a non-negative integer.");
  }

  const exactHealthcareRows = sourceRows.filter((row) => text(row, "industry") === "Healthcare");
  const seenIds = new Set<string>();
  const seenFallbackKeys = new Set<string>();
  const nameTownCounts = new Map<string, number>();
  const uniqueRows: SourceRow[] = [];
  let duplicateIds = 0;
  let duplicateEntityKeys = 0;
  let repeatedNameTownPairs = 0;

  for (const row of exactHealthcareRows) {
    const nameTownKey = `${normalizeName(text(row, "organisation_name"))}|${normalizeName(text(row, "town_city"))}`;
    const previousNameTownCount = nameTownCounts.get(nameTownKey) ?? 0;
    if (previousNameTownCount > 0) repeatedNameTownPairs += 1;
    nameTownCounts.set(nameTownKey, previousNameTownCount + 1);
    const id = text(row, "sponsor_licence_id");
    if (id) {
      if (seenIds.has(id)) {
        duplicateIds += 1;
        continue;
      }
      seenIds.add(id);
      uniqueRows.push(row);
      continue;
    }
    const entityKey = stableEntityKey(row);
    if (seenFallbackKeys.has(entityKey)) {
      duplicateEntityKeys += 1;
      continue;
    }
    seenFallbackKeys.add(entityKey);
    uniqueRows.push(row);
  }

  const needsEnrichmentRows = uniqueRows.filter((row) => !rowHasExistingSignal(row));
  const previousRows = config.previousBatchRows ?? [];
  const previousEntityKeys = new Set(previousRows.map(stableEntityKey));
  const notPreviouslyProcessed = needsEnrichmentRows.filter((row) =>
    !previousEntityKeys.has(stableEntityKey(row)),
  );
  const previouslyProcessedRowsExcluded =
    needsEnrichmentRows.length - notPreviouslyProcessed.length;

  if (config.targetHealthcareLocation) {
    if (previousRows.length === 0) {
      throw new Error("Targeted healthcare selection requires at least one previous batch CSV.");
    }
    const priorFailureNames = new Set(
      previousRows
        .filter((row) => /\brobots(?:\.txt)?\b|could not be safely checked|website[_ ]unreachable|timed? ?out|ENOTFOUND|ECONNREFUSED/i.test(text(row, "notes")))
        .map((row) => normalizeName(text(row, "organisation_name")))
        .filter(Boolean),
    );
    const candidates = notPreviouslyProcessed.filter((row) =>
      !priorFailureNames.has(normalizeName(text(row, "organisation_name"))),
    );
    const excludedPriorFailureRows = notPreviouslyProcessed.length - candidates.length;
    const employerNameCounts = new Map<string, number>();
    for (const row of uniqueRows) {
      const key = normalizeName(text(row, "organisation_name"));
      if (key) employerNameCounts.set(key, (employerNameCounts.get(key) ?? 0) + 1);
    }
    const sourceIndexes = new Map(needsEnrichmentRows.map((row, index) => [row, index]));
    const scored = candidates.map((row) => {
      const nameKey = normalizeName(text(row, "organisation_name"));
      const town = normalizeName(text(row, "town_city"));
      const county = normalizeName(text(row, "county"));
      const normalizedName = normalizeName(text(row, "organisation_name"));
      const uniqueName = (employerNameCounts.get(nameKey) ?? 0) === 1;
      const hasTown = Boolean(text(row, "town_city"));
      const careClinicName = CARE_HOME_OR_CLINIC_NAME.test(normalizedName);
      const nameLocationClue = Boolean(
        (town && ` ${normalizedName} `.includes(` ${town} `)) ||
        (county && ` ${normalizedName} `.includes(` ${county} `)),
      );
      const score =
        Number(uniqueName) * 1_000 +
        Number(hasTown) * 500 +
        Number(careClinicName) * 300 +
        Number(nameLocationClue) * 100;
      return {
        row,
        score,
        sourceIndex: sourceIndexes.get(row) ?? Number.MAX_SAFE_INTEGER,
        uniqueName,
        hasTown,
        careClinicName,
        nameLocationClue,
      };
    }).sort((left, right) =>
      right.score - left.score || left.sourceIndex - right.sourceIndex,
    );
    const selected = scored.slice(offset, offset + limit);
    const count = (
      predicate: (candidate: typeof scored[number]) => boolean,
      values: typeof scored,
    ) => values.filter(predicate).length;
    return {
      exactHealthcareRows,
      needsEnrichmentRows,
      selectedRows: selected.map((candidate) => candidate.row),
      duplicateIds,
      duplicateEntityKeys,
      repeatedNameTownPairs,
      selectionMode: "targeted-healthcare-location",
      previouslyProcessedRowsExcluded,
      selectedStart: selected.length ? offset + 1 : 0,
      targeting: {
        remainingAfterProcessedExclusion: notPreviouslyProcessed.length,
        excludedPriorFailureRows,
        priorFailureEmployerNames: priorFailureNames.size,
        uniqueEmployerNames: count((candidate) => candidate.uniqueName, scored),
        rowsWithTownCity: count((candidate) => candidate.hasTown, scored),
        careClinicNameRows: count((candidate) => candidate.careClinicName, scored),
        employerNamesContainingTownOrCounty: count((candidate) => candidate.nameLocationClue, scored),
        rowsMeetingAllFocusCriteria: count(
          (candidate) => candidate.uniqueName && candidate.hasTown && candidate.careClinicName && candidate.nameLocationClue,
          scored,
        ),
        selectedUniqueEmployerNames: count((candidate) => candidate.uniqueName, selected),
        selectedWithTownCity: count((candidate) => candidate.hasTown, selected),
        selectedCareClinicNames: count((candidate) => candidate.careClinicName, selected),
        selectedWithNameLocationClue: count((candidate) => candidate.nameLocationClue, selected),
        selectedMeetingAllFocusCriteria: count(
          (candidate) => candidate.uniqueName && candidate.hasTown && candidate.careClinicName && candidate.nameLocationClue,
          selected,
        ),
      },
    };
  }

  return {
    exactHealthcareRows,
    needsEnrichmentRows,
    selectedRows: notPreviouslyProcessed.slice(offset, offset + limit),
    duplicateIds,
    duplicateEntityKeys,
    repeatedNameTownPairs,
    selectionMode: "source-order",
    previouslyProcessedRowsExcluded,
    selectedStart: notPreviouslyProcessed.slice(offset, offset + limit).length ? offset + 1 : 0,
  };
}

function parseOptions(args: string[]): BatchOptions {
  const options: BatchOptions = {
    input: DEFAULT_INPUT,
    cqc: DEFAULT_CQC,
    output: DEFAULT_OUTPUT,
    report: DEFAULT_REPORT,
    checkpoint: DEFAULT_CHECKPOINT,
    limit: MAX_BATCH_SIZE,
    offset: 0,
    batchNumber: 1,
    previousBatchPaths: [],
    targetHealthcareLocation: false,
    delayMs: DEFAULT_DELAY_MS,
    overwrite: false,
    fresh: false,
    noNetwork: false,
  };
  const values = new Map<string, (value: string) => void>([
    ["--input", (value) => { options.input = resolveRepositoryPath(value); }],
    ["--cqc", (value) => { options.cqc = resolveRepositoryPath(value); }],
    ["--output", (value) => { options.output = resolveRepositoryPath(value); }],
    ["--report", (value) => { options.report = resolveRepositoryPath(value); }],
    ["--checkpoint", (value) => { options.checkpoint = resolveRepositoryPath(value); }],
    ["--limit", (value) => { options.limit = Number(value); }],
    ["--offset", (value) => { options.offset = Number(value); }],
    ["--batch-number", (value) => { options.batchNumber = Number(value); }],
    ["--delay-ms", (value) => { options.delayMs = Number(value); }],
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--") continue;
    if (argument === "--overwrite") {
      options.overwrite = true;
      continue;
    }
    if (argument === "--fresh") {
      options.fresh = true;
      continue;
    }
    if (argument === "--no-network") {
      options.noNetwork = true;
      continue;
    }
    if (argument === "--target-healthcare-location") {
      options.targetHealthcareLocation = true;
      continue;
    }
    if (argument === "--previous-batch") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error("Missing value for --previous-batch");
      options.previousBatchPaths.push(resolveRepositoryPath(value));
      index += 1;
      continue;
    }
    const setter = values.get(argument);
    if (!setter) throw new Error(`Unknown option: ${argument}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    setter(value);
    index += 1;
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > MAX_BATCH_SIZE) {
    throw new Error(`--limit must be between 1 and ${MAX_BATCH_SIZE}.`);
  }
  if (!Number.isInteger(options.offset) || options.offset < 0) {
    throw new Error("--offset must be a non-negative integer.");
  }
  if (!Number.isInteger(options.batchNumber) || options.batchNumber < 1 || options.batchNumber > 6) {
    throw new Error("--batch-number must be between 1 and 6.");
  }
  if (options.targetHealthcareLocation) {
    if (options.batchNumber !== 2 || options.offset !== 0 || options.previousBatchPaths.length === 0) {
      throw new Error(
        "--target-healthcare-location is only valid for batch 2, with offset 0 and at least one --previous-batch.",
      );
    }
  }
  if (!Number.isInteger(options.delayMs) || options.delayMs < 1_000) {
    throw new Error("--delay-ms must be at least 1000 to respect public-host rate limits.");
  }
  return options;
}

async function fileHash(path: string): Promise<string> {
  return sha256(await readFile(path));
}

function emptyOutputRow(source: SourceRow): HealthcareBatchRow {
  return {
    sponsor_licence_id: text(source, "sponsor_licence_id"),
    organisation_name: text(source, "organisation_name"),
    normalized_organisation_name: text(source, "normalized_organisation_name") ||
      normalizeName(text(source, "organisation_name")),
    town_city: text(source, "town_city"),
    county: text(source, "county"),
    region: text(source, "region"),
    industry: text(source, "industry"),
    route: text(source, "route"),
    sub_route: text(source, "sub_route"),
    rating: text(source, "rating"),
    existing_website: text(source, "existing_website"),
    existing_careers_url: text(source, "existing_careers_url"),
    existing_ats_provider: text(source, "existing_ats_provider"),
    existing_ats_board_id: text(source, "existing_ats_board_id"),
    existing_ats_mapping_status: text(source, "existing_ats_mapping_status"),
    existing_ats_mapping_evidence_url: text(source, "existing_ats_mapping_evidence_url"),
    website_url: "",
    website_confidence: "none",
    website_evidence_url: "",
    careers_url: "",
    careers_confidence: "none",
    careers_evidence_url: "",
    ats_provider: "",
    ats_board_id: "",
    ats_mapping_status: "",
    ats_mapping_evidence_url: "",
    source: "",
    source_evidence_url: "",
    notes: "",
  };
}

function htmlText(html: string): string {
  return decodeHtml(html
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " "));
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

function identityTokens(organisationName: string): string[] {
  return [...new Set(normalizeName(organisationName)
    .split(" ")
    .filter((token) => token.length >= 3 && !GENERIC_IDENTITY_WORDS.has(token)))];
}

function identityMatches(source: SourceRow, page: PageResult): {
  accepted: boolean;
  confidence: "high" | "medium" | "none";
  reason: string;
} {
  const tokens = identityTokens(text(source, "organisation_name"));
  const body = normalizeName(htmlText(page.body));
  const host = normalizeName(new URL(page.url).hostname);
  const pageMatches = tokens.filter((token) => body.includes(token));
  const hostMatches = tokens.filter((token) => host.includes(token));
  if (tokens.length === 0) {
    return { accepted: false, confidence: "none", reason: "employer name has no distinctive identity token" };
  }
  if (pageMatches.length === 0 || (hostMatches.length === 0 && pageMatches.length < 2)) {
    return { accepted: false, confidence: "none", reason: "employer identity was not corroborated on the candidate website" };
  }
  const locationTerms = [text(source, "town_city"), text(source, "county")]
    .map(normalizeName)
    .filter((term) => term.length >= 4);
  const locationMatches = locationTerms.some((term) => body.includes(term));
  const confidence = locationMatches && (pageMatches.length >= 2 || hostMatches.length > 0)
    ? "high"
    : "medium";
  return {
    accepted: true,
    confidence,
    reason: locationMatches
      ? "employer brand and stored location appear on the first-party page"
      : "employer brand appears on the first-party page; location remains unconfirmed",
  };
}

function blockedHost(hostname: string): boolean {
  const host = hostname.toLocaleLowerCase("en-GB").replace(/^www\./, "");
  return BLOCKED_OFFICIAL_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function secureCandidateUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname.includes(".") ||
      url.username ||
      url.password ||
      blockedHost(url.hostname)
    ) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

type SponsorListRecord = {
  name?: string;
  city?: string;
  county?: string;
  url?: string;
  enrichment?: { website?: string };
};

export type SponsorListLead = {
  website: string;
  evidenceUrl: string;
};

function locationOverlap(source: SourceRow, record: SponsorListRecord): boolean {
  const sourceLocations = [text(source, "town_city"), text(source, "county")]
    .map(normalizeName)
    .filter((value) => value.length >= 4);
  if (sourceLocations.length === 0) return true;
  const directoryLocations = [record.city ?? "", record.county ?? ""]
    .map(normalizeName)
    .filter((value) => value.length >= 4);
  return sourceLocations.some((sourceLocation) =>
    directoryLocations.some((directoryLocation) =>
      sourceLocation === directoryLocation ||
      sourceLocation.includes(directoryLocation) ||
      directoryLocation.includes(sourceLocation),
    ),
  );
}

export function selectSponsorListLead(
  source: SourceRow,
  records: SponsorListRecord[],
): SponsorListLead | null {
  const expectedName = normalizeName(text(source, "organisation_name"));
  const exactRecords = records.filter((record) =>
    normalizeName(record.name ?? "") === expectedName && locationOverlap(source, record),
  );
  const candidates = exactRecords.flatMap((record) => {
    const website = secureCandidateUrl(record.enrichment?.website ?? "");
    if (!website) return [];
    try {
      const evidence = new URL(record.url ?? "");
      if (
        evidence.protocol !== "https:" ||
        evidence.hostname !== SPONSORLIST_HOST ||
        !evidence.pathname.startsWith("/sponsors/")
      ) return [];
      return [{ website, evidenceUrl: evidence.toString() }];
    } catch {
      return [];
    }
  });
  if (candidates.length === 0) return null;
  const origins = new Set(candidates.map((candidate) => new URL(candidate.website).origin));
  if (origins.size !== 1) return null;
  return candidates[0]!;
}

type SponsorListLookupResult = {
  lead: SponsorListLead | null;
  attempts: number;
  retries: number;
  error: string;
};

const sponsorListLookupCache = new Map<string, Promise<SponsorListLookupResult>>();

async function querySponsorList(
  source: SourceRow,
  fetcher: PublicSiteFetcher,
): Promise<SponsorListLookupResult> {
  const searchUrl = new URL(SPONSORLIST_API_URL);
  searchUrl.searchParams.set("search", text(source, "organisation_name"));
  searchUrl.searchParams.set("per_page", "100");
  const fetched = await fetchWithRetry(fetcher, searchUrl.toString(), SPONSORLIST_HOST);
  if (!fetched.page) {
    return { lead: null, attempts: fetched.attempts, retries: fetched.retries, error: fetched.error };
  }
  try {
    const payload = JSON.parse(fetched.page.body) as { sponsors?: SponsorListRecord[] };
    const lead = selectSponsorListLead(source, Array.isArray(payload.sponsors) ? payload.sponsors : []);
    return { lead, attempts: fetched.attempts, retries: fetched.retries, error: "" };
  } catch (error) {
    return {
      lead: null,
      attempts: fetched.attempts,
      retries: fetched.retries,
      error: `invalid SponsorList response: ${String(error)}`,
    };
  }
}

async function sponsorListLead(
  source: SourceRow,
  fetcher: PublicSiteFetcher,
): Promise<SponsorListLookupResult> {
  const cacheKey = [
    normalizeName(text(source, "organisation_name")),
    normalizeName(text(source, "town_city")),
    normalizeName(text(source, "county")),
  ].join("|");
  const existing = sponsorListLookupCache.get(cacheKey);
  if (existing) {
    const cached = await existing;
    return { ...cached, attempts: 0, retries: 0 };
  }
  const pending = querySponsorList(source, fetcher);
  sponsorListLookupCache.set(cacheKey, pending);
  return pending;
}

type Anchor = { href: string; label: string; sourceUrl: string };

function extractAnchors(html: string, pageUrl: string): Anchor[] {
  const result: Anchor[] = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const attributes = match[1] ?? "";
    const href = attributes.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const rawHref = decodeHtml(href?.[1] ?? href?.[2] ?? href?.[3] ?? "").trim();
    const label = `${htmlText(match[2] ?? "")} ${attributes.match(/\b(?:title|aria-label)\s*=\s*(?:"([^"]*)"|'([^']*)')/i)?.[1] ?? ""}`
      .replace(/\s+/g, " ")
      .trim();
    try {
      const url = new URL(rawHref, pageUrl);
      if (url.protocol !== "https:" || url.username || url.password) continue;
      result.push({ href: url.toString(), label, sourceUrl: pageUrl });
    } catch {
      // Ignore non-URL navigation elements and malformed links.
    }
  }
  return result;
}

function careersCandidate(anchors: Anchor[], employerHost: string): Anchor | undefined {
  return anchors
    .filter((anchor) => CAREER_WORDS.test(`${anchor.label} ${anchor.href}`))
    .filter((anchor) => {
      try {
        const host = new URL(anchor.href).hostname;
        return host === employerHost || host.endsWith(`.${employerHost}`) || atsDetails(anchor.href) !== null;
      } catch {
        return false;
      }
    })
    .sort((left, right) => left.href.localeCompare(right.href))[0];
}

function atsDetails(value: string): { provider: string; boardId: string } | null {
  try {
    const url = new URL(value);
    const segments = url.pathname.split("/").filter(Boolean);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "jobs.ashbyhq.com" && segments[0]) {
      return { provider: "Ashby", boardId: segments[0] };
    }
    if (
      (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") &&
      segments[0]
    ) {
      return { provider: "Greenhouse", boardId: segments[0] };
    }
    if (host === "jobs.lever.co" && segments[0]) {
      return { provider: "Lever", boardId: segments[0] };
    }
  } catch {
    return null;
  }
  return null;
}

function careersPathCandidate(website: string, path: string): string {
  const url = new URL(website);
  url.pathname = path;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function sponsorInput(source: SourceRow): SponsorInput {
  return {
    organisationName: text(source, "organisation_name"),
    townCity: text(source, "town_city"),
    county: text(source, "county"),
    industry: text(source, "industry"),
    website: "",
    contactEmail: "",
    postcode: "",
  };
}

function retryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /HTTP (?:408|425|429|5\d\d)|timed? ?out|timeout|fetch failed|ECONNRESET|EAI_AGAIN|socket/i.test(message);
}

async function fetchWithRetry(
  fetcher: PublicSiteFetcher,
  url: string,
  confirmedHost: string,
): Promise<{ page: PageResult | null; attempts: number; retries: number; error: string }> {
  let lastError = "";
  for (let attempt = 1; attempt <= MAX_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const page = await fetcher.fetch(url, confirmedHost);
      return { page, attempts: attempt, retries: attempt - 1, error: "" };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt >= MAX_FETCH_ATTEMPTS || !retryable(error)) {
        return { page: null, attempts: attempt, retries: attempt - 1, error: lastError };
      }
      const backoff = Math.min(8_000, 1_000 * 2 ** (attempt - 1));
      console.warn(`[healthcare-sponsor-batch] retry ${attempt + 1}/${MAX_FETCH_ATTEMPTS} after ${lastError}`);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, backoff));
    }
  }
  return { page: null, attempts: MAX_FETCH_ATTEMPTS, retries: MAX_FETCH_ATTEMPTS - 1, error: lastError };
}

async function optionalBingLead(
  source: SourceRow,
  delayMs: number,
): Promise<{ website: string; searchEvidence: string } | null> {
  const key = process.env.BING_SEARCH_API_KEY;
  if (!key) return null;
  const elapsed = Date.now() - lastBingSearchAt;
  if (elapsed < delayMs) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs - elapsed));
  }
  lastBingSearchAt = Date.now();
  const searchUrl = new URL("https://api.bing.microsoft.com/v7.0/search");
  searchUrl.search = new URLSearchParams({
    q: `official website "${text(source, "organisation_name")}" "${text(source, "town_city")}"`,
    count: "10",
    safeSearch: "Strict",
  }).toString();
  try {
    const response = await fetch(searchUrl, {
      headers: { "Ocp-Apim-Subscription-Key": key, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return null;
    const result = await response.json() as {
      webPages?: { value?: Array<{ url?: string; name?: string; snippet?: string }> };
    };
    const tokens = identityTokens(text(source, "organisation_name"));
    for (const page of result.webPages?.value ?? []) {
      const candidate = secureCandidateUrl(page.url ?? "");
      if (!candidate) continue;
      const evidenceText = normalizeName(`${page.name ?? ""} ${page.snippet ?? ""}`);
      const alignedTokens = tokens.filter((token) => evidenceText.includes(token));
      if (alignedTokens.length === 0) continue;
      console.log(`[healthcare-sponsor-batch] search lead only: ${text(source, "organisation_name")} -> ${candidate}`);
      return { website: candidate, searchEvidence: page.url ?? "" };
    }
  } catch (error) {
    console.warn(`[healthcare-sponsor-batch] search unavailable for ${text(source, "organisation_name")}: ${String(error)}`);
  }
  await new Promise((resolveDelay) => setTimeout(resolveDelay, delayMs));
  return null;
}

let lastBingSearchAt = 0;

async function discoverOne(
  source: SourceRow,
  cqcMatcher: ReturnType<typeof createOfficialRecordMatcher>,
  fetcher: PublicSiteFetcher,
  options: BatchOptions,
): Promise<DiscoveryResult> {
  const row = emptyOutputRow(source);
  const reasons: string[] = [];
  let attempts = 0;
  let retryCount = 0;
  let failureClass = "no_official_candidate";
  let candidateUrl = "";
  let leadEvidenceUrl = "";
  let sourceLabel = "";
  const cqcMatch = cqcMatcher(sponsorInput(source));

  if (cqcMatch) {
    sourceLabel = `CQC ${cqcMatch.method}/${cqcMatch.confidence} lead`;
    leadEvidenceUrl = cqcMatch.record.evidenceUrl || CQC_EVIDENCE_URL;
    candidateUrl = secureCandidateUrl(cqcMatch.record.website ?? "") ?? "";
    if (!candidateUrl) reasons.push("CQC match supplied no eligible employer website URL");
  } else {
    reasons.push("no unambiguous CQC name/location match");
  }

  if (!candidateUrl && !options.noNetwork) {
    const sponsorList = await sponsorListLead(source, fetcher);
    attempts += sponsorList.attempts;
    retryCount += sponsorList.retries;
    if (sponsorList.lead) {
      candidateUrl = sponsorList.lead.website;
      leadEvidenceUrl = sponsorList.lead.evidenceUrl;
      sourceLabel = "SponsorList public directory lead";
    } else if (sponsorList.error) {
      reasons.push(`SponsorList lookup unavailable: ${sponsorList.error}`);
    } else {
      reasons.push("SponsorList had no exact name/location match with an employer website");
    }
  }

  if (!candidateUrl && !options.noNetwork && process.env.BING_SEARCH_API_KEY) {
    const searchLead = await optionalBingLead(source, options.delayMs);
    if (searchLead) {
      candidateUrl = searchLead.website;
      leadEvidenceUrl = searchLead.searchEvidence;
      sourceLabel = "Bing search result lead";
    } else {
      reasons.push("search returned no eligible identity-aligned employer-domain lead");
    }
  }

  if (!candidateUrl) {
    if (options.noNetwork) {
      reasons.push("network access was disabled for this run");
      failureClass = "network_disabled";
    } else if (reasons.some((reason) => reason.startsWith("SponsorList lookup unavailable"))) {
      failureClass = "sponsorlist_unavailable";
    } else if (reasons.some((reason) => reason.startsWith("SponsorList had no exact"))) {
      failureClass = "sponsorlist_no_exact_match";
    } else if (!process.env.BING_SEARCH_API_KEY && !cqcMatch) {
      failureClass = "sponsorlist_no_exact_match";
    } else if (cqcMatch) {
      failureClass = "cqc_no_website";
    }
    row.source = sourceLabel || "CQC and cached public-source lookup";
    row.source_evidence_url = leadEvidenceUrl;
    row.notes = reasons.join("; ");
    return { row, attempts, retryCount, failureClass };
  }

  if (options.noNetwork) {
    reasons.push("network access was disabled for this run; candidate URL left unverified");
    row.source = sourceLabel;
    row.source_evidence_url = leadEvidenceUrl;
    row.notes = reasons.join("; ");
    return { row, attempts, retryCount, failureClass: "network_disabled" };
  }

  const employerHost = new URL(candidateUrl).hostname;
  const homeUrl = new URL("/", candidateUrl).toString();
  const home = await fetchWithRetry(fetcher, homeUrl, employerHost);
  attempts += home.attempts;
  retryCount += home.retries;
  if (!home.page) {
    reasons.push(`candidate website could not be safely checked: ${home.error}`);
    row.source = sourceLabel;
    row.source_evidence_url = leadEvidenceUrl;
    row.notes = reasons.join("; ");
    failureClass = /robots/i.test(home.error) ? "robots_or_policy_block" : "website_unreachable";
    return { row, attempts, retryCount, failureClass };
  }

  const identity = identityMatches(source, home.page);
  if (!identity.accepted) {
    reasons.push(identity.reason);
    row.source = sourceLabel;
    row.source_evidence_url = leadEvidenceUrl;
    row.notes = reasons.join("; ");
    return { row, attempts, retryCount, failureClass: "identity_not_confirmed" };
  }

  row.website_url = home.page.url;
  row.website_confidence = identity.confidence;
  row.website_evidence_url = home.page.url;
  row.source = `${sourceLabel}; first-party page identity checked`;
  row.source_evidence_url = leadEvidenceUrl;
  failureClass = "";

  const anchors = extractAnchors(home.page.body, home.page.url);
  let careers = careersCandidate(anchors, employerHost);
  let careersPage: PageResult | null = null;
  if (careers) {
    const details = atsDetails(careers.href);
    const careersHost = new URL(careers.href).hostname;
    const destination = secureCandidateUrl(careers.href);
    if (!destination) {
      reasons.push("careers navigation target was unsafe or not HTTPS");
      careers = undefined;
    } else {
      const result = await fetchWithRetry(fetcher, destination, careersHost);
      attempts += result.attempts;
      retryCount += result.retries;
      if (result.page) {
        careersPage = result.page;
        row.careers_url = result.page.url;
        row.careers_confidence = "high";
        row.careers_evidence_url = careers.sourceUrl;
        if (details) {
          row.ats_provider = details.provider;
          row.ats_board_id = details.boardId;
          row.ats_mapping_status = "verified";
          row.ats_mapping_evidence_url = careers.sourceUrl;
        }
      } else {
        reasons.push(`linked careers destination could not be verified: ${result.error}`);
      }
    }
  }

  if (!careersPage) {
    const sameSiteAnchors = anchors.filter((anchor) => {
      try {
        const host = new URL(anchor.href).hostname;
        return host === employerHost || host.endsWith(`.${employerHost}`);
      } catch {
        return false;
      }
    });
    const paths = [
      ...sameSiteAnchors
        .filter((anchor) => CAREER_WORDS.test(`${anchor.label} ${anchor.href}`))
        .map((anchor) => anchor.href),
      ...CAREER_PATHS.map((path) => careersPathCandidate(home.page!.url, path)),
    ];
    for (const path of [...new Set(paths)]) {
      const result = await fetchWithRetry(fetcher, path, employerHost);
      attempts += result.attempts;
      retryCount += result.retries;
      if (!result.page) continue;
      const pageText = normalizeName(htmlText(result.page.body));
      const employerTokens = identityTokens(text(source, "organisation_name"));
      const employerEvidence = employerTokens.some((token) => pageText.includes(token));
      const pageLooksLikeCareers = CAREER_WORDS.test(`${result.page.url} ${htmlText(result.page.body)}`);
      if (employerEvidence && pageLooksLikeCareers) {
        careersPage = result.page;
        row.careers_url = result.page.url;
        row.careers_confidence = "medium";
        row.careers_evidence_url = result.page.url;
        break;
      }
    }
  }

  if (!row.careers_url) {
    row.careers_confidence = "none";
    reasons.push("no employer-linked, verifiable careers destination found");
    if (!failureClass) failureClass = "no_careers_destination";
  }
  row.notes = reasons.length ? reasons.join("; ") : "First-party employer identity verified; manual review remains required before import.";
  return { row, attempts, retryCount, failureClass };
}

async function loadCheckpoint(path: string): Promise<Checkpoint | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as Checkpoint;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Cannot read checkpoint ${path}: ${String(error)}`);
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
  await rename(temporary, path);
}

async function writeCheckpoint(path: string, checkpoint: Checkpoint): Promise<void> {
  checkpoint.updatedAt = new Date().toISOString();
  await atomicWrite(path, `${JSON.stringify(checkpoint, null, 2)}\n`);
}

async function backupIfExists(path: string, overwrite: boolean): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (!overwrite) {
    throw new Error(`Refusing to overwrite ${path}; pass --overwrite to create a timestamped backup first.`);
  }
  const backupDirectory = resolve(
    REPOSITORY_ROOT,
    ".local/state/healthcare-sponsor-website-batch/backups",
  );
  await mkdir(backupDirectory, { recursive: true });
  const backupPath = join(
    backupDirectory,
    `${basename(path)}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  await rename(path, backupPath);
  console.log(`[healthcare-sponsor-batch] backed up existing output to ${backupPath}`);
}

function markdownCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function reportMarkdown(options: {
  batchNumber: number;
  inputPath: string;
  inputRows: number;
  totalExact: number;
  needsEnrichment: number;
  selected: HealthcareBatchRow[];
  selection: Selection;
  cqcPath: string;
  cqcRows: number;
  noNetwork: boolean;
  searchKeyConfigured: boolean;
  outputPath: string;
  checkpointPath: string;
  previousBatchPaths: string[];
  relatedIndustryLabels: string;
}): string {
  const websiteConfidence = countValues(options.selected, "website_confidence");
  const careersConfidence = countValues(options.selected, "careers_confidence");
  const atsProviders = countValues(options.selected, "ats_provider");
  const sourceCounts = countValues(options.selected, "source");
  const outcomeCounts = countValues(
    options.selected.map((row) => ({ ...row, failure_class: failureReason(row) })),
    "failure_class",
  );
  const failureCounts = countValues(
    options.selected
      .filter((row) => !row.website_url)
      .map((row) => ({ ...row, failure_class: failureReason(row) })),
    "failure_class",
  );
  const industryCounts = new Map<string, number>();
  for (const row of options.selected) {
    const existing = industryCounts.get(row.industry) ?? 0;
    industryCounts.set(row.industry, existing + 1);
  }
  const manualRows = [
    ...options.selected.filter((row) => row.website_url).slice(0, 6),
    ...options.selected.filter((row) => !row.website_url && row.notes).slice(0, 6),
  ];
  const manualTable = manualRows.length
    ? [
      "| Sponsor ID | Employer | Website | Careers / ATS | Confidence | Evidence / review note |",
      "| --- | --- | --- | --- | --- | --- |",
      ...manualRows.map((row) =>
        `| ${markdownCell(row.sponsor_licence_id)} | ${markdownCell(row.organisation_name)} | ${markdownCell(row.website_url || "—")} | ${markdownCell(row.careers_url || "—")} | ${markdownCell(`website ${row.website_confidence}; careers ${row.careers_confidence}`)} | ${markdownCell(row.website_evidence_url || row.source_evidence_url || row.notes)} |`,
      ),
    ].join("\n")
    : "No website or careers claims were accepted. The first rows are listed below as examples of unresolved leads.";
  const unresolvedExamples = options.selected.filter((row) => !row.website_url).slice(0, 8)
    .map((row) => `- **${row.sponsor_licence_id} ${row.organisation_name}** (${row.town_city}): ${row.notes || "no verified candidate"}; search lead: ${row.source_evidence_url || "none"}`)
    .join("\n");
  const batchCounts = [
    `- Batch number: **${options.batchNumber}**`,
    `- Selection mode: **${options.selection.selectionMode}**`,
    `- Start position within this selection: **${options.selection.selectedStart}**`,
    `- Batch rows written: **${options.selected.length}** (limit 500)`,
    `- Previously processed rows excluded: **${options.selection.previouslyProcessedRowsExcluded}**`,
    `- Duplicate sponsor IDs omitted: **${options.selection.duplicateIds}**`,
    `- Name/town fallback duplicates omitted: **${options.selection.duplicateEntityKeys}**`,
    `- Rows sharing a normalized name/town but retained under distinct sponsor IDs: **${options.selection.repeatedNameTownPairs}**`,
    `- Website confidence counts: ${formatCounts(websiteConfidence)}`,
    `- Careers confidence counts: ${formatCounts(careersConfidence)}`,
    `- ATS mappings: ${formatCounts(atsProviders)}`,
    `- Lookup source counts: ${formatCounts(sourceCounts)}`,
    `- Lookup outcome categories: ${formatCounts(outcomeCounts)}`,
    `- Unresolved/failure categories: ${formatCounts(failureCounts)}`,
  ].join("\n");
  const targetingLines = options.selection.targeting
    ? [
      `- Remaining rows after excluding processed IDs: **${options.selection.targeting.remainingAfterProcessedExclusion}**`,
      `- Rows excluded because their normalized employer name had a batch-1 robots/unreachable result: **${options.selection.targeting.excludedPriorFailureRows}**`,
      `- Prior failure employer names excluded: **${options.selection.targeting.priorFailureEmployerNames}**`,
      `- Remaining unique employer-name rows: **${options.selection.targeting.uniqueEmployerNames}**`,
      `- Remaining rows with a town/city: **${options.selection.targeting.rowsWithTownCity}**`,
      `- Care-home/clinic/medical/dental/surgery name rows: **${options.selection.targeting.careClinicNameRows}**`,
      `- Employer names containing their town or county: **${options.selection.targeting.employerNamesContainingTownOrCounty}**`,
      `- Rows meeting all four focus signals: **${options.selection.targeting.rowsMeetingAllFocusCriteria}**`,
      `- Selected rows meeting all four focus signals: **${options.selection.targeting.selectedMeetingAllFocusCriteria}**`,
    ].join("\n")
    : [
      `- Prior batch CSVs excluded: **${options.previousBatchPaths.length}**`,
      `- Previous batch files: ${options.previousBatchPaths.map((path) => `\`${path}\``).join(", ") || "none"}`,
    ].join("\n");

  return `# Healthcare sponsor website enrichment — batch ${options.batchNumber}

Generated: ${new Date().toISOString()}

## Source and selection

- Canonical sponsor CSV: **not found** in the repository.
- Fallback input: \`${options.inputPath}\` (${options.inputRows.toLocaleString()} exported rows).
- Source selection: existing \`sponsor-enrichment-export\` command ran with \`NODE_ENV=development --confirm-development-db\`; its own safeguards accepted the target and it reported a development-only, read-only transaction. No data was written.
- All source sponsor rows reported by the export: **142,918**; exported rows: **${options.inputRows.toLocaleString()}**.
- Exact \`industry=Healthcare\` rows in the export: **${options.totalExact.toLocaleString()}**. All such rows were present because the export's rule classifier selects Healthcare values.
- Exact-Healthcare rows already carrying a website, careers URL, or ATS signal: **${options.totalExact - options.needsEnrichment}**.
- Deduplicated exact-Healthcare rows needing enrichment: **${options.needsEnrichment.toLocaleString()}**.
- Related source industry labels excluded from the candidate batch:
${options.relatedIndustryLabels}
- The selection is exact-case and exact-value only; Medical, Care, Dentistry, Pharmacy, Social Care, and other values are not eligible unless source industry equals \`Healthcare\`.
- Selection keeps sponsor IDs distinct; missing-ID fallback keys normalize employer name plus town/city. ${options.selection.selectionMode === "targeted-healthcare-location"
      ? "Batch 2 ranks unique employer names, town/city presence, care-home/clinic/medical/dental/surgery terms, and town/county clues. Employer names associated with a batch-1 robots block or unreachable-site error are excluded. Source order is the final tie-breaker."
      : "Remaining rows are source-ordered after excluding every prior batch ID."}

## Enrichment sources and evidence rules

- CQC directory lead file: \`${options.cqcPath}\` (${options.cqcRows.toLocaleString()} parsed records; cached source produced 2026-09-09, filename dated 2026-09-14). The CQC location page is recorded as a source lead, not as proof that the CQC listing is the employer website.
- SponsorList's published public sponsor-search API was queried for unresolved rows without a CQC website candidate. Results were matched on exact normalized employer name and town/county; its website field and profile URL remain leads only.
- Employer website claims are accepted only after a safe HTTPS fetch through the existing public-site fetcher and a direct first-party page identity check. The first-party page URL is the website evidence URL. CQC, SponsorList, and search results alone are never promoted.
- Careers URLs are accepted only when directly linked from the verified employer homepage or found at a conventional employer-hosted path, and the destination fetch succeeds. ATS mappings are limited to explicit Ashby, Greenhouse, or Lever board links and keep the employer-page link as mapping evidence.
- Web search was exercised on two initial records (ZVF PHARMA LTD / Slough and AZAAN HEALTHCARE (DUNDEE) LTD / Dundee). Results were directory/company-profile leads or unrelated similarly named organizations; no search result was accepted as an official URL. ${options.searchKeyConfigured ? "The optional Bing API is configured for the resumable script; each result remains a lead pending first-party verification." : "No Bing search API key was configured for the standalone resumable script; search-based discoveries remain available by supplying BING_SEARCH_API_KEY later."}
- ${options.noNetwork ? "This run disabled network verification; any candidate URLs remain blank." : "Public-site fetching honors HTTPS, public-DNS, same-site redirect, robots.txt, page-size, timeout, pacing, and bounded retry checks."}

## Batch results

${batchCounts}

The exact candidate industry values in this output were: ${[...industryCounts.keys()].map((value) => `\`${value}\``).join(", ") || "none"}.

## Selection targeting

${targetingLines}

## Manual review samples

${manualTable}

### Unresolved examples

${unresolvedExamples || "- No selected rows."}

## Common failure reasons

${Object.entries(failureCounts).length
    ? Object.entries(failureCounts).map(([reason, count]) => `- \`${reason}\`: ${count}`).join("\n")
    : "- No unresolved rows."}

Specific frequent unresolved notes from this run:

${commonNotes(options.selected.filter((row) => !row.website_url)).map(([reason, count]) => `- ${markdownCell(reason)} — ${count}`).join("\n") || "- No repeated unresolved notes."}

## Import-safety recommendation

**Do not import this batch automatically.** It is a manual-review file, not an approved import. Review each sponsor ID, employer identity, website and careers page directly; confirm evidence still loads; verify the named employer and location; and reject directories, unrelated companies, and unconfirmed ATS boards. Only explicitly approved rows should be considered for a separate dry-run importer that matches on \`sponsor_licence_id\`, fills blank values only, preserves existing data and source provenance, and reports a before/after diff. No database write, import, or deployment was performed.

## Reproducibility and resumability

- Output CSV: \`${options.outputPath}\`
- Progress checkpoint (outside deliverables): \`${options.checkpointPath}\`
- The script processes exact-Healthcare rows, checkpoints every employer, and supports ranked batch-2 targeting plus prior-batch ID exclusions for later batches.
- Each completed employer is checkpointed atomically. It validates checkpoint/input hashes before resume, logs per-row progress, retries transient page failures up to three times, and rate-limits requests. Existing deliverables are never overwritten unless \`--overwrite\` is supplied; in that case the old file is renamed to a timestamped backup first.
`;
}

function countValues(rows: Array<Record<string, string>>, field: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const value = row[field] || "none";
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function formatCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([label, count]) => `\`${label}\` ${count}`)
    .join(", ") || "none";
}

function failureReason(row: HealthcareBatchRow): string {
  if (row.website_url && row.careers_url) return row.ats_provider ? "website_careers_ats_verified" : "website_and_careers_verified";
  if (row.website_url) return row.careers_url ? "careers_verified" : "website_verified";
  if (row.notes.includes("robots")) return "robots_or_policy_block";
  if (row.notes.includes("could not be safely checked")) return "website_unreachable";
  if (row.notes.includes("identity")) return "identity_not_confirmed";
  if (row.notes.includes("SponsorList lookup unavailable")) return "sponsorlist_unavailable";
  if (row.notes.includes("SponsorList had no exact")) return "sponsorlist_no_exact_match";
  if (row.notes.includes("no search API configured")) return "no_search_source";
  if (row.notes.includes("no eligible employer website")) return "cqc_no_website";
  if (row.notes.includes("network access was disabled")) return "network_disabled";
  return "no_official_candidate";
}

function commonNotes(rows: HealthcareBatchRow[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const note = row.notes.split(";")[0]?.trim();
    if (note) counts.set(note, (counts.get(note) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8);
}

export async function runHealthcareSponsorWebsiteBatch(args: string[] = process.argv.slice(2)): Promise<void> {
  const options = parseOptions(args);
  const sourceText = await readFile(options.input, "utf8");
  const sourceRows = parseCsvObjects(sourceText);
  const requiredColumns = [
    "sponsor_licence_id",
    "organisation_name",
    "industry",
    "normalized_organisation_name",
    ...EXISTING_SIGNAL_COLUMNS,
  ];
  const headers = Object.keys(sourceRows[0] ?? {});
  const missing = requiredColumns.filter((column) => !headers.includes(column));
  if (missing.length) throw new Error(`Input CSV is missing required columns: ${missing.join(", ")}`);
  const previousBatchRows: SourceRow[] = [];
  const previousBatchHashes: string[] = [];
  const priorSeen = new Set<string>();
  for (const previousPath of options.previousBatchPaths) {
    const previousText = await readFile(previousPath, "utf8");
    const previousRows = parseCsvObjects(previousText);
    if (previousRows.length === 0 || previousRows.length > MAX_BATCH_SIZE) {
      throw new Error(`Previous batch ${previousPath} must contain 1–500 rows.`);
    }
    const previousHeaders = Object.keys(previousRows[0] ?? {});
    const previousMissing = ["sponsor_licence_id", "organisation_name", "industry", "notes"]
      .filter((column) => !previousHeaders.includes(column));
    if (previousMissing.length) {
      throw new Error(`Previous batch ${previousPath} is missing columns: ${previousMissing.join(", ")}`);
    }
    for (const row of previousRows) {
      if (text(row, "industry") !== "Healthcare") {
        throw new Error(`Previous batch ${previousPath} contains a non-exact-Healthcare row.`);
      }
      const key = stableEntityKey(row);
      if (priorSeen.has(key)) {
        throw new Error(`Previous batch files contain an already-processed sponsor identity: ${key}`);
      }
      priorSeen.add(key);
      previousBatchRows.push(row);
    }
    previousBatchHashes.push(sha256(previousText));
  }
  const selection = selectHealthcareRows(sourceRows, options.limit, options.offset, {
    previousBatchRows,
    targetHealthcareLocation: options.targetHealthcareLocation,
  });
  if (selection.selectedRows.length === 0) {
    throw new Error("No exact-Healthcare rows needing enrichment remain for this batch selection.");
  }

  const cqcExists = await stat(options.cqc).then((value) => value.isFile()).catch(() => false);
  const cqcSha256 = cqcExists ? await fileHash(options.cqc) : sha256("no-cqc-file");
  const inputSha256 = sha256(sourceText);
  const priorCheckpoint = options.fresh ? null : await loadCheckpoint(options.checkpoint);
  if (options.fresh && await loadCheckpoint(options.checkpoint)) {
    await backupIfExists(options.checkpoint, true);
  }
  if (
    priorCheckpoint &&
    (
      priorCheckpoint.schemaVersion !== 1 ||
      priorCheckpoint.inputPath !== options.input ||
      priorCheckpoint.inputSha256 !== inputSha256 ||
      priorCheckpoint.cqcPath !== options.cqc ||
      priorCheckpoint.cqcSha256 !== cqcSha256 ||
      priorCheckpoint.limit !== options.limit ||
      priorCheckpoint.offset !== options.offset ||
      (priorCheckpoint.batchNumber ?? 1) !== options.batchNumber ||
      (priorCheckpoint.selectionMode ?? "source-order") !==
        (options.targetHealthcareLocation ? "targeted-healthcare-location" : "source-order") ||
      JSON.stringify(priorCheckpoint.previousBatchHashes ?? []) !== JSON.stringify(previousBatchHashes)
    )
  ) {
    throw new Error("Checkpoint inputs or batch options changed; use --fresh to back it up and start again.");
  }
  const checkpoint: Checkpoint = priorCheckpoint ?? {
    schemaVersion: 1,
    inputPath: options.input,
    inputSha256,
    cqcPath: options.cqc,
    cqcSha256,
    limit: options.limit,
    offset: options.offset,
    batchNumber: options.batchNumber,
    previousBatchHashes,
    selectionMode: options.targetHealthcareLocation
      ? "targeted-healthcare-location"
      : "source-order",
    updatedAt: new Date().toISOString(),
    rows: {},
  };

  const cqcRecords = cqcExists
    ? await officialRecordsFromFile(options.cqc, "cqc", CQC_EVIDENCE_URL)
    : [];
  const cqcMatcher = createOfficialRecordMatcher(cqcRecords);
  const fetcher = new PublicSiteFetcher(options.delayMs);
  const discovered: HealthcareBatchRow[] = [];
  let totalAttempts = 0;
  let totalRetries = 0;

  for (let index = 0; index < selection.selectedRows.length; index += 1) {
    const source = selection.selectedRows[index]!;
    const id = text(source, "sponsor_licence_id") || stableEntityKey(source);
    let result = checkpoint.rows[id];
    if (!result) {
      console.log(`[healthcare-sponsor-batch] ${index + 1}/${selection.selectedRows.length} checking ${id} ${text(source, "organisation_name")}`);
      result = await discoverOne(source, cqcMatcher, fetcher, options);
      checkpoint.rows[id] = result;
      await writeCheckpoint(options.checkpoint, checkpoint);
    } else {
      console.log(`[healthcare-sponsor-batch] ${index + 1}/${selection.selectedRows.length} resumed ${id}`);
    }
    totalAttempts += result.attempts;
    totalRetries += result.retryCount;
    discovered.push(result.row);
  }

  const sourceIndustryCounts = new Map<string, number>();
  for (const row of sourceRows) {
    const industry = text(row, "industry");
    if (industry && /(health|medical|nhs|clinical|nurs|care|dental|dentistry|pharmacy)/i.test(industry)) {
      sourceIndustryCounts.set(industry, (sourceIndustryCounts.get(industry) ?? 0) + 1);
    }
  }
  const relatedLines = [...sourceIndustryCounts.entries()]
    .filter(([industry]) => industry !== "Healthcare")
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([industry, count]) => `- \`${industry}\`: ${count} in exported source; excluded because the source industry is not exactly \`Healthcare\`.`)
    .join("\n") || "- No related non-Healthcare industry labels appeared in the exported rows.";
  const report = reportMarkdown({
    batchNumber: options.batchNumber,
    inputPath: options.input,
    inputRows: sourceRows.length,
    totalExact: selection.exactHealthcareRows.length,
    needsEnrichment: selection.needsEnrichmentRows.length,
    selected: discovered,
    selection,
    cqcPath: cqcExists ? options.cqc : `${options.cqc} (not present)`,
    cqcRows: cqcRecords.length,
    noNetwork: options.noNetwork,
    searchKeyConfigured: Boolean(process.env.BING_SEARCH_API_KEY),
    outputPath: options.output,
    checkpointPath: options.checkpoint,
    previousBatchPaths: options.previousBatchPaths,
    relatedIndustryLabels: relatedLines,
  });

  await backupIfExists(options.output, options.overwrite);
  await backupIfExists(options.report, options.overwrite);
  await atomicWrite(options.output, stringifyCsv(discovered, HEALTHCARE_BATCH_COLUMNS));
  await atomicWrite(options.report, report);
  console.log(JSON.stringify({
    batchNumber: options.batchNumber,
    selectionMode: selection.selectionMode,
    output: options.output,
    report: options.report,
    inputRows: sourceRows.length,
    exactHealthcareRows: selection.exactHealthcareRows.length,
    needingEnrichment: selection.needsEnrichmentRows.length,
    batchRows: discovered.length,
    previouslyProcessedRowsExcluded: selection.previouslyProcessedRowsExcluded,
    targeting: selection.targeting,
    cqcRecords: cqcRecords.length,
    acceptedWebsiteRows: discovered.filter((row) => row.website_url).length,
    acceptedCareersRows: discovered.filter((row) => row.careers_url).length,
    verifiedAtsRows: discovered.filter((row) => row.ats_provider).length,
    attempts: totalAttempts,
    retries: totalRetries,
    checkpoint: options.checkpoint,
  }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  runHealthcareSponsorWebsiteBatch()
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exitCode = 1;
    });
}
