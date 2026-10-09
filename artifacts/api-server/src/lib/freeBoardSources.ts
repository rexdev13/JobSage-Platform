import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type { BoardAdvert } from "./boardVacancyPipeline";
import {
  fetchCompanySitePage,
  type CompanySiteFetchResult,
} from "./companySiteHttp";

const MAX_FEED_BYTES = 8 * 1024 * 1024;
const MAX_SITEMAP_BYTES = 20 * 1024 * 1024;
// Each detail is checkpointed independently so pacing cannot discard a batch.
const TEACHING_VACANCY_DETAIL_BATCH = 1;
const TEACHING_SITEMAP_CACHE_TTL_MS = 10 * 60_000;
const MAX_TEACHING_LIST_IDS = 20_000;
const MAX_TEACHING_CURSOR_CHARS = 1_000_000;

export type FreeBoardPage = {
  adverts: BoardAdvert[];
  nextCursor: string | null;
  /** Raw listing rows in the fetched response, including repeats filtered before normalization. */
  recordsFetched?: number;
  /** Duplicate listing IDs removed by a source adapter before returning adverts. */
  duplicateListingsSkipped?: number;
  reportedTotal?: number;
  goneCount?: number;
  coverageWarning?: string;
  sitemapTotal?: number;
  sitemapOnlyCount?: number;
  stopAfterPage?: boolean;
};

export type FreeBoardPageContext = {
  cursor: string | null;
  deadlineMs: number;
  seenExternalIds: ReadonlySet<string>;
};

export type FreeBoardSource = {
  id: string;
  provider: string;
  boardName: string;
  parserVersion: string;
  maxPagesPerRun: number;
  /** Offset-paginated, changing result sets must not infer missing listings from one sweep. */
  reconcileMissingAfterSweep?: boolean;
  fetchPage(context: FreeBoardPageContext): Promise<FreeBoardPage>;
};

export class FreeBoardFetchError extends Error {
  readonly status?: number;
  readonly failureKind?: string;
  readonly failureClass?: string;
  readonly retryAt?: Date;

  constructor(result: Extract<CompanySiteFetchResult, { ok: false }>) {
    super(`${result.kind}: ${result.reason}`);
    this.name = "FreeBoardFetchError";
    this.status = result.status;
    this.failureKind = result.kind;
    this.failureClass = result.failureClass;
    this.retryAt = result.retryAt;
  }
}

export async function fetchText(
  url: string,
  deadlineMs: number,
  maxBytes = MAX_FEED_BYTES,
): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Free vacancy feed URLs must use HTTPS without credentials.");
  }
  if (process.env.JOBSAGE_NO_WRITE_PUBLIC_FEED_AUDIT === "true") {
    const allowedHosts = [
      "jobs.nhs.uk",
      "teaching-vacancies.service.gov.uk",
      "arbeitnow.com",
      "jobicy.com",
      "himalayas.app",
      "jobs.scot.nhs.uk",
      "jobs.ac.uk",
      "charityjob.co.uk",
    ];
    const allowed = (hostname: string) => allowedHosts.some(
      (host) => hostname === host || hostname.endsWith(`.${host}`),
    );
    if (!allowed(parsed.hostname)) throw new Error(`No-write audit host is not allowlisted: ${parsed.hostname}`);
    let current = parsed;
    for (let redirects = 0; redirects <= 5; redirects++) {
      const remainingMs = deadlineMs - Date.now();
      if (remainingMs <= 0) throw new Error("No-write audit request deadline exceeded.");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(15_000, remainingMs));
      try {
        const response = await fetch(current, {
          signal: controller.signal,
          redirect: "manual",
          headers: {
            Accept: "application/json, application/xml, text/xml, text/html;q=0.9, */*;q=0.8",
            "Accept-Language": "en-GB,en;q=0.9",
            "User-Agent": "JOBSAGE no-write vacancy audit/1.0 (+https://jobsage.co.uk)",
          },
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) throw new Error(`Public feed redirect ${response.status} omitted Location.`);
          const next = new URL(location, current);
          if (next.protocol !== "https:" || !allowed(next.hostname)) {
            throw new Error(`Public feed redirected to a non-allowlisted host: ${next.hostname}`);
          }
          current = next;
          continue;
        }
        if (!response.ok) throw new Error(`Public feed returned HTTP ${response.status}.`);
        const contentLength = Number(response.headers.get("content-length"));
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          throw new Error(`Public feed exceeded the ${maxBytes}-byte response limit.`);
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > maxBytes) throw new Error(`Public feed exceeded the ${maxBytes}-byte response limit.`);
        return new TextDecoder().decode(bytes);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new Error("Public feed exceeded the redirect limit.");
  }
  const result = await fetchCompanySitePage(
    parsed.toString(),
    parsed.hostname,
    deadlineMs,
    maxBytes,
  );
  if (!result.ok) throw new FreeBoardFetchError(result);
  if (result.status < 200 || result.status >= 300) {
    throw new FreeBoardFetchError({
      ok: false,
      kind: "http",
      reason: `unexpected status ${result.status}`,
      status: result.status,
      failureClass: result.status === 404 || result.status === 410 ? "permanent" : "temporary",
    });
  }
  return result.body;
}

