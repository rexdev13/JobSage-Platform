import { canonicalVacancyUrl } from "./vacancySource";
import { isValidJobBoardVacancyDeepLink } from "./vacancyUrlPolicy";
import { extractVacancyClosingDate } from "./vacancyDates";

const ORIGIN = "https://www.jobs.ac.uk";
const REQUEST_TIMEOUT_MS = 12_000;
const PAGE_SIZE = 25;
const PAGE_DELAY_MS = 350;
const MAX_PAGES = 4;

export type JobsAcUkVacancy = {
  title: string;
  employer: string;
  location: string | null;
  salary: string | null;
  url: string;
  description: null;
  postedDate: string | null;
  targetRegions: null;
  sourceType: "job_board";
  boardName: "jobs.ac.uk";
  externalListingId: string;
  contactEmail: null;
  contactEvidenceUrl: string;
  closesAt?: Date | null;
};

export type JobsAcUkSearchResult = {
  vacancies: JobsAcUkVacancy[];
  sourceUrl: string;
  requestSucceeded: boolean;
  transientFailure: boolean;
  status: number | null;
};

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&(amp|quot|apos|lt|gt|nbsp|#39);/gi, (_, entity: string) => {
      const values: Record<string, string> = {
        amp: "&", quot: "\"", apos: "'", lt: "<", gt: ">", nbsp: " ", "#39": "'",
      };
      return values[entity.toLowerCase()] ?? "";
    });
}

function textFromHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function classText(block: string, className: string): string | null {
  const match = block.match(
    new RegExp(`<[^>]+class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i"),
  );
  return match ? textFromHtml(match[1] ?? "") || null : null;
}

function labelledText(block: string, label: string): string | null {
  const match = block.match(
    new RegExp(`<strong[^>]*>\\s*${label}:?\\s*<\\/strong>([\\s\\S]*?)<\\/div>`, "i"),
  );
  return match ? textFromHtml(match[1] ?? "") || null : null;
}

export function parseJobsAcUkHtml(html: string): JobsAcUkVacancy[] {
  const blocks = html.match(
    /<div\b(?=[^>]*class=["'][^"']*j-search-result__result\b[^"']*["'])[^>]*>[\s\S]*?(?=<div\b(?=[^>]*class=["'][^"']*j-search-result__result\b[^"']*["'])|<nav\b|$)/gi,
  ) ?? [];
  const vacancies: JobsAcUkVacancy[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const link = block.match(/<a\b[^>]*href=["'](\/job\/([A-Z0-9]+)\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const employer = classText(block, "j-search-result__employer");
    if (!link || !employer) continue;
    const title = textFromHtml(link[3] ?? "");
    const url = canonicalVacancyUrl(new URL(decodeHtml(link[1] ?? ""), ORIGIN).toString());
    if (!title || !url || seen.has(url) || !isValidJobBoardVacancyDeepLink(url)) continue;
    seen.add(url);
    const location = block.match(/<div>\s*Location:\s*([\s\S]*?)<\/div>/i);
    const closesAt = extractVacancyClosingDate(textFromHtml(block));
    vacancies.push({
      title,
      employer,
      location: location ? textFromHtml(location[1] ?? "") || null : null,
      salary: labelledText(block, "Salary"),
      url,
      description: null,
      postedDate: labelledText(block, "Date Placed"),
      targetRegions: null,
      sourceType: "job_board",
      boardName: "jobs.ac.uk",
      externalListingId: link[2] ?? "",
      contactEmail: null,
      contactEvidenceUrl: url,
      ...(closesAt ? { closesAt } : {}),
    });
  }
  return vacancies;
}

async function fetchPage(url: string): Promise<{ html: string | null; status: number | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
        "User-Agent": "JOBSAGE vacancy discovery/1.0 (+https://jobsage.co.uk)",
      },
    });
    const type = response.headers.get("content-type") ?? "";
    return response.ok && type.toLowerCase().includes("text/html")
      ? { html: await response.text(), status: response.status }
      : { html: null, status: response.status };
  } catch {
    return { html: null, status: null };
  } finally {
    clearTimeout(timeout);
  }
}

export async function searchJobsAcUk(
  keywords: string,
  limit = 40,
): Promise<JobsAcUkSearchResult> {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const vacancies: JobsAcUkVacancy[] = [];
  const seen = new Set<string>();
  const baseParams = new URLSearchParams({
    keywords,
    sortOrder: "1",
    pageSize: String(PAGE_SIZE),
  });
  const sourceUrl = `${ORIGIN}/search/?${baseParams.toString()}`;

  for (let page = 0; page < MAX_PAGES && vacancies.length < boundedLimit; page++) {
    if (page > 0) await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    const params = new URLSearchParams(baseParams);
    params.set("startIndex", String(page * PAGE_SIZE + 1));
    const pageUrl = `${ORIGIN}/search/?${params.toString()}`;
    const response = await fetchPage(pageUrl);
    if (response.html === null) {
      return {
        vacancies,
        sourceUrl,
        requestSucceeded: false,
        transientFailure: response.status === null ||
          response.status === 403 ||
          response.status === 429 ||
          response.status >= 500,
        status: response.status,
      };
    }
    let added = 0;
    for (const vacancy of parseJobsAcUkHtml(response.html)) {
      if (seen.has(vacancy.url)) continue;
      seen.add(vacancy.url);
      vacancies.push(vacancy);
      added++;
      if (vacancies.length >= boundedLimit) break;
    }
    if (added === 0) break;
  }
  return {
    vacancies,
    sourceUrl,
    requestSucceeded: true,
    transientFailure: false,
    status: 200,
  };
}