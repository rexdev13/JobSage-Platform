import { employerNamesCloselyMatch } from "./nhsJobsClient";
import { canonicalVacancyUrl } from "./vacancySource";
import { isValidJobBoardVacancyDeepLink } from "./vacancyUrlPolicy";

const REED_BASE_URL = "https://www.reed.co.uk";
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_RESULTS = 8;
const POLITE_REQUEST_DELAY_MS = 350;

export interface ReedVacancy {
  title: string;
  location: string | null;
  salary: string | null;
  url: string;
  description: null;
  postedDate: string | null;
  targetRegions: null;
  sourceType: "job_board";
  boardName: "Reed";
  externalListingId: string;
}

export interface ReedSearchResult {
  vacancies: ReedVacancy[];
  sourceUrl: string;
  requestSucceeded: boolean;
  transientFailure: boolean;
}

function decodeHtml(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&pound;/gi, "£")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tagByQa(card: string, qa: string): string | null {
  const match = card.match(
    new RegExp(`<([a-z0-9]+)\\b[^>]*data-qa=["']${qa}["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i"),
  );
  return match?.[0] ?? null;
}

export function parseReedJobsHtml(html: string, organisationName: string): ReedVacancy[] {
  const cards = html
    .split(/<article\b/i)
    .slice(1)
    .map((chunk) => `<article${chunk.split(/<\/article>/i)[0] ?? ""}</article>`)
    .filter((card) => /data-qa=["']job-card["']/i.test(card));

  const vacancies: ReedVacancy[] = [];
  for (const card of cards) {
    const titleTag = tagByQa(card, "job-card-title");
    const employerTag = tagByQa(card, "company-name-link");
    if (!titleTag || !employerTag) continue;

    const title = decodeHtml(titleTag);
    const employer = decodeHtml(employerTag);
    if (!title || !employerNamesCloselyMatch(organisationName, employer)) continue;

    const href = titleTag.match(/\bhref=["']([^"']+)["']/i)?.[1]?.replace(/&amp;/gi, "&");
    const externalListingId =
      card.match(/data-id=["']job(\d+)["']/i)?.[1] ??
      titleTag.match(/\bdata-id=["'](\d+)["']/i)?.[1];
    if (!href || !externalListingId) continue;

    const rawUrl = new URL(href, REED_BASE_URL).toString();
    const url = canonicalVacancyUrl(rawUrl);
    if (!url || !isValidJobBoardVacancyDeepLink(url)) continue;

    const postedBy = tagByQa(card, "job-posted-by");
    const postedDate = postedBy
      ? decodeHtml(postedBy).replace(/\s+by\s+[\s\S]*$/i, "").trim() || null
      : null;
    vacancies.push({
      title,
      location: decodeHtml(tagByQa(card, "job-metadata-location") ?? "") || null,
      salary: decodeHtml(tagByQa(card, "job-metadata-salary") ?? "") || null,
      url,
      description: null,
      postedDate,
      targetRegions: null,
      sourceType: "job_board",
      boardName: "Reed",
      externalListingId,
    });
    if (vacancies.length >= MAX_RESULTS) break;
  }
  return vacancies;
}

export async function searchReedJobs(organisationName: string): Promise<ReedSearchResult> {
  const sourceUrl = `${REED_BASE_URL}/jobs?keywords=${encodeURIComponent(organisationName)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    await new Promise((resolve) => setTimeout(resolve, POLITE_REQUEST_DELAY_MS));
    const response = await fetch(sourceUrl, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
        "User-Agent": "JOBSAGE vacancy discovery/1.0 (+https://jobsage.co.uk)",
      },
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.toLowerCase().includes("text/html")) {
      return {
        vacancies: [],
        sourceUrl,
        requestSucceeded: false,
        transientFailure: response.status === 403 || response.status === 429 || response.status >= 500,
      };
    }
    return {
      vacancies: parseReedJobsHtml(await response.text(), organisationName),
      sourceUrl,
      requestSucceeded: true,
      transientFailure: false,
    };
  } catch {
    return { vacancies: [], sourceUrl, requestSucceeded: false, transientFailure: true };
  } finally {
    clearTimeout(timeout);
  }
}