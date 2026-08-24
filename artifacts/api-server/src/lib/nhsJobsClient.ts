import { isValidVacancyDeepLink } from "./vacancyUrlPolicy";
import { isManualLabourTitle } from "./vacancyTitlePolicy";

const NHS_JOBS_ORIGIN = "https://www.jobs.nhs.uk";
const REQUEST_TIMEOUT_MS = 8_000;
const USER_AGENT = "JOBSAGE vacancy discovery/1.0 (+https://jobsage.co.uk)";
const MAX_VACANCIES_PER_EMPLOYER = 8;

export type NhsJobsVacancy = {
  title: string;
  location: string | null;
  salary: string | null;
  url: string;
  description: null;
  postedDate: string | null;
};

export type NhsJobsSearchResult = {
  sourceUrl: string;
  vacancies: NhsJobsVacancy[];
  structuredFeedWorked: boolean;
  /** False only when the public HTML results request did not complete. */
  resultsRequestSucceeded: boolean;
};

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&(amp|quot|apos|lt|gt|nbsp|#39);/gi, (_, entity: string) => {
      const entities: Record<string, string> = {
        amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">", nbsp: " ", "#39": "'",
      };
      return entities[entity.toLowerCase()] ?? "";
    });
}

function textFromHtml(value: string): string {
  return decodeHtml(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function extractTagText(block: string, dataTest: string): string | null {
  const match = block.match(
    new RegExp(`<[^>]*data-test=["']${dataTest}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i"),
  );
  return match ? textFromHtml(match[1] ?? "") || null : null;
}

function extractTitleAndUrl(block: string): { title: string; url: string } | null {
  const match = block.match(
    /<a\b(?=[^>]*data-test=["']search-result-job-title["'])[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
  );
  if (!match) return null;
  const title = textFromHtml(match[2] ?? "");
  const url = new URL(decodeHtml(match[1] ?? ""), NHS_JOBS_ORIGIN).toString();
  return title ? { title, url } : null;
}

function extractEmployerAndLocation(block: string): { employer: string; location: string | null } {
  const match = block.match(/<div\b(?=[^>]*data-test=["']search-result-location["'])[^>]*>([\s\S]*?)<\/div>/i);
  if (!match) return { employer: "", location: null };

  const inner = match[1] ?? "";
  const locationMatch = inner.match(/<div\b[^>]*class=["'][^"']*location-font-size[^"']*["'][^>]*>([\s\S]*?)$/i);
  const employerHtml = locationMatch ? inner.slice(0, locationMatch.index) : inner;
  return {
    employer: textFromHtml(employerHtml),
    location: locationMatch ? textFromHtml(locationMatch[1] ?? "") || null : null,
  };
}

function stripFieldLabel(value: string | null, label: string): string | null {
  if (!value) return null;
  return value.replace(new RegExp(`^${label}:\\s*`, "i"), "").trim() || null;
}

const GENERIC_ORGANISATION_WORDS = new Set([
  "and", "the", "of", "for", "nhs", "foundation", "trust", "hospital", "hospitals",
  "health", "healthcare", "university", "limited", "ltd", "plc", "services", "service",
]);

function meaningfulWords(value: string): string[] {
  return textFromHtml(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !GENERIC_ORGANISATION_WORDS.has(word));
}

/**
 * Search results can include unrelated NHS employers. Require an exact normalised
 * name or enough distinctive sponsor-name words before retaining a vacancy.
 */
export function employerNamesCloselyMatch(organisationName: string, listedEmployer: string): boolean {
  const requested = meaningfulWords(organisationName);
  const listed = new Set(meaningfulWords(listedEmployer));
  if (requested.length === 0 || listed.size === 0) return false;

  const requestedNormalised = requested.join(" ");
  const listedNormalised = [...listed].join(" ");
  if (requestedNormalised === listedNormalised) return true;

  const shared = requested.filter((word) => listed.has(word));
  const minimumShared = requested.length <= 2 ? requested.length : Math.max(2, Math.ceil(requested.length * 0.6));
  return shared.length >= minimumShared;
}

function allowedNhsAdvertUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const allowedHost =
      host === "jobs.nhs.uk" ||
      host.endsWith(".jobs.nhs.uk") ||
      host === "trac.jobs" ||
      host.endsWith(".trac.jobs") ||
      host === "healthjobsuk.com" ||
      host.endsWith(".healthjobsuk.com");
    return allowedHost && isValidVacancyDeepLink(url);
  } catch {
    return false;
  }
}

export function parseNhsJobsHtml(html: string, organisationName: string): NhsJobsVacancy[] {
  const resultBlocks = html.match(
    /<li\b(?=[^>]*data-test=["']search-result["'])[^>]*>([\s\S]*?)(?=<li\b(?=[^>]*data-test=["']search-result["'])|<\/ul>)/gi,
  ) ?? [];
  const vacancies: NhsJobsVacancy[] = [];
  const urls = new Set<string>();

  for (const block of resultBlocks) {
    const titleAndUrl = extractTitleAndUrl(block);
    if (!titleAndUrl || !allowedNhsAdvertUrl(titleAndUrl.url) || isManualLabourTitle(titleAndUrl.title)) {
      continue;
    }

    const { employer, location } = extractEmployerAndLocation(block);
    if (!employerNamesCloselyMatch(organisationName, employer) || urls.has(titleAndUrl.url)) {
      continue;
    }

    urls.add(titleAndUrl.url);
    vacancies.push({
      title: titleAndUrl.title,
      location,
      salary: stripFieldLabel(extractTagText(block, "search-result-salary"), "Salary"),
      url: titleAndUrl.url,
      description: null,
      postedDate: stripFieldLabel(extractTagText(block, "search-result-publicationDate"), "Date posted"),
    });
    if (vacancies.length >= MAX_VACANCIES_PER_EMPLOYER) break;
  }

  return vacancies;
}

async function fetchText(url: string): Promise<{ text: string; contentType: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/xml,text/xml,text/html;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
      },
    });
    if (!response.ok) return null;
    return {
      text: await response.text(),
      contentType: response.headers.get("content-type") ?? "",
    };
  } catch (error) {
    console.info(`[nhs-jobs] HTTP search request failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseStructuredFeed(text: string, organisationName: string): NhsJobsVacancy[] {
  if (!/^\s*<\?xml|^\s*<(rss|feed|results|jobs)\b/i.test(text)) return [];
  const records = text.match(/<(item|job|vacancy)\b[^>]*>[\s\S]*?<\/\1>/gi) ?? [];
  const vacancies: NhsJobsVacancy[] = [];
  for (const record of records) {
    const read = (tag: string): string | null => {
      const match = record.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
      return match ? textFromHtml(match[1] ?? "") || null : null;
    };
    const title = read("title");
    const employer = read("employer") ?? read("organisation") ?? "";
    const rawUrl = read("link") ?? read("url");
    if (!title || !rawUrl) continue;
    const url = new URL(rawUrl, NHS_JOBS_ORIGIN).toString();
    if (!allowedNhsAdvertUrl(url) || isManualLabourTitle(title) || !employerNamesCloselyMatch(organisationName, employer)) continue;
    vacancies.push({
      title,
      location: read("location"),
      salary: read("salary"),
      url,
      description: null,
      postedDate: read("pubDate") ?? read("postedDate"),
    });
    if (vacancies.length >= MAX_VACANCIES_PER_EMPLOYER) break;
  }
  return vacancies;
}

/**
 * Make no more than two polite NHS Jobs requests per employer: a legacy
 * structured-feed attempt followed by the currently working public HTML results.
 */
export async function searchNhsJobs(organisationName: string): Promise<NhsJobsSearchResult> {
  const structuredParams = new URLSearchParams({ keyword: organisationName, field: "employer" });
  const resultsParams = new URLSearchParams({ employer: organisationName, language: "en" });
  const structuredUrl = `${NHS_JOBS_ORIGIN}/search_xml?${structuredParams.toString()}`;
  const resultsUrl = `${NHS_JOBS_ORIGIN}/candidate/search/results?${resultsParams.toString()}`;

  const structured = await fetchText(structuredUrl);
  if (structured) {
    const vacancies = parseStructuredFeed(structured.text, organisationName);
    if (vacancies.length > 0) {
      return {
        sourceUrl: structuredUrl,
        vacancies,
        structuredFeedWorked: true,
        resultsRequestSucceeded: true,
      };
    }
  }

  const html = await fetchText(resultsUrl);
  return {
    sourceUrl: resultsUrl,
    vacancies: html ? parseNhsJobsHtml(html.text, organisationName) : [],
    structuredFeedWorked: false,
    resultsRequestSucceeded: html !== null,
  };
}