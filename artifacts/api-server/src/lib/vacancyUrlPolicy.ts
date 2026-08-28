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
  // ── Major generalist job boards ─────────────────────────────────────────────
  "indeed.com",
  "reed.co.uk",
  "linkedin.com",
  "lnkd.in",            // LinkedIn's link shortener
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
  "simplyhired.com",
  "simplyhired.co.uk",
  "bebee.com",
  "jooble.org",
  "talent.com",
  "ziprecruiter.com",
  "ziprecruiter.co.uk",
  "careerjet.co.uk",
  "jobijoba.com",
  "jobijoba.co.uk",
  // ── Search engines ──────────────────────────────────────────────────────────
  "google.com",
  "bing.com",
  "yahoo.com",
  // ── International aggregators ────────────────────────────────────────────────
  "seek.com",
  "jora.com",
  "grabjobs.co",
  "jobleads.com",
  "builtin.com",
  "startup.jobs",
  "weekday.works",       // catches jobs.weekday.works
  // ── Hospitality / gig / classified boards ────────────────────────────────────
  "harri.com",
  "jobtoday.com",
  "gumtree.com",
  // ── Education job boards ─────────────────────────────────────────────────────
  "tes.com",            // Times Educational Supplement job board
  "eteach.com",
  "mynewterm.com",
  "teaching-vacancies.service.gov.uk",  // DfE teaching-jobs board
  // ── IT / tech niche boards ──────────────────────────────────────────────────
  "itjobboard.co.uk",
  // ── Aggregator-ATS hybrids ──────────────────────────────────────────────────
  "studysmarter.co.uk", // catches talents.studysmarter.co.uk
  "careers-page.com",   // generic ATS aggregator
  "employmenthero.com",
  // ── NHS note (intentionally excluded) ───────────────────────────────────────
  // jobs.nhs.uk / nhsjobs — NHS trusts only accept applications via NHS Jobs or
  // Trac; login is an accepted constraint of the UK NHS system, not a reason to
  // null the link. Do NOT add those domains here.
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
 * Returns the matching blocklist entry (root domain) if the URL is blocked,
 * or null if it is not blocked. Used by cleanup scripts to group purges by domain.
 */
export function getBlockedVacancyDomain(url: string): string | null {
  try {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase();
    return (
      BLOCKED_VACANCY_DOMAINS.find(
        (domain) => host === domain || host.endsWith(`.${domain}`),
      ) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * URL shortener domains whose destination cannot be determined without a
 * live HTTP request. Rows matching these are flagged for manual review rather
 * than silently purged.
 */
export const SHORTENER_DOMAINS = [
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "ow.ly",
  "buff.ly",
  "short.io",
  "rb.gy",
  "cutt.ly",
] as const;

export function isShortenerUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    const host = hostname.toLowerCase();
    return SHORTENER_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
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
  "/work-for-us",
  "/work-with-us",
  "/join-us",
  "/apply",
  "/recruitment",
  "/all-jobs",
  "/open-positions",
  "/current-vacancies",
  "/job-vacancies",
]);

/**
 * Generic path slugs that indicate a careers-section landing page even when
 * nested under other path segments (e.g. /about-us/careers, /pages/jobs,
 * /fr/careers, /careers.html). Compared against the final path segment with
 * any file extension stripped.
 */
const GENERIC_TERMINAL_SLUGS = new Set([
  "careers",
  "career",
  "jobs",
  "vacancies",
  "recruitment",
  "apply",
  "work-for-us",
  "join-us",
  "work-with-us",
  "all-jobs",
  "open-positions",
  "current-vacancies",
  "job-vacancies",
  "job-portal",
  "search-jobs",
  "search_jobs",
]);

/**
 * True when the URL is a usable deep-link to a specific job advert:
 * - parses as http(s)
 * - hostname is not a blocked aggregator domain
 * - pathname is not a generic careers/homepage path and is at least 8 chars
 * - final path segment is not a known generic landing-page slug
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

  // Reject if the terminal path segment (minus any file extension) is a
  // known generic slug — catches /about-us/careers, /pages/jobs, careers.html
  const segments = normalised.split("/");
  const lastSegment = (segments[segments.length - 1] ?? "").replace(/\.[a-z0-9]+$/i, "");
  if (GENERIC_TERMINAL_SLUGS.has(lastSegment)) {
    return false;
  }

  return true;
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Job-board mode permits only exact advert URLs on explicitly supported boards.
 * Search, employer-profile, category and home pages remain invalid.
 */
export function isValidJobBoardVacancyDeepLink(url: string | null | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname.replace(/\/+$/, "") || "/";

  if (hostMatches(host, "jobs.nhs.uk")) {
    return /^\/candidate\/jobadvert\/[^/?#]+$/i.test(path);
  }
  if (hostMatches(host, "trac.jobs")) {
    return /^\/job-advert\/[^/?#]+$/i.test(path);
  }
  if (hostMatches(host, "healthjobsuk.com")) {
    return /^\/job\/[^?#]+$/i.test(path);
  }
  if (hostMatches(host, "reed.co.uk")) {
    return /^\/jobs\/[^/?#]+\/\d+$/i.test(path);
  }
  if (hostMatches(host, "indeed.com")) {
    return /^\/viewjob$/i.test(path) && /^[a-z0-9]+$/i.test(parsed.searchParams.get("jk") ?? "");
  }
  if (hostMatches(host, "cv-library.co.uk")) {
    return /^\/job\/\d+(?:\/[^/?#]+)?$/i.test(path);
  }
  if (hostMatches(host, "totaljobs.com")) {
    return /^\/job\/[^/?#]+\/[^/?#]+$/i.test(path);
  }
  return false;
}

export function isValidVacancyUrlForSource(
  url: string | null | undefined,
  sourceType: "job_board" | "company_site" | null | undefined,
): boolean {
  return sourceType === "job_board"
    ? isValidJobBoardVacancyDeepLink(url)
    : sourceType === "company_site"
      ? isValidVacancyDeepLink(url)
      : false;
}