async function fetchJson<T>(
  url: string,
  deadlineMs: number,
  maxBytes = MAX_FEED_BYTES,
): Promise<T> {
  const body = await fetchText(url, deadlineMs, maxBytes);
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error("Free vacancy feed returned invalid JSON.");
  }
}

function cleanText(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, "\"")
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/\s+/g, " ")
      .trim()
    : "";
}

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function sourceDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  if (/^\d{10,13}$/.test(raw)) {
    const numeric = Number(raw);
    return sourceDate(numeric);
  }
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? `${raw}T00:00:00.000Z`
    : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(raw)
      ? `${raw}Z`
      : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function closeDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:59.000Z` : raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function makeAdvert(
  source: Pick<FreeBoardSource, "id" | "boardName" | "provider" | "parserVersion">,
  fields: {
    externalId: unknown;
    title: unknown;
    employer: unknown;
    url: unknown;
    applicationUrl?: unknown;
    location?: unknown;
    locations?: unknown[];
    salary?: unknown;
    description?: unknown;
    postedDate?: unknown;
    closesAt?: unknown;
    metadata?: Record<string, unknown>;
  },
): BoardAdvert {
  const locations = (fields.locations ?? [fields.location])
    .map(cleanText)
    .filter(Boolean);
  const url = safeUrl(fields.url) ?? (typeof fields.url === "string" ? fields.url : "");
  const candidateApplyUrl = safeUrl(fields.applicationUrl);
  const applyUrl = candidateApplyUrl &&
    candidateApplyUrl.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase() !==
      url.replace(/[?#].*$/, "").replace(/\/+$/, "").toLowerCase()
    ? candidateApplyUrl
    : null;
  const rawExternalId = fields.externalId;
  return {
    sourceId: `job_board:${source.boardName.trim().toLowerCase()}`,
    organisationName: cleanText(fields.employer),
    employer: cleanText(fields.employer),
    title: cleanText(fields.title),
    location: locations.join(", ") || (fields.metadata?.["remote"] === true ? "Remote" : null),
    salary: cleanText(fields.salary) || null,
    url,
    applicationUrl: applyUrl,
    description: cleanText(fields.description) || null,
    postedDate: sourceDate(fields.postedDate),
    closesAt: closeDate(fields.closesAt),
    targetRegions: [],
    boardName: source.boardName,
    externalId: typeof rawExternalId === "string" || typeof rawExternalId === "number"
      ? String(rawExternalId).trim() || null
      : null,
    sourceType: "job_board",
    sourceMetadata: {
      provider: source.provider,
      parserVersion: source.parserVersion,
      locations,
      ...(fields.metadata ?? {}),
    },
  };
}

type NhsVacancy = {
  id?: string;
  reference?: string;
  title?: string;
  description?: string;
  employer?: string;
  type?: string;
  salary?: string;
  closeDate?: string;
  postDate?: string;
  url?: string;
  locations?: { location?: string[] | string };
};

const nhsXmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (name) => name === "vacancyDetails" || name === "location",
});

export function parseNhsVacancyXml(xml: string): {
  adverts: BoardAdvert[];
  totalPages: number;
  totalResults: number;
} {
  const document = nhsXmlParser.parse(xml)?.nhsJobs;
  if (!document || typeof document !== "object") {
    throw new Error("NHS Jobs XML did not contain the expected nhsJobs root.");
  }
  const rows = Array.isArray(document.vacancyDetails)
    ? document.vacancyDetails as NhsVacancy[]
    : document.vacancyDetails
      ? [document.vacancyDetails as NhsVacancy]
      : [];
  const totalPages = Number(document.totalPages);
  const totalResults = Number(document.totalResults);
  if (!Number.isInteger(totalPages) || totalPages < 0 ||
      !Number.isFinite(totalResults) || totalResults < 0) {
    throw new Error("NHS Jobs XML omitted valid paging totals.");
  }
  const source = {
    id: "nhs-jobs",
    provider: "nhs_jobs",
    boardName: "NHS Jobs",
    parserVersion: "nhs-xml-v1",
  };
  return {
    totalPages,
    totalResults,
    adverts: rows.map((row) => {
      const rawLocations = row.locations?.location;
      const locations = Array.isArray(rawLocations)
        ? rawLocations
        : rawLocations
          ? [rawLocations]
          : [];
      const urlValue = typeof row.url === "string" && row.url
        ? safeUrl(row.url) ?? new URL(row.url, "https://www.jobs.nhs.uk").toString()
        : "";
      return makeAdvert(source, {
        externalId: row.reference || row.id,
        title: row.title,
        employer: row.employer,
        url: urlValue,
        locations,
        salary: row.salary,
        description: row.description,
        postedDate: row.postDate,
        closesAt: row.closeDate,
        metadata: {
          country: "GB",
          employmentType: cleanText(row.type) || null,
        },
      });
    }),
  };
}

type TeachingJob = {
  title?: string;
  url?: string;
  datePosted?: string;
  validThrough?: string;
  description?: string;
  employmentType?: string[] | string;
  occupationalCategory?: string;
  jobLocation?: { address?: {
    addressLocality?: string;
    addressRegion?: string;
    postalCode?: string;
    addressCountry?: string;
  } } | Array<{ address?: {
    addressLocality?: string;
    addressRegion?: string;
    postalCode?: string;
    addressCountry?: string;
  } }>;
  hiringOrganization?: { name?: string; identifier?: string };
  baseSalary?: { value?: { value?: string } };
};

type TeachingResponse = {
  data?: TeachingJob[];
  links?: { next?: string | null };
  meta?: { totalPages?: number; count?: number };
};

function mapTeachingJob(job: TeachingJob, fallbackSlug?: string): BoardAdvert {
  const locations = (Array.isArray(job.jobLocation)
    ? job.jobLocation
    : job.jobLocation
      ? [job.jobLocation]
      : [])
    .map((item) => {
      const address = item.address;
      return [
        address?.addressLocality,
        address?.addressRegion,
        address?.postalCode,
      ].filter(Boolean).join(", ");
    })
    .filter(Boolean);
  const url = safeUrl(job.url) ??
    (fallbackSlug ? `https://teaching-vacancies.service.gov.uk/jobs/${encodeURIComponent(fallbackSlug)}` : "");
  const rawEmploymentType = Array.isArray(job.employmentType)
    ? job.employmentType.join(", ")
    : job.employmentType;
  const source = {
    id: "teaching-vacancies",
    provider: "teaching_vacancies",
    boardName: "Teaching Vacancies",
    parserVersion: "tv-json-v3",
  };
  return makeAdvert(source, {
    externalId: fallbackSlug ?? (url ? new URL(url).pathname.split("/").filter(Boolean).at(-1) : ""),
    title: job.title,
    employer: job.hiringOrganization?.name,
    url,
    locations,
    salary: job.baseSalary?.value?.value?.split(/\r?\n/)[0],
    description: job.description,
    postedDate: job.datePosted,
    closesAt: job.validThrough,
    metadata: {
      country: "GB",
      employmentType: cleanText(rawEmploymentType) || null,
      category: cleanText(job.occupationalCategory) || null,
      hiringOrganizationId: cleanText(job.hiringOrganization?.identifier) || null,
    },
  });
}

