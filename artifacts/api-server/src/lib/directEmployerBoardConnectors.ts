import {
  fetchCompanySitePublicApiPage,
  fetchCompanySitePublicApiPost,
  fetchCompanySiteRobotsAwarePublicApiPage,
  type CompanySiteFailureClass,
} from "./companySiteHttp";
import type { BoardAdvert } from "./boardVacancyPipeline";

export type DirectBoardProvider =
  | "Ashby"
  | "Greenhouse"
  | "Lever"
  | "SmartRecruiters"
  | "Recruitee"
  | "Personio"
  | "Pinpoint"
  | "Workday";

export type DirectBoardMapping = {
  provider: DirectBoardProvider;
  boardId: string;
  evidenceUrl: string;
  feedUrl: string;
  postingHostnames?: string[];
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
const SMARTRECRUITERS_HOST = /^jobs\.smartrecruiters\.com$/i;
const RECRUITEE_HOST = /^[a-z0-9-]+\.recruitee\.com$/i;
const PERSONIO_HOST = /^[a-z0-9-]+\.jobs\.personio\.(?:de|com)$/i;
const PINPOINT_HOST = /^([a-z0-9-]+)\.pinpointhq\.com$/i;
const CIRCLE_WORKDAY_HOST = /^circlehealth\.wd103\.myworkdayjobs\.com$/i;

function strictBoardId(value: string): string | null {
  const id = value.trim();
  return /^[a-z0-9][a-z0-9._-]{1,120}$/i.test(id) ? id : null;
}

export function parseDirectBoardMapping(
  provider: string | null | undefined,
  savedCareersUrl: string | null | undefined,
  options: { firstPartyEvidenceUrl?: string | null } = {},
): DirectBoardMapping | null {
  if (!savedCareersUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(savedCareersUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
  if (parsed.pathname.includes("//") || /%(?:2f|5c)/i.test(parsed.pathname)) return null;
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
  if (selected === "smartrecruiters" && SMARTRECRUITERS_HOST.test(parsed.hostname)) {
    const segments = path.split("/").filter(Boolean);
    const boardId = strictBoardId(segments[0] ?? "");
    if (!boardId || (segments.length !== 1 && segments.length !== 3)) return null;
    return {
      provider: "SmartRecruiters",
      boardId,
      evidenceUrl: parsed.toString(),
      feedUrl: `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(boardId)}/postings?limit=100&offset=0`,
    };
  }
  if (selected === "recruitee" && RECRUITEE_HOST.test(parsed.hostname)) {
    const segments = path.split("/").filter(Boolean);
    if (segments.length > 0 && (segments[0]?.toLowerCase() !== "o" || segments.length > 3)) return null;
    const boardId = strictBoardId(parsed.hostname.split(".")[0] ?? "");
    if (!boardId) return null;
    return {
      provider: "Recruitee",
      boardId,
      evidenceUrl: parsed.toString(),
      feedUrl: `https://${parsed.hostname.toLowerCase()}/api/offers/`,
    };
  }
  if (selected === "personio" && PERSONIO_HOST.test(parsed.hostname)) {
    const segments = path.split("/").filter(Boolean);
    if (segments.length > 0 && (segments[0]?.toLowerCase() !== "job" || segments.length !== 2)) return null;
    const boardId = strictBoardId(parsed.hostname.split(".")[0] ?? "");
    if (!boardId) return null;
    return {
      provider: "Personio",
      boardId,
      evidenceUrl: parsed.toString(),
      feedUrl: `${parsed.origin}/xml`,
    };
  }
  if (selected === "pinpoint") {
    const hostMatch = parsed.hostname.match(PINPOINT_HOST);
    const segments = path.split("/").filter(Boolean);
    if (!hostMatch || (segments.length > 0 && (segments.length !== 1 || segments[0]?.toLowerCase() !== "postings.json")) ||
        parsed.search || parsed.hash) {
      return null;
    }
    const boardId = strictBoardId(hostMatch[1] ?? "");
    if (!boardId || ["www", "app", "api"].includes(boardId.toLowerCase())) return null;
    const postingHostnames = new Set([parsed.hostname.toLowerCase()]);
    if (options.firstPartyEvidenceUrl) {
      try {
        const evidence = new URL(options.firstPartyEvidenceUrl);
        if (evidence.protocol === "https:" && !evidence.username && !evidence.password && !evidence.port) {
          postingHostnames.add(evidence.hostname.toLowerCase());
        }
      } catch {
        // Invalid evidence must not widen the allowed posting URL hosts.
      }
    }
    return {
      provider: "Pinpoint",
      boardId,
      evidenceUrl: parsed.toString(),
      feedUrl: `https://${parsed.hostname.toLowerCase()}/postings.json`,
      postingHostnames: [...postingHostnames],
    };
  }
  if (selected === "workday") {
    if (!CIRCLE_WORKDAY_HOST.test(parsed.hostname) ||
        path.toLowerCase() !== "chgcareers" || parsed.search || parsed.hash) return null;
    if (options.firstPartyEvidenceUrl !==
      "http://careers.circlehealthgroup.co.uk/jobs/sister-charge-nurse-critical-care-jr110643") return null;
    return {
      provider: "Workday",
      boardId: "chgcareers",
      evidenceUrl: parsed.toString(),
      feedUrl: "https://circlehealth.wd103.myworkdayjobs.com/wday/cxs/circlehealth/chgcareers/jobs",
    };
  }
  return null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function identifier(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  return text(value);
}

function timestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return text(value);
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

function smartRecruitersLocation(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return [record.city, record.region, record.country]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .join(", ") || null;
}

function firstText(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) return value;
  }
  return null;
}

function validatedJobUrl(value: unknown, mapping: DirectBoardMapping): string | null {
  const raw = text(value);
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) return null;
  if (parsed.pathname.includes("//") || /%(?:2f|5c)/i.test(parsed.pathname)) return null;
  const segments = parsed.pathname.split("/").filter(Boolean);
  const startsWithBoard = segments[0]?.toLowerCase() === mapping.boardId.toLowerCase();
  switch (mapping.provider) {
    case "Ashby":
      return ASHBY_HOST.test(parsed.hostname) && startsWithBoard && segments.length >= 2 ? parsed.toString() : null;
    case "Greenhouse":
      return GREENHOUSE_HOST.test(parsed.hostname) && startsWithBoard &&
        segments.length === 3 && segments[1]?.toLowerCase() === "jobs" ? parsed.toString() : null;
    case "Lever":
      return LEVER_HOST.test(parsed.hostname) && startsWithBoard && segments.length >= 2 ? parsed.toString() : null;
    case "SmartRecruiters":
      return SMARTRECRUITERS_HOST.test(parsed.hostname) && startsWithBoard && segments.length >= 2
        ? parsed.toString() : null;
    case "Recruitee":
      return parsed.hostname.toLowerCase() === `${mapping.boardId.toLowerCase()}.recruitee.com` &&
        segments[0]?.toLowerCase() === "o" && segments.length >= 2 ? parsed.toString() : null;
    case "Personio":
      return parsed.hostname.toLowerCase() === new URL(mapping.evidenceUrl).hostname.toLowerCase() &&
        segments.length === 2 && segments[0]?.toLowerCase() === "job" ? parsed.toString() : null;
    case "Pinpoint":
      return Boolean(
        mapping.postingHostnames?.includes(parsed.hostname.toLowerCase()) &&
        segments.length >= 2 &&
        segments.length <= 4 &&
        segments[segments.length - 2]?.toLowerCase() === "postings",
      ) ? parsed.toString() : null;
    case "Workday":
      return CIRCLE_WORKDAY_HOST.test(parsed.hostname) &&
        /^\/en-GB\/chgcareers\/job\/[A-Za-z0-9][A-Za-z0-9._~-]*\/[A-Za-z0-9][A-Za-z0-9._~-]*_JR[0-9]{4,12}$/i
          .test(parsed.pathname) ? parsed.toString() : null;
  }
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
    if (!raw || typeof raw !== "object") throw new Error("Malformed job entry: snapshot is incomplete");
    const job = raw as Record<string, unknown>;
    if (job.isListed === false) {
      excludedUnlisted++;
      return [];
    }
    const id = identifier(job.id);
    const title = text(job.title);
    const url = validatedJobUrl(job.jobUrl, mapping);
    if (!id || !title || !url) throw new Error("Missing or invalid job identity/title/URL: snapshot is incomplete");
    const applyUrl = job.applyUrl == null ? null : validatedJobUrl(job.applyUrl, mapping);
    return [advert(
      organisationName,
      "Ashby",
      id,
      title,
      url,
      applyUrl,
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
  const payload = parseJson(body) as { jobs?: unknown; meta?: { total?: number } };
  const jobs = payload.jobs;
  if (!Array.isArray(jobs)) throw new Error("Greenhouse response did not contain a jobs array");
  if (typeof payload.meta?.total === "number" && payload.meta.total !== jobs.length) {
    throw new Error("Greenhouse total does not match returned jobs: snapshot is incomplete");
  }
  const adverts = jobs.flatMap((raw): BoardAdvert[] => {
    if (!raw || typeof raw !== "object") throw new Error("Malformed job entry: snapshot is incomplete");
    const job = raw as Record<string, unknown>;
    const id = identifier(job.id);
    const title = text(job.title);
    const url = validatedJobUrl(job.absolute_url, mapping);
    if (!id || !title || !url) throw new Error("Missing or invalid job identity/title/URL: snapshot is incomplete");
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
    if (!raw || typeof raw !== "object") throw new Error("Malformed posting entry: snapshot is incomplete");
    const job = raw as Record<string, unknown>;
    const id = identifier(job.id);
    const title = text(job.text);
    const hostedUrl = validatedJobUrl(job.hostedUrl, mapping);
    const applyUrl = job.applyUrl == null ? null : validatedJobUrl(job.applyUrl, mapping);
    const url = hostedUrl ?? applyUrl;
    if (!id || !title || !url) throw new Error("Missing or invalid job identity/title/URL: snapshot is incomplete");
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
      applyUrl,
      text(job.descriptionPlain) ?? (text(job.description) ? stripHtml(text(job.description)!) : null),
      location,
      text(job.createdAt) ?? text(job.updatedAt),
      mapping.evidenceUrl,
    )];
  });
  return { adverts, excludedUnlisted: 0 };
}

function parseSmartRecruiters(
  organisationName: string,
  mapping: DirectBoardMapping,
  body: string,
): { adverts: BoardAdvert[]; excludedUnlisted: number; totalFound: number | null; returnedCount: number } {
  const payload = parseJson(body) as {
    content?: unknown;
    postings?: unknown;
    totalFound?: unknown;
    total?: unknown;
  };
  const jobs = Array.isArray(payload.content)
    ? payload.content
    : Array.isArray(payload.postings)
      ? payload.postings
      : null;
  if (!jobs) throw new Error("SmartRecruiters response did not contain a postings array");
  const total = payload.totalFound ?? payload.total;
  const totalFound = typeof total === "number" && Number.isSafeInteger(total) && total >= 0 ? total : null;
  if (total !== undefined && totalFound === null) {
    throw new Error("SmartRecruiters total is invalid: snapshot is incomplete");
  }
  const adverts = jobs.flatMap((raw): BoardAdvert[] => {
    if (!raw || typeof raw !== "object") throw new Error("Malformed posting entry: snapshot is incomplete");
    const job = raw as Record<string, unknown>;
    const id = identifier(job.id ?? job.uuid);
    const title = firstText(job, ["name", "title"]);
    const url = validatedJobUrl(firstText(job, ["postingUrl", "ref", "url"]), mapping);
    if (!id || !title || !url) throw new Error("Missing or invalid job identity/title/URL: snapshot is incomplete");
    const jobAd = job.jobAd && typeof job.jobAd === "object" ? job.jobAd as Record<string, unknown> : {};
    const sections = jobAd.sections && typeof jobAd.sections === "object"
      ? jobAd.sections as Record<string, unknown> : {};
    return [advert(
      organisationName,
      "SmartRecruiters",
      id,
      title,
      url,
      null,
      text(sections.jobDescription) ? stripHtml(text(sections.jobDescription)!) : null,
      smartRecruitersLocation(job.location),
      text(job.releasedDate) ?? text(job.updatedDate),
      mapping.evidenceUrl,
    )];
  });
  return { adverts, excludedUnlisted: 0, totalFound, returnedCount: jobs.length };
}

function parseRecruitee(
  organisationName: string,
  mapping: DirectBoardMapping,
  body: string,
): { adverts: BoardAdvert[]; excludedUnlisted: number } {
  const payload = parseJson(body) as { offers?: unknown; jobs?: unknown };
  const jobs = Array.isArray(payload.offers)
    ? payload.offers
    : Array.isArray(payload.jobs)
      ? payload.jobs
      : null;
  if (!jobs) throw new Error("Recruitee response did not contain an offers array");
  const adverts = jobs.flatMap((raw): BoardAdvert[] => {
    if (!raw || typeof raw !== "object") throw new Error("Malformed offer entry: snapshot is incomplete");
    const job = raw as Record<string, unknown>;
    const id = identifier(job.id);
    const title = firstText(job, ["title", "name"]);
    const url = validatedJobUrl(firstText(job, ["careers_url", "url", "web_url"]), mapping);
    if (!id || !title || !url) throw new Error("Missing or invalid job identity/title/URL: snapshot is incomplete");
    const applicationUrl = job.apply_url == null
      ? url
      : validatedJobUrl(firstText(job, ["apply_url", "careers_url", "url"]), mapping);
    const location = firstText(job, ["location", "city", "country"]);
    return [advert(
      organisationName,
      "Recruitee",
      id,
      title,
      url,
      applicationUrl,
      text(job.description) ? stripHtml(text(job.description)!) : null,
      location,
      firstText(job, ["created_at", "published_at", "updated_at"]),
      mapping.evidenceUrl,
    )];
  });
  return { adverts, excludedUnlisted: 0 };
}

function xmlValue(block: string, tag: string): string | null {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = block.match(new RegExp(`<${escapedTag}\\b[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, "i"));
  if (!match?.[1]) return null;
  const value = match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  return stripHtml(value) || null;
}

function parsePersonio(
  organisationName: string,
  mapping: DirectBoardMapping,
  body: string,
): { adverts: BoardAdvert[]; excludedUnlisted: number } {
  const rootOpenings = body.match(/<workzag-jobs\b[^>]*>/gi) ?? [];
  const rootClosings = body.match(/<\/workzag-jobs\s*>/gi) ?? [];
  if (rootOpenings.length !== 1 || rootClosings.length !== 1 ||
      body.indexOf(rootOpenings[0]!) > body.indexOf(rootClosings[0]!)) {
    throw new Error("Personio XML feed is truncated or malformed");
  }
  const positionOpenings = body.match(/<position\b/gi) ?? [];
  const positionClosings = body.match(/<\/position\s*>/gi) ?? [];
  const positions = body.match(/<position\b[\s\S]*?<\/position>/gi) ?? [];
  if (positionOpenings.length !== positionClosings.length ||
      positions.length !== positionOpenings.length) {
    throw new Error("Personio XML feed contains a malformed or unclosed position");
  }
  if (positions.length === 0) return { adverts: [], excludedUnlisted: 0 };
  const adverts = positions.flatMap((entry): BoardAdvert[] => {
    const id = xmlValue(entry, "id");
    const title = xmlValue(entry, "name");
    if (!id || !title) throw new Error("Missing job identity/title: snapshot is incomplete");
    const url = `https://${new URL(mapping.evidenceUrl).hostname}/job/${encodeURIComponent(id)}`;
    const location = [xmlValue(entry, "office"), xmlValue(entry, "subcompany")]
      .filter(Boolean)
      .join(", ") || null;
    return [advert(
      organisationName,
      "Personio",
      id,
      title,
      url,
      url,
      xmlValue(entry, "jobDescriptions"),
      location,
      xmlValue(entry, "createdAt"),
      mapping.evidenceUrl,
    )];
  });
  return { adverts, excludedUnlisted: 0 };
}

function pinpointLocation(value: unknown): string | null {
  if (!value || typeof value !== "object") return locationText(value);
  const record = value as Record<string, unknown>;
  const parts = [record.name, record.city, record.province, record.country]
    .filter((part): part is string => typeof part === "string" && part.trim() !== "")
    .map((part) => part.trim());
  return [...new Set(parts)].join(", ") || null;
}

function parsePinpoint(
  organisationName: string,
  mapping: DirectBoardMapping,
  body: string,
): { adverts: BoardAdvert[]; excludedUnlisted: number } {
  const payload = parseJson(body) as { data?: unknown };
  if (!Array.isArray(payload.data)) {
    throw new Error("Pinpoint response did not contain a data array");
  }
  const seenIds = new Set<string>();
  const adverts = payload.data.map((raw): BoardAdvert => {
    if (!raw || typeof raw !== "object") {
      throw new Error("Malformed Pinpoint posting: snapshot is incomplete");
    }
    const posting = raw as Record<string, unknown>;
    const id = identifier(posting.id);
    const title = text(posting.title);
    const url = validatedJobUrl(posting.url, mapping);
    if (!id || !title || !url || seenIds.has(id)) {
      throw new Error("Missing, duplicate, or invalid Pinpoint posting identity/title/URL");
    }
    seenIds.add(id);
    return advert(
      organisationName,
      "Pinpoint",
      id,
      title,
      url,
      url,
      text(posting.description) ? stripHtml(text(posting.description)!) : null,
      pinpointLocation(posting.location),
      timestamp(posting.created_at) ?? timestamp(posting.updated_at),
      mapping.evidenceUrl,
    );
  });
  return { adverts, excludedUnlisted: 0 };
}

function parseWorkday(
  organisationName: string,
  mapping: DirectBoardMapping,
  body: string,
  offset = 0,
): { adverts: BoardAdvert[]; excludedUnlisted: number; total: number; returned: number } {
  const payload = parseJson(body) as { total?: unknown; jobPostings?: unknown };
  if (!Number.isSafeInteger(payload.total) || (payload.total as number) < 0 ||
      !Array.isArray(payload.jobPostings)) {
    throw new Error("Workday response has invalid total or jobPostings: snapshot is incomplete");
  }
  const seen = new Set<string>();
  const adverts = payload.jobPostings.map((raw, index): BoardAdvert => {
    if (!raw || typeof raw !== "object") {
      throw new Error(`Malformed Workday posting at offset ${offset}, item ${index}: snapshot is incomplete`);
    }
    const job = raw as Record<string, unknown>;
    const title = text(job.title);
    const externalPath = text(job.externalPath);
    const bullets = Array.isArray(job.bulletFields) ? job.bulletFields : [];
    const id = bullets.length === 1 && typeof bullets[0] === "string" &&
      /^JR[0-9]{4,12}$/i.test(bullets[0]) ? bullets[0].toUpperCase() : null;
    const pathMatch = externalPath?.match(
      /^\/job\/[A-Za-z0-9][A-Za-z0-9._~-]*\/[A-Za-z0-9][A-Za-z0-9._~-]*_JR([0-9]{4,12})(?:-[0-9]+)?$/i,
    );
    const duplicateId = id !== null && seen.has(id);
    const invalidPath = !pathMatch || !id || `JR${pathMatch[1]}` !== id;
    if (!id || !title || invalidPath || duplicateId) {
      const reasons = [
        ...(!id ? ["id"] : []),
        ...(!title ? ["title"] : []),
        ...(!pathMatch ? ["externalPath"] : []),
        ...(pathMatch && id && `JR${pathMatch[1]}` !== id ? ["identity/path mismatch"] : []),
        ...(duplicateId ? ["duplicate id"] : []),
      ];
      throw new Error(
        `Invalid Workday posting at offset ${offset}, item ${index}: ${reasons.join(", ")}`,
      );
    }
    seen.add(id);
    const url = `https://circlehealth.wd103.myworkdayjobs.com/en-GB/chgcareers${externalPath}`;
    return advert(organisationName, "Workday", id, title, url, url,
      text(job.description) ?? text(job.jobDescription),
      text(job.locationsText), text(job.startDate), mapping.evidenceUrl);
  });
  return { adverts, excludedUnlisted: 0, total: payload.total as number, returned: adverts.length };
}

export async function fetchDirectEmployerBoard(
  organisationName: string,
  provider: string | null | undefined,
  savedCareersUrl: string | null | undefined,
  options: {
    deadlineMs?: number;
    firstPartyEvidenceUrl?: string | null;
    readOnly?: boolean;
    noHostState?: boolean;
  } = {},
): Promise<DirectBoardScan> {
  const mapping = parseDirectBoardMapping(provider, savedCareersUrl, {
    firstPartyEvidenceUrl: options.firstPartyEvidenceUrl,
  });
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
    const fetchPage = (url: string) => {
      if (mapping.provider === "Workday") {
        return fetchCompanySitePublicApiPost(url, JSON.stringify({
          appliedFacets: {}, limit: 20, offset: Number(new URL(url).searchParams.get("offset") ?? "0"), searchText: "",
        }), deadlineMs, 2_000_000, {
          readOnly: options.readOnly === true,
          ...(options.noHostState ? { noHostState: true } : {}),
        });
      }
    const fetchPublicApiPage = mapping.provider === "Recruitee" || mapping.provider === "Personio"
      ? fetchCompanySiteRobotsAwarePublicApiPage
      : fetchCompanySitePublicApiPage;
    return fetchPublicApiPage(url, deadlineMs, 2_000_000, {
      readOnly: options.readOnly === true,
      ...(options.noHostState ? { noHostState: true } : {}),
    });
  };
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
        : mapping.provider === "Lever"
          ? parseLever(organisationName, mapping, result.body)
          : mapping.provider === "SmartRecruiters"
            ? parseSmartRecruiters(organisationName, mapping, result.body)
            : mapping.provider === "Recruitee"
              ? parseRecruitee(organisationName, mapping, result.body)
       : mapping.provider === "Personio"
                ? parsePersonio(organisationName, mapping, result.body)
              : mapping.provider === "Workday"
                ? parseWorkday(organisationName, mapping, result.body)
                : parsePinpoint(organisationName, mapping, result.body);
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
    if (mapping.provider === "SmartRecruiters") {
      let smartPage = parseSmartRecruiters(organisationName, mapping, result.body);
      const allAdverts = [...smartPage.adverts];
      let offset = smartPage.returnedCount;
      let expectedTotal = smartPage.totalFound;
      let totalsStable = expectedTotal !== null;
      while (
        (expectedTotal !== null ? offset < expectedTotal : smartPage.returnedCount >= 100) &&
        pagesFetched < 10 &&
        Date.now() < deadlineMs
      ) {
        const nextUrl = mapping.feedUrl.replace(/offset=\d+/, `offset=${offset}`);
        const next = await fetchPage(nextUrl);
        if (!next.ok || next.status < 200 || next.status >= 300) {
          return {
            adverts: allAdverts,
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
        smartPage = parseSmartRecruiters(organisationName, mapping, next.body);
        if (smartPage.totalFound === null || expectedTotal === null ||
            expectedTotal !== smartPage.totalFound) {
          totalsStable = false;
        }
        allAdverts.push(...smartPage.adverts);
        offset += smartPage.returnedCount;
        pagesFetched++;
        if (smartPage.returnedCount === 0) break;
      }
      paginationComplete = totalsStable && expectedTotal !== null &&
        offset === expectedTotal;
      if (pagesFetched >= 10 && !paginationComplete || Date.now() >= deadlineMs && !paginationComplete) {
        paginationComplete = false;
      }
      parsed = { adverts: allAdverts, excludedUnlisted: 0 };
    }
    if (mapping.provider === "Recruitee") {
      paginationComplete = false;
    }
    if (mapping.provider === "Workday") {
      const first = parsed as ReturnType<typeof parseWorkday>;
      const allAdverts = [...first.adverts];
      const expectedTotal = first.total;
      let offset = first.returned;
      let totalsConsistent = true;
      while (offset < expectedTotal && pagesFetched < 30 && Date.now() < deadlineMs) {
        const next = await fetchPage(`${mapping.feedUrl}?offset=${offset}`);
        if (!next.ok || next.status < 200 || next.status >= 300) {
          paginationComplete = false;
          break;
        }
        const page = parseWorkday(organisationName, mapping, next.body, offset);
        // Circle's CXS endpoint reports total=0 on some continuation pages even
        // while returning postings. Keep the first-page total authoritative;
        // any nonzero continuation total must still match it.
        if ((page.total !== expectedTotal && page.total !== 0) || page.returned === 0) {
          totalsConsistent = false;
          break;
        }
        allAdverts.push(...page.adverts);
        offset += page.returned;
        pagesFetched++;
      }
      paginationComplete = totalsConsistent && offset === expectedTotal &&
        pagesFetched <= 30 && Date.now() <= deadlineMs;
      const ids = new Set<string>();
      for (const item of allAdverts) {
        const id = item.externalId;
        if (!id || ids.has(id)) paginationComplete = false;
        if (id) ids.add(id);
      }
      parsed = { adverts: allAdverts, excludedUnlisted: 0 };
    }
    return {
      adverts: parsed.adverts,
      mapping,
      complete: paginationComplete,
      transientFailure: !paginationComplete,
      failureClass: paginationComplete ? null : "temporary",
      error: paginationComplete
        ? undefined
        : mapping.provider === "SmartRecruiters"
          ? "SmartRecruiters total is missing or unstable, or pagination limit/deadline reached"
           : mapping.provider === "Recruitee"
              ? "Recruitee feed has no trustworthy total or pagination metadata"
            : mapping.provider === "Workday"
              ? "Workday total is missing or unstable, or pagination limit/deadline reached"
            : "Lever pagination limit or deadline reached",
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