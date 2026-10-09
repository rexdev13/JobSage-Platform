import { isValidVacancyDeepLink } from "./vacancyUrlPolicy";
import { isManualLabourTitle } from "./vacancyTitlePolicy";
import { extractAdvertContactEmail } from "./publishedContactEmail";
import { extractVacancyClosingDate } from "./vacancyDates";

const NHS_JOBS_ORIGIN = "https://www.jobs.nhs.uk";
const REQUEST_TIMEOUT_MS = 8_000;
const USER_AGENT = "JOBSAGE vacancy discovery/1.0 (+https://jobsage.co.uk)";
const MAX_VACANCIES_PER_EMPLOYER = 8;
const MAX_EXTRA_HTML_PAGES = 3;
export const MAX_CANDIDATE_HTML_PAGES = 30;
export const NHS_HTML_PAGE_DELAY_MS = 250;

export type NhsJobsVacancy = {
  title: string;
  location: string | null;
  salary: string | null;
  url: string;
  description: null;
  postedDate: string | null;
  targetRegions: null;
  contactEmail: string | null;
  contactEvidenceUrl: string | null;
  closesAt?: Date | null;
};

export type NhsJobsCandidateVacancy = NhsJobsVacancy & {
  employer: string;
};

export type NhsJobsSearchResult = {
  sourceUrl: string;
  vacancies: NhsJobsVacancy[];
  structuredFeedWorked: boolean;
  /** False only when the public HTML results request did not complete. */
  resultsRequestSucceeded: boolean;
  /** True when a timeout, 429, or HTTP error interrupted discovery. */
  transientFailure?: boolean;
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
  "group", "medical", "centre", "center", "practice", "clinic", "surgery", "college",
  "london", "community", "partnership",
]);

const EMPLOYER_ALIASES: Array<{ canonical: string[]; patterns: RegExp[] }> = [
  {
    canonical: ["guy", "thomas"],
    patterns: [/^gstt(?:nhs|foundation|trust)*$/, /guysandstthomas/, /guysstthomas/],
  },
  {
    canonical: ["south", "london", "maudsley"],
    patterns: [/^slam(?:nhs|foundation|trust)*$/, /southlondonandmaudsley/],
  },
  {
    canonical: ["central", "london", "community"],
    patterns: [/^clch(?:nhs|foundation|trust)*$/, /centrallondoncommunityhealthcare/],
  },
];

const SAFE_SINGLE_WORD_CANDIDATE_IDENTITIES = new Set(["inhealth", "optegra", "davita"]);

function compactEmployerName(value: string): string {
  return textFromHtml(value).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
}

function meaningfulWords(value: string): string[] {
  const compact = compactEmployerName(value);
  const alias = EMPLOYER_ALIASES.find((candidate) => candidate.patterns.some((pattern) => pattern.test(compact)));
  if (alias) return alias.canonical;

  return textFromHtml(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3 && !GENERIC_ORGANISATION_WORDS.has(word));
}

/**
 * Search results can include unrelated NHS employers. Require an exact normalised
 * name or enough distinctive sponsor-name words before retaining a vacancy.
 */
export function employerNamesCloselyMatch(organisationName: string, listedEmployer: string): boolean {
  const requestedCompact = compactEmployerName(organisationName);
  const listedCompact = compactEmployerName(listedEmployer);
  const requestedWords = meaningfulWords(organisationName);
  const listedWords = meaningfulWords(listedEmployer);
  const shorterWords = requestedWords.length <= listedWords.length ? requestedWords : listedWords;
  const longerWords = requestedWords.length <= listedWords.length ? listedWords : requestedWords;
  if (
    Math.min(requestedCompact.length, listedCompact.length) >= 10 &&
    shorterWords.length >= 2 &&
    shorterWords.every((word) => longerWords.includes(word)) &&
    (requestedCompact.includes(listedCompact) || listedCompact.includes(requestedCompact))
  ) {
    return true;
  }
  const requested = requestedWords;
  const listed = new Set(listedWords);
  if (requested.length === 0 || listed.size === 0) return false;

  const requestedNormalised = [...requested].sort().join(" ");
  const listedNormalised = [...listed].sort().join(" ");
  if (requestedNormalised === listedNormalised) return true;

  const shared = requested.filter((word) => listed.has(word));
  const smallerWordCount = Math.min(requested.length, listed.size);
  return smallerWordCount >= 2 && shared.length >= 2 && shared.length / smallerWordCount >= 0.75;
}

/**
 * Candidate-wide searches compare every NHS employer against the whole sponsor
 * register, so they must use a stricter rule than an employer-scoped search.
 */
