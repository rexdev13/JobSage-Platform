import { canonicalVacancyUrl } from "./vacancySource";
import { isValidJobBoardVacancyDeepLink } from "./vacancyUrlPolicy";
import { extractVacancyClosingDate } from "./vacancyDates";

const ORIGIN = "https://teaching-vacancies.service.gov.uk";
const REQUEST_TIMEOUT_MS = 12_000;
const PAGE_DELAY_MS = 350;
const MAX_PAGES = 5;

export type TeachingVacancy = {
  title: string;
  employer: string;
  location: string | null;
  salary: string | null;
  url: string;
  description: string | null;
  postedDate: null;
  targetRegions: null;
  sourceType: "job_board";
  boardName: "Teaching Vacancies";
  externalListingId: string;
  contactEmail: null;
  contactEvidenceUrl: string;
  closesAt?: Date | null;
};

export type TeachingVacanciesSearchResult = {
  vacancies: TeachingVacancy[];
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

function summaryValue(block: string, label: string): string | null {
  const match = block.match(
    new RegExp(`<dt[^>]*>\\s*${label}\\s*<\\/dt>\\s*<dd[^>]*>([\\s\\S]*?)<\\/dd>`, "i"),
  );
  return match ? textFromHtml(match[1] ?? "") || null : null;
}

export function parseTeachingVacanciesHtml(html: string): TeachingVacancy[] {
  const blocks = html.match(
    /<div\b[^>]*class=["'][^"']*search-results__item[^"']*["'][^>]*>[\s\S]*?(?=<div\b[^>]*class=["'][^"']*search-results__item[^"']*["']|<nav\b|$)/gi,
  ) ?? [];
  const vacancies: TeachingVacancy[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const link = block.match(
      /<a\b(?=[^>]*class=["'][^"']*view-vacancy-link[^"']*["'])[^>]*href=["'](\/jobs\/([^"'?#]+))["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    const address = block.match(/<p\b[^>]*class=["'][^"']*\baddress\b[^"']*["'][^>]*>([\s\S]*?)<\/p>/i);
    if (!link || !address) continue;
    const title = textFromHtml(link[3] ?? "");
    const addressText = textFromHtml(address[1] ?? "");
    const employer = addressText.split(",")[0]?.trim() ?? "";
    const url = canonicalVacancyUrl(new URL(link[1] ?? "", ORIGIN).toString());
    if (!title || !employer || !url || seen.has(url) || !isValidJobBoardVacancyDeepLink(url)) continue;
    seen.add(url);
    const closingText = summaryValue(block, "Closing date");
    const visaText = summaryValue(block, "Visa sponsorship");
    const closesAt = extractVacancyClosingDate(closingText);
    vacancies.push({
      title,
      employer,
      location: addressText.slice(employer.length).replace(/^,\s*/, "") || null,
      salary: summaryValue(block, "Full time equivalent salary"),
      url,
      description: visaText,
      postedDate: null,
      targetRegions: null,
      sourceType: "job_board",
      boardName: "Teaching Vacancies",
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

export async function searchTeachingVacancies(
  keywords: string,
  limit = 40,
): Promise<TeachingVacanciesSearchResult> {
  const boundedLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const vacancies: TeachingVacancy[] = [];
  const seen = new Set<string>();
  const sourceParams = new URLSearchParams({ query: keywords });
  const sourceUrl = `${ORIGIN}/jobs?${sourceParams.toString()}`;

  for (let page = 1; page <= MAX_PAGES && vacancies.length < boundedLimit; page++) {
    if (page > 1) await new Promise((resolve) => setTimeout(resolve, PAGE_DELAY_MS));
    const params = new URLSearchParams(sourceParams);
    params.set("page", String(page));
    const response = await fetchPage(`${ORIGIN}/jobs?${params.toString()}`);
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
    for (const vacancy of parseTeachingVacanciesHtml(response.html)) {
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