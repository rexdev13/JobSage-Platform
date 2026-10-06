import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import type { BoardAdvert } from "./boardVacancyPipeline";
import {
  fetchCompanySitePage,
  type CompanySiteFetchResult,
} from "./companySiteHttp";

const MAX_FEED_BYTES = 8 * 1024 * 1024;
const MAX_SITEMAP_BYTES = 20 * 1024 * 1024;
const TEACHING_VACANCY_DETAIL_BATCH = 10;
const TEACHING_SITEMAP_CACHE_TTL_MS = 10 * 60_000;

export type FreeBoardPage = {
  adverts: BoardAdvert[];
  nextCursor: string | null;
  reportedTotal?: number;
  goneCount?: number;
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
  fetchPage(context: FreeBoardPageContext): Promise<FreeBoardPage>;
};

export class FreeBoardFetchError extends Error {
  readonly status?: number;
  readonly failureKind?: string;
  readonly failureClass?: string;

  constructor(result: Extract<CompanySiteFetchResult, { ok: false }>) {
    super(`${result.kind}: ${result.reason}`);
    this.name = "FreeBoardFetchError";
    this.status = result.status;
    this.failureKind = result.kind;
    this.failureClass = result.failureClass;
  }
}

async function fetchText(
  url: string,
  deadlineMs: number,
  maxBytes = MAX_FEED_BYTES,
): Promise<string> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Free vacancy feed URLs must use HTTPS without credentials.");
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

function makeAdvert(
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
    parserVersion: "tv-json-v1",
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

type TeachingCursor =
  | { phase: "list"; page: number }
  | { phase: "sitemap"; offset: number; sitemapHash: string | null };

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

function parseTeachingCursor(cursor: string | null): TeachingCursor {
  if (!cursor) return { phase: "list", page: 1 };
  try {
    const parsed: unknown = JSON.parse(cursor);
    if (typeof parsed === "number" && Number.isInteger(parsed) && parsed > 0) {
      return { phase: "list", page: parsed };
    }
    if (!parsed || typeof parsed !== "object") throw new Error("Unsupported cursor shape.");
    const state = parsed as Partial<TeachingCursor>;
    if (state.phase === "list" && Number.isInteger(state.page) && Number(state.page) > 0) {
      return { phase: "list", page: Number(state.page) };
    }
    if (
      state.phase === "sitemap" &&
      Number.isInteger(state.offset) &&
      Number(state.offset) >= 0 &&
      (state.sitemapHash == null || typeof state.sitemapHash === "string")
    ) {
      return {
        phase: "sitemap",
        offset: Number(state.offset),
        sitemapHash: state.sitemapHash ?? null,
      };
    }
  } catch {
    // Old reference cursors ("fill" or a page number) are upgraded safely.
    if (cursor === "fill") return { phase: "sitemap", offset: 0, sitemapHash: null };
    const page = Number(cursor);
    if (Number.isInteger(page) && page > 0) return { phase: "list", page };
  }
  throw new Error("Teaching Vacancies source cursor is invalid.");
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
  locationRestrictions?: string[];
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
    parserVersion: "tv-json-v1",
    maxPagesPerRun: 200,
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
        const hasNext = Boolean(response.links?.next) && rows.length > 0;
        return {
          adverts,
          nextCursor: hasNext
            ? JSON.stringify({ phase: "list", page: state.page + 1 } satisfies TeachingCursor)
            : JSON.stringify({ phase: "sitemap", offset: 0, sitemapHash: null } satisfies TeachingCursor),
          ...(Number.isFinite(response.meta?.count) ? { reportedTotal: response.meta!.count } : {}),
        };
      }

      const { slugs, hash: sitemapHash } = await getTeachingSitemap(deadlineMs);
      const offset = state.sitemapHash === sitemapHash ? state.offset : 0;
      const batch = slugs.slice(offset, offset + TEACHING_VACANCY_DETAIL_BATCH);
      const adverts: BoardAdvert[] = [];
      let goneCount = 0;
      for (const slug of batch) {
        if (seenExternalIds.has(slug)) continue;
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
      const nextOffset = offset + batch.length;
      return {
        adverts,
        goneCount,
        nextCursor: nextOffset >= slugs.length
          ? null
          : JSON.stringify({
              phase: "sitemap",
              offset: nextOffset,
              sitemapHash,
            } satisfies TeachingCursor),
      };
    },
  },
  {
    id: "arbeitnow",
    provider: "arbeitnow",
    boardName: "Arbeitnow",
    parserVersion: "arbeitnow-v1",
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
        { id: "arbeitnow", provider: "arbeitnow", boardName: "Arbeitnow", parserVersion: "arbeitnow-v1" },
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
    parserVersion: "himalayas-v1",
    maxPagesPerRun: 100,
    async fetchPage({ cursor, deadlineMs }) {
      const params: Record<string, string> = { limit: "20" };
      if (cursor) params["cursor"] = cursor;
      const response = await fetchJson<{
        jobs?: HimalayasJob[];
        nextCursor?: string | null;
        totalCount?: number;
      }>(
        urlWithCursor("https://himalayas.app/jobs/api", params),
        deadlineMs,
      );
      if (!Array.isArray(response.jobs)) {
        throw new Error("Himalayas response omitted its jobs array.");
      }
      const jobs = response.jobs;
      const adverts = jobs.map((job) => {
        const guid = typeof job.guid === "string" ? job.guid.trim() : "";
        const url = safeUrl(guid) ?? (
          /^[a-z0-9-]{1,200}$/i.test(guid)
            ? `https://himalayas.app/jobs/${encodeURIComponent(guid)}`
            : ""
        );
        const geo = Array.isArray(job.locationRestrictions) && job.locationRestrictions.length
          ? job.locationRestrictions.join(", ")
          : "Worldwide";
        const salary = typeof job.minSalary === "number"
          ? `${job.currency ?? ""} ${job.minSalary}-${job.maxSalary ?? ""} ${job.salaryPeriod ?? ""}`.trim()
          : null;
        return makeAdvert(
          { id: "himalayas", provider: "himalayas", boardName: "Himalayas", parserVersion: "himalayas-v1" },
          {
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
              country: job.locationRestrictions?.length === 1 ? job.locationRestrictions[0] : null,
              employmentType: job.employmentType ?? null,
              category: Array.isArray(job.categories) ? job.categories : [],
              detailPageMayBeCloudflareProtected: true,
            },
          },
        );
      });
      return {
        adverts,
        nextCursor: response.nextCursor && jobs.length ? response.nextCursor : null,
        ...(Number.isFinite(response.totalCount) ? { reportedTotal: response.totalCount } : {}),
      };
    },
  },
];
