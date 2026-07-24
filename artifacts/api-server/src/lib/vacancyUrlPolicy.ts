/**
 * Single source of truth for vacancy/apply URL policy.
 *
 * Both the vacancy ingestion pipeline (vacancyCheckHelper), the AI apply-URL
 * backfill (applyUrlBackfill), and the outbound apply redirect
 * (GET /applications/track-outbound) consume this module so blocklist and
 * deep-link rules can never diverge.
 */

/**
 * Aggregator/search domains that are never acceptable as a vacancy or apply
 * URL. Suffix-based matching catches subdomains (e.g. uk.indeed.com).
 */
export const BLOCKED_VACANCY_DOMAINS = [
  "indeed.com",
  "reed.co.uk",
  "linkedin.com",
  "cv-library.co.uk",
  "totaljobs.com",
  "glassdoor.com",
  "glassdoor.co.uk",
  "monster.co.uk",
  "monster.com",
  "jobsite.co.uk",
  "fish4.co.uk",
  "cwjobs.co.uk",
  "adzuna.co.uk",
  "adzuna.com",
  "google.com",
  "bing.com",
  "yahoo.com",
  "seek.com",
  "jora.com",
  "careerjet.co.uk",
  "jobs.nhs.uk", // aggregator for NHS — allow only direct employer domains
  "jobijoba.com",
  "jobijoba.co.uk",
  "simplyhired.com",
  "simplyhired.co.uk",
  "bebee.com",
  "jooble.org",
  "talent.com",
  "ziprecruiter.com",
  "ziprecruiter.co.uk",
] as const;

/** @deprecated alias kept for existing imports — same list. */
export const BLOCKED_APPLY_DOMAINS = BLOCKED_VACANCY_DOMAINS;

export function isBlockedVacancyUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase();
    return BLOCKED_VACANCY_DOMAINS.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}

/**
 * Generic paths that indicate a careers landing page or homepage rather than
 * a deep-link to a specific job advert. Compared against the lowercased
 * pathname with any trailing slash stripped.
 */
const GENERIC_PATHS = new Set([
  "",
  "/",
  "/careers",
  "/career",
  "/jobs",
  "/vacancies",
  "/search",
]);

/**
 * True when the URL is a usable deep-link to a specific job advert:
 * - parses as http(s)
 * - hostname is not a blocked aggregator domain
 * - pathname is not a generic careers/homepage path and is at least 8 chars
 */
export function isValidVacancyDeepLink(url: string | null | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (isBlockedVacancyUrl(url)) return false;

  const rawPath = parsed.pathname;
  const normalised = rawPath.toLowerCase().replace(/\/+$/, "") || "/";
  if (GENERIC_PATHS.has(normalised) || GENERIC_PATHS.has(rawPath.toLowerCase())) {
    return false;
  }
  if (rawPath.length < 8) return false;
  return true;
}