export function parseTeachingSitemapSlugs(xml: string): string[] {
  const parser = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    isArray: (name) => name === "url" || name === "loc",
  });
  const document = parser.parse(xml)?.urlset;
  if (!document || typeof document !== "object") {
    throw new Error("Teaching Vacancies sitemap did not contain a urlset root.");
  }
  const entries = Array.isArray(document.url) ? document.url : [];
  const slugs = new Set<string>();
  for (const entry of entries) {
    const rawLoc = Array.isArray(entry.loc) ? entry.loc[0] : entry.loc;
    if (typeof rawLoc !== "string") continue;
    try {
      const url = new URL(rawLoc);
      if (
        url.protocol === "https:" &&
        url.hostname.toLowerCase() === "teaching-vacancies.service.gov.uk" &&
        /^\/jobs\/[a-z0-9-]+\/?$/i.test(url.pathname)
      ) {
        slugs.add(url.pathname.replace(/^\/jobs\//i, "").replace(/\/+$/, ""));
      }
    } catch {
      // Ignore malformed entries; the source host is fixed and checked above.
    }
  }
  return [...slugs].sort();
}

type TeachingProgress = {
  listedIds: string[];
  listRecordsFetched: number;
  reportedTotal: number | null;
  reportedTotalChanged: boolean;
  listCoverageWarning: string | null;
};

type TeachingCursor =
  | ({ phase: "list"; page: number } & TeachingProgress)
  | ({
      phase: "sitemap";
      offset: number;
      sitemapHash: string | null;
      /** Durable snapshot: do not depend on an autoscale process retaining its cache. */
      sitemapBackfillSlugs?: string[];
      sitemapTotal?: number;
    } & TeachingProgress);

let teachingSitemapCache: {
  slugs: string[];
  hash: string;
  loadedAt: number;
} | null = null;

async function getTeachingSitemap(deadlineMs: number): Promise<{
  slugs: string[];
  hash: string;
}> {
  if (
    teachingSitemapCache &&
    Date.now() - teachingSitemapCache.loadedAt < TEACHING_SITEMAP_CACHE_TTL_MS
  ) {
    return teachingSitemapCache;
  }
  const sitemapXml = await fetchText(
    "https://teaching-vacancies.service.gov.uk/sitemap.xml",
    deadlineMs,
    MAX_SITEMAP_BYTES,
  );
  const slugs = parseTeachingSitemapSlugs(sitemapXml);
  const hash = createHash("sha256").update(slugs.join("\n")).digest("hex");
  teachingSitemapCache = { slugs, hash, loadedAt: Date.now() };
  return teachingSitemapCache;
}

export function parseTeachingCursor(cursor: string | null): TeachingCursor {
  if (!cursor) return { phase: "list", page: 1, ...initialTeachingProgress() };
  try {
    const parsed: unknown = JSON.parse(cursor);
    if (typeof parsed === "number" && Number.isInteger(parsed) && parsed > 0) {
      return { phase: "list", page: parsed, ...initialTeachingProgress() };
    }
    if (!parsed || typeof parsed !== "object") throw new Error("Unsupported cursor shape.");
    const state = parsed as Partial<TeachingCursor>;
    const progress = parseTeachingProgress(state);
    if (state.phase === "list" && Number.isInteger(state.page) && Number(state.page) > 0) {
      return { phase: "list", page: Number(state.page), ...progress };
    }
    if (
      state.phase === "sitemap" &&
      Number.isInteger(state.offset) &&
      Number(state.offset) >= 0 &&
      (state.sitemapHash == null || typeof state.sitemapHash === "string")
    ) {
      const snapshot = state.sitemapBackfillSlugs == null
        ? undefined
        : parseTeachingListedIds(state.sitemapBackfillSlugs);
      if (snapshot && (
        !state.sitemapHash ||
        !Number.isInteger(state.sitemapTotal) ||
        Number(state.sitemapTotal) < snapshot.length ||
        Number(state.offset) > snapshot.length
      )) {
        throw new Error("Invalid sitemap snapshot.");
      }
      return {
        phase: "sitemap",
        offset: Number(state.offset),
        sitemapHash: state.sitemapHash ?? null,
        ...(snapshot ? {
          sitemapBackfillSlugs: snapshot,
          sitemapTotal: Number(state.sitemapTotal),
        } : {}),
        ...progress,
      };
    }
  } catch {
    // Old reference cursors ("fill" or a page number) are upgraded safely.
    if (cursor === "fill") {
      return {
        phase: "sitemap",
        offset: 0,
        sitemapHash: null,
        ...initialTeachingProgress(),
      };
    }
    const page = Number(cursor);
    if (Number.isInteger(page) && page > 0) {
      return { phase: "list", page, ...initialTeachingProgress() };
    }
  }
  throw new Error("Teaching Vacancies source cursor is invalid.");
}

function initialTeachingProgress(): TeachingProgress {
  return {
    listedIds: [],
    listRecordsFetched: 0,
    reportedTotal: null,
    reportedTotalChanged: false,
    listCoverageWarning: null,
  };
}

function parseTeachingProgress(state: Partial<TeachingCursor>): TeachingProgress {
  const listRecordsFetched = state.listRecordsFetched ?? 0;
  const reportedTotal = state.reportedTotal ?? null;
  const listCoverageWarning = state.listCoverageWarning ?? null;
  if (
    !Number.isInteger(listRecordsFetched) || listRecordsFetched < 0 ||
    (reportedTotal != null && (!Number.isInteger(reportedTotal) || reportedTotal < 0)) ||
    typeof state.reportedTotalChanged !== "boolean" ||
    (listCoverageWarning != null && typeof listCoverageWarning !== "string")
  ) {
    throw new Error("Teaching Vacancies cursor has invalid pagination progress.");
  }
  return {
    listedIds: parseTeachingListedIds(state.listedIds),
    listRecordsFetched,
    reportedTotal,
    reportedTotalChanged: state.reportedTotalChanged,
    listCoverageWarning,
  };
}

function parseTeachingListedIds(rawIds: unknown): string[] {
  if (rawIds == null) return [];
  if (!Array.isArray(rawIds) || rawIds.length > MAX_TEACHING_LIST_IDS) {
    throw new Error("Teaching Vacancies cursor has an invalid listing ID set.");
  }
  const ids = new Set<string>();
  for (const id of rawIds) {
    if (typeof id !== "string" || !/^[a-z0-9-]{1,200}$/i.test(id)) {
      throw new Error("Teaching Vacancies cursor contains an invalid listing ID.");
    }
    ids.add(id);
  }
  return [...ids].sort();
}

function encodeTeachingCursor(cursor: TeachingCursor): string {
  const encoded = JSON.stringify(cursor);
  if (encoded.length > MAX_TEACHING_CURSOR_CHARS) {
    throw new Error("Teaching Vacancies listing ID cursor exceeded its safe size.");
  }
  return encoded;
}

export function getTeachingSitemapBackfillSlugs(
  sitemapSlugs: readonly string[],
  listedIds: readonly string[],
): string[] {
  const listed = new Set(listedIds);
  return sitemapSlugs.filter((slug) => !listed.has(slug));
}

export function getTeachingSitemapBackfillBatch(
  sitemapSlugs: readonly string[],
  listedIds: readonly string[],
  seenExternalIds: ReadonlySet<string>,
  offset: number,
  batchSize: number,
): { batch: string[]; nextOffset: number; sitemapOnlyCount: number } {
  const candidates = getTeachingSitemapBackfillSlugs(sitemapSlugs, listedIds);
  const page = candidates.slice(offset, offset + batchSize);
  return {
    batch: page.filter((slug) => !seenExternalIds.has(slug)),
    nextOffset: offset + page.length,
    sitemapOnlyCount: candidates.length,
  };
}

export function mergeTeachingListedIds(
  existingIds: readonly string[],
  discoveredIds: readonly (string | null)[],
): string[] {
  return parseTeachingListedIds([
    ...existingIds,
    ...discoveredIds.filter(
      (id): id is string => typeof id === "string" && /^[a-z0-9-]{1,200}$/i.test(id),
    ),
  ]);
}

export function getTeachingListCoverageWarning(
  recordsFetched: number,
  reportedTotal: number | null,
  reportedTotalChanged: boolean,
): string | null {
  const problems: string[] = [];
  if (reportedTotalChanged) problems.push("the reported total changed during pagination");
  if (reportedTotal != null && recordsFetched !== reportedTotal) {
    problems.push(`fetched ${recordsFetched} raw list records, but the provider reported ${reportedTotal}`);
  }
  return problems.length > 0
    ? `Teaching Vacancies list-feed coverage needs review: ${problems.join("; ")}.`
    : null;
}

type ArbeitnowJob = {
  slug?: string;
  company_name?: string;
  title?: string;
  description?: string;
  remote?: boolean;
  url?: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  created_at?: number;
};

type JobicyJob = {
  id?: number;
  url?: string;
  jobTitle?: string;
  companyName?: string;
  jobIndustry?: string[];
  jobType?: string[];
  jobGeo?: string;
  pubDate?: string;
  salaryMin?: number;
  salaryMax?: number;
  salaryCurrency?: string;
  salaryPeriod?: string;
  jobDescription?: string;
};

type HimalayasJob = {
  title?: string;
  companyName?: string;
  guid?: string;
  applicationLink?: string;
  locationRestrictions?: Array<
    string | { alpha2?: string; name?: string; slug?: string }
  >;
  employmentType?: string;
  minSalary?: number | null;
  maxSalary?: number | null;
  currency?: string | null;
  salaryPeriod?: string;
  categories?: string[];
  pubDate?: number;
  expiryDate?: number;
  description?: string;
};

type HimalayasSearchResponse = {
  jobs?: unknown[];
  limit?: number;
  totalCount?: number;
};

export type HimalayasCursor = {
  version: 1;
  page: number;
  recordsFetched: number;
  reportedTotal: number | null;
  pageLimit: number | null;
  reportedTotalChanged: boolean;
  pageLimitChanged: boolean;
};

function initialHimalayasCursor(page = 1): HimalayasCursor {
  return {
    version: 1,
    page,
    recordsFetched: 0,
    reportedTotal: null,
    pageLimit: null,
    reportedTotalChanged: false,
    pageLimitChanged: false,
  };
}

export function parseHimalayasCursor(cursor: string | null): HimalayasCursor {
  if (cursor == null) return initialHimalayasCursor();
  try {
    const parsed: unknown = JSON.parse(cursor);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const state = parsed as Partial<HimalayasCursor>;
      if (
        state.version === 1 &&
        Number.isInteger(state.page) && Number(state.page) >= 1 &&
        Number.isInteger(state.recordsFetched) && Number(state.recordsFetched) >= 0 &&
        (state.reportedTotal == null ||
          Number.isInteger(state.reportedTotal) && Number(state.reportedTotal) >= 0) &&
        (state.pageLimit == null ||
          Number.isInteger(state.pageLimit) && Number(state.pageLimit) >= 1) &&
        typeof state.reportedTotalChanged === "boolean" &&
        typeof state.pageLimitChanged === "boolean"
      ) {
        return {
          version: 1,
          page: Number(state.page),
          recordsFetched: Number(state.recordsFetched),
          reportedTotal: state.reportedTotal ?? null,
          pageLimit: state.pageLimit ?? null,
          reportedTotalChanged: state.reportedTotalChanged,
          pageLimitChanged: state.pageLimitChanged,
        };
      }
    }
  } catch {
    // Numeric cursors from the earlier adapter are still readable during a safe reset.
  }
  const legacyPage = Number(cursor);
  if (Number.isInteger(legacyPage) && legacyPage >= 1) {
    return initialHimalayasCursor(legacyPage);
  }
  throw new Error("Himalayas source cursor is invalid.");
}