export function candidateEmployerMatchesSponsor(
  organisationName: string,
  listedEmployer: string,
): boolean {
  const requestedWords = [...new Set(meaningfulWords(organisationName))];
  const listedWords = [...new Set(meaningfulWords(listedEmployer))];
  if (requestedWords.length === 0 || listedWords.length === 0) return false;
  const requestedNormalised = [...requestedWords].sort().join(" ");
  const listedNormalised = [...listedWords].sort().join(" ");
  if (
    requestedNormalised === listedNormalised &&
    (requestedWords.length >= 2 || SAFE_SINGLE_WORD_CANDIDATE_IDENTITIES.has(requestedNormalised))
  ) return true;

  const shorterWords = requestedWords.length <= listedWords.length ? requestedWords : listedWords;
  const longerWords = requestedWords.length <= listedWords.length ? listedWords : requestedWords;
  return (
    shorterWords.length >= 2 &&
    shorterWords.every((word) => longerWords.includes(word))
  );
}

export function parseNhsJobsCandidateHtml(html: string): NhsJobsCandidateVacancy[] {
  const resultBlocks = html.match(
    /<li\b(?=[^>]*data-test=["']search-result["'])[^>]*>([\s\S]*?)(?=<li\b(?=[^>]*data-test=["']search-result["'])|<\/ul>)/gi,
  ) ?? [];
  const vacancies: NhsJobsCandidateVacancy[] = [];
  const urls = new Set<string>();
  for (const block of resultBlocks) {
    const titleAndUrl = extractTitleAndUrl(block);
    if (!titleAndUrl || !allowedNhsAdvertUrl(titleAndUrl.url) || isManualLabourTitle(titleAndUrl.title)) continue;
    const { employer, location } = extractEmployerAndLocation(block);
    if (!employer || urls.has(titleAndUrl.url)) continue;
    urls.add(titleAndUrl.url);
    vacancies.push({
      title: titleAndUrl.title,
      employer,
      location,
      salary: stripFieldLabel(extractTagText(block, "search-result-salary"), "Salary"),
      url: titleAndUrl.url,
      description: null,
      postedDate: stripFieldLabel(extractTagText(block, "search-result-publicationDate"), "Date posted"),
      targetRegions: null,
      contactEmail: extractAdvertContactEmail(block, titleAndUrl.url),
      contactEvidenceUrl: titleAndUrl.url,
      ...(extractVacancyClosingDate(textFromHtml(block))
        ? { closesAt: extractVacancyClosingDate(textFromHtml(block)) }
        : {}),
    });
  }
  return vacancies;
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
      targetRegions: null,
      contactEmail: extractAdvertContactEmail(block, titleAndUrl.url),
      contactEvidenceUrl: titleAndUrl.url,
      ...(extractVacancyClosingDate(textFromHtml(block))
        ? { closesAt: extractVacancyClosingDate(textFromHtml(block)) }
        : {}),
    });
    if (vacancies.length >= MAX_VACANCIES_PER_EMPLOYER) break;
  }

  return vacancies;
}

type FetchTextResult =
  | { text: string; contentType: string; status: number }
  | { text: null; status: number | null; failure: true };

async function fetchText(url: string): Promise<FetchTextResult> {
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
    if (!response.ok) return { text: null, status: response.status, failure: true };
    return {
      text: await response.text(),
      contentType: response.headers.get("content-type") ?? "",
      status: response.status,
    };
  } catch (error) {
    return { text: null, status: null, failure: true };
  } finally {
    clearTimeout(timeout);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
      targetRegions: null,
      contactEmail: extractAdvertContactEmail(record, url),
      contactEvidenceUrl: url,
      ...(extractVacancyClosingDate(record)
        ? { closesAt: extractVacancyClosingDate(record) }
        : {}),
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
  if (structured.text !== null) {
    const vacancies = parseStructuredFeed(structured.text, organisationName);
    if (vacancies.length > 0) {
      return {
        sourceUrl: structuredUrl,
        vacancies,
        structuredFeedWorked: true,
        resultsRequestSucceeded: true,
        transientFailure: false,
      };
    }
  }

  const html = await fetchText(resultsUrl);
  if (html.text === null) {
    return {
      sourceUrl: resultsUrl,
      vacancies: [],
      structuredFeedWorked: false,
      resultsRequestSucceeded: false,
      transientFailure: true,
    };
  }

  const vacancies = parseNhsJobsHtml(html.text, organisationName);
  const urls = new Set(vacancies.map((vacancy) => vacancy.url));
  let interrupted = false;
  let page = 1;

  while (vacancies.length < MAX_VACANCIES_PER_EMPLOYER && page <= MAX_EXTRA_HTML_PAGES) {
    await wait(NHS_HTML_PAGE_DELAY_MS);
    page += 1;
    const pageParams = new URLSearchParams(resultsParams);
    pageParams.set("page", String(page));
    const nextPage = await fetchText(`${NHS_JOBS_ORIGIN}/candidate/search/results?${pageParams.toString()}`);
    if (nextPage.text === null) {
      interrupted = true;
      break;
    }

    for (const vacancy of parseNhsJobsHtml(nextPage.text, organisationName)) {
      if (urls.has(vacancy.url)) continue;
      urls.add(vacancy.url);
      vacancies.push(vacancy);
      if (vacancies.length >= MAX_VACANCIES_PER_EMPLOYER) break;
    }
  }

  return {
    sourceUrl: resultsUrl,
    vacancies,
    structuredFeedWorked: false,
    resultsRequestSucceeded: !interrupted,
    transientFailure: interrupted,
  };
}

