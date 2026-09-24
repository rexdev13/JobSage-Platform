import {
  fetchCompanySitePublicApiPage,
  type CompanySiteFailureClass,
} from "./companySiteHttp";
import type { BoardAdvert } from "./boardVacancyPipeline";

export type DirectBoardProvider = "Ashby" | "Greenhouse" | "Lever";

export type DirectBoardMapping = {
  provider: DirectBoardProvider;
  boardId: string;
  evidenceUrl: string;
  feedUrl: string;
};

export type DirectBoardScan = {
  adverts: BoardAdvert[];
  mapping: DirectBoardMapping | null;
  complete: boolean;
  transientFailure: boolean;
  failureClass: CompanySiteFailureClass | null;
  retryAt?: Date;
  error?: string;
  pagesFetched: number;
  advertsExtracted: number;
  excludedUnlisted: number;
};

const ASHBY_HOST = /^(?:www\.)?jobs\.ashbyhq\.com$/i;
const GREENHOUSE_HOST = /^(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io$/i;
const LEVER_HOST = /^jobs(?:\.eu)?\.lever\.co$/i;

function strictBoardId(value: string): string | null {
  const id = value.trim();
  return /^[a-z0-9][a-z0-9._-]{1,120}$/i.test(id) ? id : null;
}

export function parseDirectBoardMapping(
  provider: string | null | undefined,
  savedCareersUrl: string | null | undefined,
): DirectBoardMapping | null {
  if (!savedCareersUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(savedCareersUrl);
  } catch {
    return null;
  }
  const path = parsed.pathname.replace(/^\/|\/$/g, "");
  const selected = provider?.trim().toLowerCase();
  if (selected === "ashby" && ASHBY_HOST.test(parsed.hostname)) {
    const segments = path.split("/").filter(Boolean);
    const boardId = strictBoardId(segments[0] ?? "");
    const isBoardRoot = segments.length === 1;
    const isTalentCommunityEvidence =
      segments.length === 3 &&
      segments[1]?.toLowerCase() === "form" &&
      segments[2]?.toLowerCase() === "talent-community";
    if (!isBoardRoot && !isTalentCommunityEvidence) return null;
    if (!boardId) return null;
    return {
      provider: "Ashby",
      boardId,
      evidenceUrl: parsed.toString(),
      feedUrl: `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardId)}`,
    };
  }
  if (selected === "greenhouse" && GREENHOUSE_HOST.test(parsed.hostname)) {
    const boardId = strictBoardId(path);
    if (!boardId) return null;
    return {
      provider: "Greenhouse",
      boardId,
      evidenceUrl: parsed.toString(),
      feedUrl: `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardId)}/jobs?content=true`,
    };
  }
  if (selected === "lever" && LEVER_HOST.test(parsed.hostname)) {
    const boardId = strictBoardId(path);
    if (!boardId) return null;
    return {
      provider: "Lever",
      boardId,
      evidenceUrl: parsed.toString(),
      feedUrl: `https://api.lever.co/v0/postings/${encodeURIComponent(boardId)}?mode=json&limit=100&skip=0`,
    };
  }
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stripHtml(value: string): string {
  return value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function locationText(value: unknown): string | null {
  if (typeof value === "string") return text(value);
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return [record.name, record.city, record.region, record.country]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join(", ") || null;
}

function advert(
  organisationName: string,
  provider: DirectBoardProvider,
  id: string,
  title: string,
  url: string,
  applicationUrl: string | null,
  description: string | null,
  location: string | null,
  postedDate: string | null,
  evidenceUrl: string,
): BoardAdvert {
  return {
    organisationName,
    employer: organisationName,
    title,
    location,
    salary: null,
    url,
    applicationUrl,
    description,
    postedDate,
    targetRegions: null,
    boardName: null,
    externalId: id,
    sourceType: "company_site",
    companyVacancyEvidence: {
      kind: "known_ats_posting",
      provider,
      listingUrl: evidenceUrl,
    },
  };
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("direct board returned malformed JSON");
  }
}

function parseAshby(
  organisationName: string,
  mapping: DirectBoardMapping,
  body: string,
): { adverts: BoardAdvert[]; excludedUnlisted: number } {
  const jobs = (parseJson(body) as { jobs?: unknown }).jobs;
  if (!Array.isArray(jobs)) throw new Error("Ashby response did not contain a jobs array");
  let excludedUnlisted = 0;
  const adverts = jobs.flatMap((raw): BoardAdvert[] => {
    if (!raw || typeof raw !== "object") return [];
    const job = raw as Record<string, unknown>;
    if (job.isListed === false) {
      excludedUnlisted++;
      return [];
    }
    const id = text(job.id);
    const title = text(job.title);
    const url = text(job.jobUrl);
    if (!id || !title || !url) return [];
    return [advert(
      organisationName,
      "Ashby",
      id,
      title,
      url,
      text(job.applyUrl),
      text(job.descriptionPlain) ?? (text(job.descriptionHtml) ? stripHtml(text(job.descriptionHtml)!) : null),
      locationText(job.location),
      text(job.publishedAt),
      mapping.evidenceUrl,
    )];
  });
  return { adverts, excludedUnlisted };
}

function parseGreenhouse(
  organisationName: string,
  mapping: DirectBoardMapping,
  body: string,
): { adverts: BoardAdvert[]; excludedUnlisted: number } {
  const jobs = (parseJson(body) as { jobs?: unknown }).jobs;
  if (!Array.isArray(jobs)) throw new Error("Greenhouse response did not contain a jobs array");
  const adverts = jobs.flatMap((raw): BoardAdvert[] => {
    if (!raw || typeof raw !== "object") return [];
    const job = raw as Record<string, unknown>;
    const id = text(job.id);
    const title = text(job.title);
    const url = text(job.absolute_url);
    if (!id || !title || !url) return [];
    return [advert(
      organisationName,
      "Greenhouse",
      id,
      title,
      url,
      null,
      text(job.content) ? stripHtml(text(job.content)!) : null,
      locationText(job.location),
      text(job.updated_at) ?? text(job.first_published),
      mapping.evidenceUrl,
    )];
  });
  return { adverts, excludedUnlisted: 0 };
}

function parseLever(
  organisationName: string,
  mapping: DirectBoardMapping,
  body: string,
): { adverts: BoardAdvert[]; excludedUnlisted: number } {
  const jobs = parseJson(body);
  if (!Array.isArray(jobs)) throw new Error("Lever response did not contain a postings array");
  const adverts = jobs.flatMap((raw): BoardAdvert[] => {
    if (!raw || typeof raw !== "object") return [];
    const job = raw as Record<string, unknown>;
    const id = text(job.id);
    const title = text(job.text);
    const url = text(job.hostedUrl) ?? text(job.applyUrl);
    if (!id || !title || !url) return [];
    const categories = job.categories;
    const location = categories && typeof categories === "object"
      ? locationText((categories as Record<string, unknown>).location)
      : null;
    return [advert(
      organisationName,
      "Lever",
      id,
      title,
      url,
      text(job.applyUrl),
      text(job.descriptionPlain) ?? (text(job.description) ? stripHtml(text(job.description)!) : null),
      location,
      text(job.createdAt) ?? text(job.updatedAt),
      mapping.evidenceUrl,
    )];
  });
  return { adverts, excludedUnlisted: 0 };
}

export async function fetchDirectEmployerBoard(
  organisationName: string,
  provider: string | null | undefined,
  savedCareersUrl: string | null | undefined,
  options: { deadlineMs?: number } = {},
): Promise<DirectBoardScan> {
  const mapping = parseDirectBoardMapping(provider, savedCareersUrl);
  if (!mapping) {
    return {
      adverts: [],
      mapping: null,
      complete: false,
      transientFailure: false,
      failureClass: "permanent",
      error: "saved careers URL is not a validated supported employer board",
      pagesFetched: 0,
      advertsExtracted: 0,
      excludedUnlisted: 0,
    };
  }
  const deadlineMs = options.deadlineMs ?? Date.now() + 25_000;
  const fetchPage = (url: string) => fetchCompanySitePublicApiPage(
    url,
    deadlineMs,
    2_000_000,
  );
  const result = await fetchPage(mapping.feedUrl);
  if (!result.ok) {
    return {
      adverts: [],
      mapping,
      complete: false,
      transientFailure: result.failureClass !== "permanent",
      failureClass: result.failureClass ?? "temporary",
      retryAt: result.retryAt,
      error: result.reason,
      pagesFetched: 0,
      advertsExtracted: 0,
      excludedUnlisted: 0,
    };
  }
  if (result.status < 200 || result.status >= 300) {
    return {
      adverts: [],
      mapping,
      complete: false,
      transientFailure: result.status === 403 || result.status === 429 || result.status >= 500,
      failureClass: result.status === 404 ? "permanent" : "temporary",
      error: `direct board HTTP ${result.status}`,
      pagesFetched: 1,
      advertsExtracted: 0,
      excludedUnlisted: 0,
    };
  }
  try {
    let parsed = mapping.provider === "Ashby"
      ? parseAshby(organisationName, mapping, result.body)
      : mapping.provider === "Greenhouse"
        ? parseGreenhouse(organisationName, mapping, result.body)
        : parseLever(organisationName, mapping, result.body);
    let pagesFetched = 1;
    let paginationComplete = true;
    if (mapping.provider === "Lever") {
      const allAdverts = [...parsed.adverts];
      let skip = allAdverts.length;
      while (parsed.adverts.length >= 100 && pagesFetched < 10 && Date.now() < deadlineMs) {
        const nextUrl = `${mapping.feedUrl.split("&skip=")[0]}&skip=${skip}`;
        const next = await fetchPage(nextUrl);
        if (!next.ok || next.status < 200 || next.status >= 300) {
          return {
            adverts: [],
            mapping,
            complete: false,
            transientFailure: next.ok ? next.status >= 500 || next.status === 429 : next.failureClass !== "permanent",
            failureClass: next.ok ? "temporary" : next.failureClass ?? "temporary",
            retryAt: next.ok ? undefined : next.retryAt,
            error: next.ok ? `direct board HTTP ${next.status}` : next.reason,
            pagesFetched,
            advertsExtracted: allAdverts.length,
            excludedUnlisted: 0,
          };
        }
        parsed = parseLever(organisationName, mapping, next.body);
        allAdverts.push(...parsed.adverts);
        skip += parsed.adverts.length;
        pagesFetched++;
        if (parsed.adverts.length === 0) break;
      }
      if (parsed.adverts.length >= 100 && (pagesFetched >= 10 || Date.now() >= deadlineMs)) {
        paginationComplete = false;
      }
      parsed = { adverts: allAdverts, excludedUnlisted: 0 };
    }
    return {
      adverts: parsed.adverts,
      mapping,
      complete: paginationComplete,
      transientFailure: !paginationComplete,
      failureClass: paginationComplete ? null : "temporary",
      error: paginationComplete ? undefined : "Lever pagination limit or deadline reached",
      pagesFetched,
      advertsExtracted: parsed.adverts.length,
      excludedUnlisted: parsed.excludedUnlisted,
    };
  } catch (error) {
    return {
      adverts: [],
      mapping,
      complete: false,
      transientFailure: true,
      failureClass: "temporary",
      error: error instanceof Error ? error.message : "direct board parse failed",
      pagesFetched: 1,
      advertsExtracted: 0,
      excludedUnlisted: 0,
    };
  }
}