function parseHimalayasRestrictions(value: unknown): Array<{
  label: string;
  countryCode: string;
}> {
  if (!Array.isArray(value)) {
    throw new Error("Himalayas job omitted its location restrictions.");
  }
  return value.map((restriction) => {
    if (typeof restriction === "string") {
      const label = cleanText(restriction);
      if (!label) throw new Error("Himalayas job had an empty location restriction.");
      return { label, countryCode: label };
    }
    if (!restriction || typeof restriction !== "object" || Array.isArray(restriction)) {
      throw new Error("Himalayas job had an invalid location restriction.");
    }
    const fields = restriction as Record<string, unknown>;
    const alpha2 = cleanText(fields["alpha2"]).toUpperCase();
    const name = cleanText(fields["name"]);
    const slug = cleanText(fields["slug"]);
    const label = name || alpha2 || slug;
    const countryCode = alpha2 || name || slug;
    if (!label || !countryCode) {
      throw new Error("Himalayas job had an incomplete location restriction.");
    }
    return { label, countryCode };
  });
}

function mapHimalayasJob(job: HimalayasJob): BoardAdvert {
  const restrictions = parseHimalayasRestrictions(job.locationRestrictions);
  const geo = restrictions.length
    ? restrictions.map((restriction) => restriction.label).join(", ")
    : "Worldwide";
  const guid = typeof job.guid === "string" ? job.guid.trim() : "";
  const url = safeUrl(guid) ?? (
    /^[a-z0-9-]{1,200}$/i.test(guid)
      ? `https://himalayas.app/jobs/${encodeURIComponent(guid)}`
      : ""
  );
  const salary = typeof job.minSalary === "number"
    ? `${job.currency ?? ""} ${job.minSalary}-${job.maxSalary ?? ""} ${job.salaryPeriod ?? ""}`.trim()
    : null;
  const source = {
    id: "himalayas",
    provider: "himalayas",
    boardName: "Himalayas",
    parserVersion: "himalayas-uk-search-v3",
  };
  return makeAdvert(source, {
    externalId: guid,
    title: job.title,
    employer: job.companyName,
    url,
    applicationUrl: job.applicationLink,
    locations: [`Remote (${geo})`],
    salary,
    description: job.description,
    postedDate: job.pubDate,
    closesAt: typeof job.expiryDate === "number"
      ? new Date(job.expiryDate * 1000).toISOString()
      : undefined,
    metadata: {
      remote: true,
      country: restrictions.length === 1 ? restrictions[0]?.countryCode ?? null : null,
      locationRestrictions: restrictions.map((restriction) => restriction.label),
      searchScope: "UK-eligible and worldwide",
      employmentType: job.employmentType ?? null,
      category: Array.isArray(job.categories) ? job.categories : [],
      detailPageMayBeCloudflareProtected: true,
    },
  });
}