export async function searchNhsJobsForCandidate(
  keywords: string,
  region: string | null,
  limit = 40,
): Promise<Omit<NhsJobsSearchResult, "vacancies"> & { vacancies: NhsJobsCandidateVacancy[] }> {
  const params = new URLSearchParams({ keyword: keywords, language: "en" });
  if (region) params.set("location", region);
  const sourceUrl = `${NHS_JOBS_ORIGIN}/candidate/search/results?${params.toString()}`;
  const vacancies: NhsJobsCandidateVacancy[] = [];
  const urls = new Set<string>();
  let interrupted = false;

  for (let page = 1; page <= MAX_CANDIDATE_HTML_PAGES && vacancies.length < limit; page++) {
    if (page > 1) await wait(NHS_HTML_PAGE_DELAY_MS);
    const pageParams = new URLSearchParams(params);
    if (page > 1) pageParams.set("page", String(page));
    const response = await fetchText(`${NHS_JOBS_ORIGIN}/candidate/search/results?${pageParams.toString()}`);
    if (response.text === null) {
      interrupted = true;
      break;
    }
    const countBeforePage = vacancies.length;
    for (const vacancy of parseNhsJobsCandidateHtml(response.text)) {
      if (urls.has(vacancy.url)) continue;
      urls.add(vacancy.url);
      vacancies.push(vacancy);
      if (vacancies.length >= limit) break;
    }
    // A repeated or exhausted results page cannot produce more candidates.
    // Stop here rather than spending the remaining polite-delay budget on
    // identical pages.
    if (vacancies.length === countBeforePage) break;
  }

  return {
    sourceUrl,
    vacancies,
    structuredFeedWorked: false,
    resultsRequestSucceeded: !interrupted,
    transientFailure: interrupted,
  };
}

/**
 * Build one indexed resolver for candidate-wide board searches. The previous
 * callers scanned the full sponsor register for every advert, which becomes
 * quadratic at live-register scale. Ambiguous matches remain rejected.
 */
export function createCandidateSponsorMatcher(
  organisationNames: readonly string[],
): (listedEmployer: string) => string | null {
  const uniqueNames = [...new Set(organisationNames.map((name) => name.trim()).filter(Boolean))];
  const exact = new Map<string, Set<string>>();
  const byWord = new Map<string, Set<string>>();
  for (const name of uniqueNames) {
    const words = [...new Set(meaningfulWords(name))];
    if (words.length === 0) continue;
    const key = [...words].sort().join(" ");
    const exactNames = exact.get(key) ?? new Set<string>();
    exactNames.add(name);
    exact.set(key, exactNames);
    for (const word of words) {
      const names = byWord.get(word) ?? new Set<string>();
      names.add(name);
      byWord.set(word, names);
    }
  }
  return (listedEmployer: string): string | null => {
    const words = [...new Set(meaningfulWords(listedEmployer))];
    if (words.length === 0) return null;
    const exactNames = exact.get([...words].sort().join(" "));
    if (exactNames?.size === 1) return [...exactNames][0]!;
    const candidateSets = words.map((word) => byWord.get(word)).filter((set): set is Set<string> => Boolean(set));
    if (candidateSets.length === 0) return null;
    const seed = candidateSets.sort((a, b) => a.size - b.size)[0]!;
    const matches = [...seed].filter((name) => candidateEmployerMatchesSponsor(name, listedEmployer));
    return matches.length === 1 ? matches[0]! : null;
  };
}