export function parseHimalayasSearchResponse(
  value: unknown,
  page: number,
  progress: HimalayasCursor = initialHimalayasCursor(page),
): FreeBoardPage {
  if (!Number.isInteger(page) || page < 1) {
    throw new Error("Himalayas search page cursor is invalid.");
  }
  if (progress.page !== page) {
    throw new Error("Himalayas cursor page did not match its progress state.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Himalayas search response was not an object.");
  }
  const response = value as HimalayasSearchResponse;
  if (!Array.isArray(response.jobs)) {
    throw new Error("Himalayas search response omitted its jobs array.");
  }
  if (
    !Number.isInteger(response.totalCount) || Number(response.totalCount) < 0 ||
    !Number.isInteger(response.limit) || Number(response.limit) < 1
  ) {
    throw new Error("Himalayas search response omitted valid paging totals.");
  }
   const adverts = response.jobs.flatMap((job) => {
    if (!job || typeof job !== "object" || Array.isArray(job)) {
      throw new Error("Himalayas search response contained an invalid job.");
    }
     const typedJob = job as HimalayasJob;
     const restrictions = parseHimalayasRestrictions(typedJob.locationRestrictions);
     const ukEligible = restrictions.length === 0 || restrictions.some(({ countryCode }) =>
       /^(gb|uk|united kingdom|united-kingdom|great britain)$/i.test(countryCode));
     return ukEligible ? [mapHimalayasJob(typedJob)] : [];
  });
  const currentTotal = Number(response.totalCount);
  const currentLimit = Number(response.limit);
  const totalPages = Math.ceil(currentTotal / currentLimit);
   const rawCount = response.jobs.length;
   const recordsFetched = progress.recordsFetched + rawCount;
  const reportedTotalChanged = progress.reportedTotalChanged ||
    (progress.reportedTotal != null && progress.reportedTotal !== currentTotal);
  const pageLimitChanged = progress.pageLimitChanged ||
    (progress.pageLimit != null && progress.pageLimit !== currentLimit);
   const returnedBeyondReportedPages = page > totalPages && rawCount > 0;
   // The live filtered endpoint can return empty intermediate pages followed
   // by nonempty pages. Only its declared last page bounds this traversal.
   const ended = page >= totalPages;
  const coverageProblems: string[] = [];
  if (returnedBeyondReportedPages) {
    coverageProblems.push(`page ${page} returned listings beyond the reported final page ${totalPages}`);
  }
  if (ended && reportedTotalChanged) {
    coverageProblems.push("the reported total changed during pagination");
  }
  if (ended && pageLimitChanged) {
    coverageProblems.push("the reported page size changed during pagination");
  }
  if (ended && recordsFetched !== currentTotal) {
    coverageProblems.push(`fetched ${recordsFetched} raw listings, but the provider reported ${currentTotal}`);
  }
  const nextState: HimalayasCursor = {
    version: 1,
    page: page + 1,
    recordsFetched,
    reportedTotal: progress.reportedTotal ?? currentTotal,
    pageLimit: progress.pageLimit ?? currentLimit,
    reportedTotalChanged,
    pageLimitChanged,
  };
  return {
    adverts,
     recordsFetched: rawCount,
    reportedTotal: currentTotal,
    nextCursor: ended || coverageProblems.length > 0 ? null : JSON.stringify(nextState),
    ...(!ended && rawCount === 0 ? { stopAfterPage: true } : {}),
    ...(coverageProblems.length > 0
      ? { coverageWarning: `Himalayas coverage needs review: ${coverageProblems.join("; ")}.` }
      : {}),
  };
}

function pageNumber(cursor: string | null): number {
  const page = cursor == null ? 1 : Number(cursor);
  if (!Number.isInteger(page) || page < 1) throw new Error("Feed page cursor is invalid.");
  return page;
}

function urlWithCursor(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export const FREE_BOARD_SOURCES: readonly FreeBoardSource[] = [
  {
    id: "nhs-jobs",
    provider: "nhs_jobs",
    boardName: "NHS Jobs",
    parserVersion: "nhs-xml-v1",
    maxPagesPerRun: 400,
    async fetchPage({ cursor, deadlineMs }) {
      const page = pageNumber(cursor);
      const url = urlWithCursor("https://www.jobs.nhs.uk/api/v1/search_xml", {
        page: String(page),
        limit: "100",
        sort: "publicationDateAsc",
      });
      const xml = await fetchText(url, deadlineMs);
      const parsed = parseNhsVacancyXml(xml);
      const done = page >= parsed.totalPages || parsed.adverts.length === 0;
      return {
        adverts: parsed.adverts,
        nextCursor: done ? null : String(page + 1),
        reportedTotal: parsed.totalResults,
      };
    },
  },
  {
    id: "teaching-vacancies",
    provider: "teaching_vacancies",
    boardName: "Teaching Vacancies",
    parserVersion: "tv-json-v3",
    maxPagesPerRun: 200,
    reconcileMissingAfterSweep: false,
    async fetchPage({ cursor, deadlineMs, seenExternalIds }) {
      const state = parseTeachingCursor(cursor);
      if (state.phase === "list") {
        const response = await fetchJson<TeachingResponse>(
          urlWithCursor("https://teaching-vacancies.service.gov.uk/api/v1/jobs.json", {
            page: String(state.page),
          }),
          deadlineMs,
        );
        if (!Array.isArray(response.data)) {
          throw new Error("Teaching Vacancies list response omitted its data array.");
        }
        const rows = response.data;
        const adverts = rows.map((job) => mapTeachingJob(job));
        const listedIds = mergeTeachingListedIds(
          state.listedIds,
          adverts.map((advert) => advert.externalId),
        );
        const fetched = state.listRecordsFetched + rows.length;
        const pageReportedTotal = Number.isInteger(response.meta?.count) &&
          Number(response.meta?.count) >= 0
          ? Number(response.meta?.count)
          : null;
        const reportedTotalChanged = state.reportedTotalChanged ||
          (state.reportedTotal != null &&
            pageReportedTotal != null &&
            state.reportedTotal !== pageReportedTotal);
        const hasNext = Boolean(response.links?.next) && rows.length > 0;
        const reportedTotal = pageReportedTotal ?? state.reportedTotal;
        const listCoverageWarning = hasNext
          ? state.listCoverageWarning
          : getTeachingListCoverageWarning(
              fetched,
              reportedTotal,
              reportedTotalChanged,
            );
        const progress: TeachingProgress = {
          listedIds,
          listRecordsFetched: fetched,
          reportedTotal,
          reportedTotalChanged,
          listCoverageWarning,
        };
        return {
          adverts,
          nextCursor: hasNext
            ? encodeTeachingCursor({
                phase: "list",
                page: state.page + 1,
                ...progress,
              })
            : encodeTeachingCursor({
                phase: "sitemap",
                offset: 0,
                sitemapHash: null,
                ...progress,
              }),
          ...(reportedTotal != null ? { reportedTotal } : {}),
          ...(!hasNext ? { stopAfterPage: true } : {}),
        };
      }

      if (state.sitemapBackfillSlugs == null) {
        const { slugs, hash: sitemapHash } = await getTeachingSitemap(deadlineMs);
        const candidates = getTeachingSitemapBackfillSlugs(slugs, state.listedIds);
        // Persist the index before making any detail requests on this host.
        // This also works when the next request runs in a different process.
        return {
          adverts: [],
          recordsFetched: 0,
          sitemapTotal: slugs.length,
          sitemapOnlyCount: candidates.length,
          nextCursor: candidates.length === 0 ? null : encodeTeachingCursor({
            ...state,
            offset: 0,
            sitemapHash,
            sitemapBackfillSlugs: candidates,
            sitemapTotal: slugs.length,
          }),
          stopAfterPage: true,
          ...(candidates.length === 0 && state.listCoverageWarning
            ? { coverageWarning: state.listCoverageWarning }
            : {}),
        };
      }
      const offset = state.offset;
      const {
        batch,
        nextOffset,
        sitemapOnlyCount,
      } = getTeachingSitemapBackfillBatch(
        state.sitemapBackfillSlugs,
        [],
        seenExternalIds,
        offset,
        TEACHING_VACANCY_DETAIL_BATCH,
      );
      const adverts: BoardAdvert[] = [];
      let goneCount = 0;
      for (const slug of batch) {
        try {
          const job = await fetchJson<TeachingJob>(
            `https://teaching-vacancies.service.gov.uk/api/v1/jobs/${encodeURIComponent(slug)}.json`,
            deadlineMs,
          );
          adverts.push(mapTeachingJob(job, slug));
        } catch (error) {
          if (
            error instanceof FreeBoardFetchError &&
            (error.status === 404 || error.status === 410)
          ) {
            goneCount += 1;
            continue;
          }
          throw error;
        }
      }
      return {
        adverts,
        goneCount,
        sitemapTotal: state.sitemapTotal,
        sitemapOnlyCount,
        nextCursor: nextOffset >= sitemapOnlyCount
          ? null
          : encodeTeachingCursor({
              ...state,
              phase: "sitemap",
              offset: nextOffset,
            }),
        ...(nextOffset >= sitemapOnlyCount && state.listCoverageWarning
          ? { coverageWarning: state.listCoverageWarning }
          : {}),
      };
    },
  },
  {
    id: "arbeitnow",
    provider: "arbeitnow",
    boardName: "Arbeitnow",
    parserVersion: "arbeitnow-v3",
    maxPagesPerRun: 20,
    async fetchPage({ cursor, deadlineMs }) {
      const page = pageNumber(cursor);
      const response = await fetchJson<{
        data?: ArbeitnowJob[];
        links?: { next?: string | null };
      }>(
        urlWithCursor("https://www.arbeitnow.com/api/job-board-api", { page: String(page) }),
        deadlineMs,
      );
      if (!Array.isArray(response.data)) {
        throw new Error("Arbeitnow response omitted its data array.");
      }
      const jobs = response.data;
      const adverts = jobs.map((job) => makeAdvert(
        { id: "arbeitnow", provider: "arbeitnow", boardName: "Arbeitnow", parserVersion: "arbeitnow-v3" },
        {
          externalId: job.slug,
          title: job.title,
          employer: job.company_name,
          url: job.url,
          location: job.location,
          salary: undefined,
          description: job.description,
          postedDate: job.created_at,
          metadata: {
            remote: job.remote === true,
            employmentType: Array.isArray(job.job_types) ? job.job_types : [],
            category: Array.isArray(job.tags) ? job.tags : [],
          },
        },
      ));
      const hasNext = Boolean(response.links?.next) && jobs.length > 0;
      return { adverts, nextCursor: hasNext ? String(page + 1) : null };
    },
  },
  {
    id: "jobicy",
    provider: "jobicy",
    boardName: "Jobicy",
    parserVersion: "jobicy-v1",
    maxPagesPerRun: 10,
    async fetchPage({ cursor, deadlineMs }) {
      const params: Record<string, string> = { count: "100" };
      if (cursor) params["cursor"] = cursor;
      const response = await fetchJson<{
        jobs?: JobicyJob[];
        hasMore?: boolean;
        nextCursor?: string;
      }>(
        urlWithCursor("https://jobicy.com/api/v2/remote-jobs", params),
        deadlineMs,
      );
      if (!Array.isArray(response.jobs)) {
        throw new Error("Jobicy response omitted its jobs array.");
      }
      const jobs = response.jobs;
      const adverts = jobs.map((job) => {
        const salary = typeof job.salaryMin === "number"
          ? `${job.salaryCurrency ?? ""} ${job.salaryMin}-${job.salaryMax ?? ""} ${job.salaryPeriod ?? ""}`.trim()
          : null;
        return makeAdvert(
          { id: "jobicy", provider: "jobicy", boardName: "Jobicy", parserVersion: "jobicy-v1" },
          {
            externalId: job.id,
            title: job.jobTitle,
            employer: job.companyName,
            url: job.url,
            locations: [job.jobGeo ? `Remote (${job.jobGeo})` : "Remote"],
            salary,
            description: job.jobDescription,
            postedDate: job.pubDate,
            metadata: {
              remote: true,
              country: null,
              employmentType: Array.isArray(job.jobType) ? job.jobType : [],
              category: Array.isArray(job.jobIndustry) ? job.jobIndustry : [],
            },
          },
        );
      });
      const nextCursor = response.hasMore && response.nextCursor && jobs.length
        ? response.nextCursor
        : null;
      return { adverts, nextCursor };
    },
  },
  {
    id: "himalayas",
    provider: "himalayas",
    boardName: "Himalayas",
    parserVersion: "himalayas-uk-search-v3",
    maxPagesPerRun: 100,
    reconcileMissingAfterSweep: false,
    async fetchPage({ cursor, deadlineMs }) {
      const progress = parseHimalayasCursor(cursor);
      const response = await fetchJson<unknown>(
        urlWithCursor("https://himalayas.app/jobs/api/search", {
          country: "GB",
          exclude_worldwide: "false",
          page: String(progress.page),
          sort: "recent",
        }),
        deadlineMs,
      );
      return parseHimalayasSearchResponse(response, progress.page, progress);
    },
  },
];
