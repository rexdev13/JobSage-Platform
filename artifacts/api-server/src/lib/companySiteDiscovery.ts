import { canonicalVacancyUrl } from "./vacancySource";
import {
  isBlockedVacancyUrl,
  isNonVacancyCareerUtilityUrl,
  isValidVacancyDeepLink,
} from "./vacancyUrlPolicy";
import {
  type BoardAdvert,
  normaliseAndDedupeBoardAdverts,
  upsertSharedBoardVacancies,
} from "./boardVacancyPipeline";
import {
  COMPANY_SITE_EMPLOYER_BUDGET_MS,
  classifyCompanySiteFailure,
  fetchCompanySitePage,
  isAllowedCompanyDestination,
  knownAtsProvider,
  type CompanySiteFailureClass,
} from "./companySiteHttp";
import { extractAdvertContactEmail } from "./publishedContactEmail";
import { parseVacancyClosingDate } from "./vacancyDates";
import { isLikelyEditorialTitle } from "./vacancyTitlePolicy";
import { fetchDirectEmployerBoard, parseDirectBoardMapping } from "./directEmployerBoardConnectors";

export const MAX_COMPANY_SITE_DISCOVERY_PAGES = 6;
// The crawl remains bounded by pages, response bytes, host pacing and the
// employer deadline. Do not silently discard valid jobs after extraction.
export const MAX_COMPANY_SITE_VACANCIES_PER_EMPLOYER = Number.POSITIVE_INFINITY;
const MAX_RESUMABLE_CRAWL_URLS = 100;

const CAREERS_SIGNAL =
  /\b(?:careers?|jobs?|vacanc(?:y|ies)|join us|join (?:our|the) team|work (?:for|with) us|recruitment|current openings?|opportunities|hiring|apprenticeships?|volunteers?|get involved)\b/i;
const VACANCY_SIGNAL =
  /\b(jobs?|vacanc(?:y|ies)|positions?|roles?|opportunit(?:y|ies)|openings?|apply)\b/i;
const POSTING_PATH_SEGMENT =
  /^(?:jobs?|vacanc(?:y|ies)|positions?|roles?|opportunit(?:y|ies)|openings?|requisitions?|job[-_]?(?:advert|posting|opening)|current[-_]vacanc(?:y|ies)|open[-_]positions|all[-_]jobs)$/i;
const SPECIFIC_JOB_ID_QUERY_KEYS = new Set([
  "jobid",
  "job",
  "jobreqid",
  "reqid",
  "requisitionid",
  "postingid",
  "vacancyid",
]);
const NAVIGATION_MARKER =
  /(?:^|[\s"'_-])(?:nav|navigation|menu|subnav|sub-menu|submenu|tabs?|tablist|breadcrumb)(?:$|[\s"'_-])/i;
const ACCESSIBILITY_NAV_ANCHOR_TEXT =
  /^(?:skip(?:\s+to)?\s+(?:main\s+)?content|skip\s+navigation|jump\s+to\s+(?:main\s+)?content|go\s+to\s+(?:main\s+)?content)$/i;
const GENERIC_ANCHOR_TEXT =
  /^(?:apply|apply now|view|view job|view vacancy|details|more|read more|learn more|job details|skip(?:\s+to)?\s+(?:main\s+)?content|skip\s+navigation|jump\s+to\s+(?:main\s+)?content|go\s+to\s+(?:main\s+)?content)$/i;
const NON_SPECIFIC_BAMBOOHR_TITLE =
  /^(?:join\s+(?:our|the)\s+)?(?:talent\s+pool|team)$/i;
const NEGATIVE_CONTENT_PATH = /\/(?:news|blog|press|media|about|insights)(?:\/|$)/i;
const CAREER_CONTENT_TOPIC =
  /\b(?:our culture|workplace culture|our values|our benefits|our team|our people|meet (?:our|the) team|employee stories|life at|working here|talent community|talent pool|register (?:your )?interest|diversity and inclusion)\b/i;
const CAREER_RECRUITMENT_CONTEXT =
  /\b(?:job|vacanc(?:y|ies)|role|position|hiring|recruit(?:ment|er)|apply|current openings?|open roles?)\b/i;
const CAREER_LISTING_HEADING =
  /\b(?:current|open|available|search|browse)\s+(?:jobs?|vacanc(?:y|ies)|positions?|roles?|openings?)\b|\b(?:we(?:'re| are) hiring|job openings|no current vacancies)\b/i;
const CAREER_LISTING_PATH =
  /\/(?:careers?|jobs?|vacanc(?:y|ies)|current-vacanc(?:y|ies)|open-positions|job-openings|positions?|roles?|employment|opportunities|openings?|all-jobs)(?:\.html?)?\/?$/i;
const CAREER_LISTING_LINK_TEXT =
  /^\s*(?:(?:current|open|available|all|view|browse|search)\s+)?(?:(?:job|career|employment)\s+)?(?:careers?|jobs?|vacanc(?:y|ies)|positions?|roles?|opportunities|openings?)(?:\s+(?:at|with)\s+[\w\s&'’.-]{1,50})?\s*$/i;
const PAGINATION_SIGNAL = /\b(next|more jobs|older jobs|page\s*\d+)\b/i;
const SITEMAP_SIGNAL = /(?:^|\/)[^/]*sitemap[^/]*\.xml(?:$|\?)/i;
const SITEMAP_LOC_PATTERN = /<loc\b[^>]*>\s*([\s\S]*?)\s*<\/loc>/gi;
const SITEMAP_EXCLUDED_PATH =
  /\/(?:products?|blog|news|press|media|galleries?|shop|events?)(?:\/|$)/i;
const MAX_DIAGNOSTIC_LINKS = 80;
const MAX_SITEMAP_CHILDREN_PER_EMPLOYER = 4;
const MAX_SITEMAP_URLS_PER_DOCUMENT = 25;
const DIRECT_IMPORT_ATS_PROVIDERS = new Set([
  "Ashby", "Greenhouse", "Lever", "SmartRecruiters", "Recruitee", "Personio",
]);
// Site-hosted Recruitee/Personio feeds can be imported, but their response does
// not prove an exhaustive inventory. Never retire older roles from those feeds.
const AUTHORITATIVE_SNAPSHOT_PROVIDERS = new Set([
  "Ashby", "Greenhouse", "Lever", "SmartRecruiters",
  "Workday",
]);
const COMMON_CAREERS_PATHS = ["/careers", "/jobs", "/vacancies", "/join-us", "/work-with-us"] as const;
const ATS_PLATFORM_HOSTS: Array<{ provider: string; suffixes: string[] }> = [
  { provider: "Workday", suffixes: ["myworkdayjobs.com", "myworkdaysite.com"] },
  { provider: "Oracle Recruiting", suffixes: ["oraclecloud.com"] },
  { provider: "Teamtailor", suffixes: ["teamtailor.com"] },
  { provider: "BambooHR", suffixes: ["bamboohr.com"] },
  { provider: "iCIMS", suffixes: ["icims.com"] },
  { provider: "Pinpoint", suffixes: ["pinpointhq.com"] },
  { provider: "SmartRecruiters", suffixes: ["smartrecruiters.com"] },
  { provider: "Workable", suffixes: ["workable.com"] },
  { provider: "Personio", suffixes: ["personio.com"] },
  { provider: "Recruitee", suffixes: ["recruitee.com"] },
];

type ExtractedLink = {
  url: string;
  text: string;
  atsProvider: string | null;
  contextText: string;
  inNavigation: boolean;
  diagnostic?: CompanySiteLinkDiagnostic;
};

export type CompanySiteFetchDiagnostic = {
  url: string;
  fetchedUrl: string | null;
  status: number | null;
  fetched: boolean;
  failureKind: string | null;
  reason: string | null;
};

export type CompanySiteLinkDiagnostic = {
  url: string;
  sourceUrl: string;
  text: string;
  category: "careers" | "vacancy" | "ats";
  decision: "queued" | "vacancy_evidence" | "rejected" | "not_followed";
  reason: string | null;
  atsProvider: string | null;
};

export type CompanySiteAtsDiagnostic = {
  provider: string;
  url: string;
  sourceUrl: string;
  supportedForImport: boolean;
  linkedFromFirstParty: boolean;
  followed: boolean;
  reason: string | null;
};

export type CompanySiteDiscoveryDiagnostics = {
  homepageUrl: string;
  homepageFetched: boolean;
  homepageHttpStatus: number | null;
  careersPageFound: boolean;
  careersUrl: string | null;
  careersHttpStatus: number | null;
  careersFailureKind: string | null;
  pagesCrawled: number;
  pagesAttempted: number;
  sitemapChecked: boolean;
  sitemapDocuments: string[];
  robotsResult: string;
  pageFetches: CompanySiteFetchDiagnostic[];
  linksConsidered: CompanySiteLinkDiagnostic[];
  rejectedCareersLinks: CompanySiteLinkDiagnostic[];
  atsLinksSeen: CompanySiteAtsDiagnostic[];
  jsonLdJobPostingFound: boolean;
  microdataJobPostingFound: boolean;
  vacancyLikePages: string[];
  explicitNoVacancies: boolean;
  jsRenderedJobsLikely: boolean;
  directFeedsOnly?: boolean;
  directSourceKind?: "ats_feed" | "schema_org" | null;
  directFeedSkipReason?: string | null;
  directFeedSkipDetail?: string | null;
};

export type CompanySiteDiscoveryResult = {
  adverts: BoardAdvert[];
  sourceUrl: string;
  careersUrl: string | null;
  atsProvider: string | null;
  atsMappingVerified?: boolean;
  atsMappingEvidenceUrl?: string | null;
  genericCompleted: boolean;
  atsCompleted: boolean;
  transientFailure: boolean;
  failureClass: CompanySiteFailureClass | null;
  retryAt?: Date;
  error?: string;
  pagesFetched: number;
  completion: "complete" | "partial_page_limit" | "partial_deadline" | "failed";
  pagesAttempted: number;
  advertsExtracted: number;
  advertsRejected: number;
  rejectionReasons: Record<string, number>;
  discoveredUrls: string[];
  observedAdvertUrls: string[];
  /** Only a complete, trusted direct-feed snapshot can retire missing postings in its own board. */
  snapshotScope?: { provider: string; boardId: string };
  resumeState: CompanySiteDiscoveryOptions["resumeState"];
  diagnostics: CompanySiteDiscoveryDiagnostics;
};

export type CompanySiteDiscoveryOptions = {
  knownCareersUrl?: string | null;
  knownAtsBoardId?: string | null;
  knownCareersMappingVerified?: boolean;
  knownCareersEvidenceUrl?: string | null;
  checkGeneric?: boolean;
  checkAts?: boolean;
  directFeedsOnly?: boolean;
  now?: () => number;
  deadlineMs?: number;
  resumeState?: {
    queue: string[];
    visited: string[];
    sitemapQueued?: boolean;
    careersUrl?: string | null;
    atsProvider?: string | null;
  } | null;
};

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&(amp|quot|apos|lt|gt|nbsp|#39);/gi, (_, entity: string) => {
      const entities: Record<string, string> = {
        amp: "&",
        quot: "\"",
        apos: "'",
        lt: "<",
        gt: ">",
        nbsp: " ",
        "#39": "'",
      };
      return entities[entity.toLowerCase()] ?? "";
    });
}

function textFromHtml(value: string): string {
  return decodeHtml(
    value
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function enclosingTagContext(
  html: string,
  anchorStart: number,
  anchorEnd: number,
  tag: string,
): { start: number; end: number; tag: string; openTag: string } | null {
  const windowStart = Math.max(0, anchorStart - 6_000);
  const prefix = html.slice(windowStart, anchorStart);
  const openPattern = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const closePattern = new RegExp(`</${tag}\\s*>`, "gi");
  const opens = [...prefix.matchAll(openPattern)];
  const closes = [...prefix.matchAll(closePattern)];
  const opening = opens.at(-1);
  if (!opening || (closes.at(-1)?.index ?? -1) > (opening.index ?? -1)) return null;

  const start = windowStart + (opening.index ?? 0);
  const tail = html.slice(anchorEnd, Math.min(html.length, anchorEnd + 4_000));
  const tokenPattern = new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi");
  let depth = 1;
  for (const token of tail.matchAll(tokenPattern)) {
    const raw = token[0] ?? "";
    if (/^<\//.test(raw)) depth -= 1;
    else if (!/\/>$/.test(raw)) depth += 1;
    if (depth === 0) {
      return {
        start,
        end: anchorEnd + (token.index ?? 0) + raw.length,
        tag,
        openTag: opening[0] ?? "",
      };
    }
  }
  return null;
}

function anchorContext(
  html: string,
  anchorStart: number,
  anchorEnd: number,
): { text: string; inNavigation: boolean } {
  const contexts = ["li", "article", "section", "nav", "header", "footer", "div"]
    .map((tag) => enclosingTagContext(html, anchorStart, anchorEnd, tag))
    .filter((context): context is {
      start: number;
      end: number;
      tag: string;
      openTag: string;
    } => context !== null)
    .filter((context) => context.end - context.start <= 4_000)
    .sort((a, b) => a.end - a.start - (b.end - b.start));
  const best = contexts[0];
  const start = best?.start ?? Math.max(0, anchorStart - 240);
  const end = best?.end ?? Math.min(html.length, anchorEnd + 240);
  const navigationTags = ["nav", "header", "footer"];
  return {
    text: textFromHtml(html.slice(start, end)).slice(0, 1_200),
    inNavigation: contexts.some((context) =>
      navigationTags.includes(context.tag) || NAVIGATION_MARKER.test(context.openTag),
    ),
  };
}

function pageHeadingText(html: string): string {
  const headings = [...html.matchAll(/<(title|h1)\b[^>]*>([\s\S]*?)<\/\1>/gi)]
    .slice(0, 4)
    .map((match) => textFromHtml(match[2] ?? ""))
    .filter(Boolean);
  return headings.join(" ");
}

function detectedAtsProvider(value: string): string | null {
  const known = knownAtsProvider(value);
  if (known) return known;
  let hostname = value;
  try {
    hostname = new URL(value).hostname;
  } catch {
    // The caller may have supplied a hostname.
  }
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return ATS_PLATFORM_HOSTS.find(({ suffixes }) =>
    suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`)),
  )?.provider ?? null;
}

function emptyDiscoveryDiagnostics(homepageUrl: string): CompanySiteDiscoveryDiagnostics {
  return {
    homepageUrl,
    homepageFetched: false,
    homepageHttpStatus: null,
    careersPageFound: false,
    careersUrl: null,
    careersHttpStatus: null,
    careersFailureKind: null,
    pagesCrawled: 0,
    pagesAttempted: 0,
    sitemapChecked: false,
    sitemapDocuments: [],
    robotsResult: "not checked",
    pageFetches: [],
    linksConsidered: [],
    rejectedCareersLinks: [],
    atsLinksSeen: [],
    jsonLdJobPostingFound: false,
    microdataJobPostingFound: false,
    vacancyLikePages: [],
    explicitNoVacancies: false,
    jsRenderedJobsLikely: false,
  };
}

function addAtsDiagnostic(
  diagnostics: CompanySiteDiscoveryDiagnostics,
  provider: string,
  url: string,
  sourceUrl: string,
  linkedFromFirstParty: boolean,
  followed: boolean,
  reason: string | null,
): CompanySiteAtsDiagnostic {
  const existing = diagnostics.atsLinksSeen.find(
    (entry) => entry.provider === provider && entry.url === url,
  );
  if (existing) {
    existing.followed ||= followed;
    if (linkedFromFirstParty) existing.linkedFromFirstParty = true;
    if (followed) existing.reason = null;
    return existing;
  }
  const entry: CompanySiteAtsDiagnostic = {
    provider,
    url,
    sourceUrl,
    supportedForImport: DIRECT_IMPORT_ATS_PROVIDERS.has(provider),
    linkedFromFirstParty,
    followed,
    reason,
  };
  if (diagnostics.atsLinksSeen.length < MAX_DIAGNOSTIC_LINKS) {
    diagnostics.atsLinksSeen.push(entry);
  }
  return entry;
}

function addLinkDiagnostic(
  diagnostics: CompanySiteDiscoveryDiagnostics,
  entry: CompanySiteLinkDiagnostic,
): CompanySiteLinkDiagnostic | undefined {
  if (diagnostics.linksConsidered.length >= MAX_DIAGNOSTIC_LINKS) return undefined;
  diagnostics.linksConsidered.push(entry);
  if (entry.category === "careers" && entry.decision === "rejected" &&
    diagnostics.rejectedCareersLinks.length < MAX_DIAGNOSTIC_LINKS) {
    diagnostics.rejectedCareersLinks.push(entry);
  }
  return entry;
}

function isCareerListingDestination(link: ExtractedLink): boolean {
  if (link.atsProvider) return false;
  let pathname = "";
  try {
    pathname = new URL(link.url).pathname;
  } catch {
    return false;
  }
  const pathMatches = CAREER_LISTING_PATH.test(pathname);
  const textMatches = CAREER_LISTING_LINK_TEXT.test(textFromHtml(link.text).trim());
  return (pathMatches || textMatches) &&
    !isGenericCareersContent(`${link.text} ${link.contextText}`);
}

function careerCandidateRejectionReason(link: ExtractedLink): string | null {
  if (isCareerListingDestination(link)) return null;
  if (isNonVacancyCareerUtilityUrl(link.url)) return "non-vacancy careers utility or policy page";
  if (isGenericCareersContent(`${link.text} ${link.contextText}`)) {
    return "generic culture, values, or team content without vacancy evidence";
  }
  const destinationSignal = CAREERS_SIGNAL.test(`${link.text} ${new URL(link.url).pathname}`);
  const localRecruitmentContext = VACANCY_SIGNAL.test(`${link.text} ${link.contextText}`);
  if (!destinationSignal) return "URL and link text do not identify a careers destination";
  if (!link.inNavigation && !localRecruitmentContext) {
    return "careers wording lacks navigation or local recruitment context";
  }
  return null;
}

function explicitNoVacancyText(html: string): boolean {
  return /\b(?:no current (?:job|vacanc(?:y|ies)|openings?)|no (?:job|vacanc(?:y|ies)|positions?) available|we (?:currently )?have no (?:job|vacanc(?:y|ies)|openings?)|there are no current (?:job|vacanc(?:y|ies)))\b/i
    .test(textFromHtml(html));
}

function likelyJsRenderedJobs(html: string): boolean {
  const appReferencesJobs =
    /<(?:iframe|script)\b[^>]*(?:src|data-src)\s*=\s*["'][^"']*(?:career|job|vacanc|workday|teamtailor|icims|workable|personio|recruitee)[^"']*["']/i
      .test(html) ||
    /\b(?:data-(?:jobs|careers|vacancies)|job-search-widget|careers-widget|jobs-widget)\b/i.test(html);
  const visibleJobContext = /\b(?:current|open|available|browse|search)\s+(?:jobs?|vacanc(?:y|ies)|roles?|positions?)\b|\b(?:we're hiring|we are hiring|apply now)\b/i
    .test(textFromHtml(html));
  return appReferencesJobs && visibleJobContext;
}

function isGenericCareersContent(value: string): boolean {
  const text = textFromHtml(value);
  return CAREER_CONTENT_TOPIC.test(text) &&
    !/\b(?:job|vacanc(?:y|ies)|position|role|opening|apply|recruitment)\b/i.test(text);
}

function isCareersDestinationLink(link: ExtractedLink): boolean {
  if (isCareerListingDestination(link)) return true;
  if (isNonVacancyCareerUtilityUrl(link.url)) return false;
  let path = "";
  try {
    path = new URL(link.url).pathname;
  } catch {
    return false;
  }
  const destinationSignal = CAREERS_SIGNAL.test(`${link.text} ${path}`);
  const localRecruitmentContext = VACANCY_SIGNAL.test(`${link.text} ${link.contextText}`);
  return destinationSignal &&
    !isGenericCareersContent(`${link.text} ${link.contextText}`) &&
    (link.inNavigation || localRecruitmentContext);
}

function isRecruitmentAtsLink(link: ExtractedLink): boolean {
  return link.atsProvider !== null &&
    (link.inNavigation ||
      CAREER_RECRUITMENT_CONTEXT.test(`${link.text} ${link.contextText}`) ||
      CAREERS_SIGNAL.test(link.text) ||
      isSpecificRoleLink(link));
}

function isFirstPartyHost(originHostname: string, candidateHostname: string): boolean {
  const normalizeHost = (host: string) => host.toLowerCase().replace(/^www\./, "");
  const origin = normalizeHost(originHostname);
  const candidate = normalizeHost(candidateHostname);
  return candidate === origin || candidate.endsWith(`.${origin}`);
}

function isSpecificRoleLink(link: ExtractedLink): boolean {
  if (!isValidVacancyDeepLink(link.url) || link.inNavigation) return false;
  const title = cleanTitle(link.text, link.url);
  return Boolean(title) &&
    !GENERIC_ANCHOR_TEXT.test(link.text.trim()) &&
    !isLikelyEditorialTitle(title ?? "") &&
    !isGenericCareersContent(`${title} ${link.contextText}`);
}

function hasPostingSpecificUrlEvidence(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const pathSegments = parsed.pathname.split("/").filter(Boolean);
  const hasPostingSection = pathSegments
    .slice(0, -1)
    .some((segment) => POSTING_PATH_SEGMENT.test(segment));
  const terminalSlug = pathSegments.at(-1) ?? "";
  const hasPathIdentifier =
    /^\d{5,}$/.test(terminalSlug) ||
    /(?:^|[-_])\d{5,}(?:$|[-_])/.test(terminalSlug) ||
    /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(terminalSlug);
  const hasQueryIdentifier = [...parsed.searchParams.entries()].some(
    ([key, value]) => SPECIFIC_JOB_ID_QUERY_KEYS.has(key.toLowerCase()) && value.trim() !== "",
  );
  return hasPostingSection || hasPathIdentifier || hasQueryIdentifier;
}

function hasExplicitListingHeading(html: string): boolean {
  return CAREER_LISTING_HEADING.test(pageHeadingText(html));
}

function hasJobPostingMarkup(html: string): boolean {
  return /"@type"\s*:\s*(?:"JobPosting"|\[[^\]]*"JobPosting")/i.test(html) ||
    /itemtype\s*=\s*["'][^"']*\/JobPosting["']/i.test(html);
}

function hasRecruitmentPageEvidence(
  pageUrl: string,
  html: string,
  links: readonly ExtractedLink[],
): boolean {
  let path = "";
  try {
    path = new URL(pageUrl).pathname;
  } catch {
    return false;
  }
  const heading = pageHeadingText(html);
  const pagePurpose = CAREERS_SIGNAL.test(`${path} ${heading}`);
  const structuredJobPosting = hasJobPostingMarkup(html);
  const explicitListingHeading = hasExplicitListingHeading(html);
  const hasSpecificRole = links.some(isSpecificRoleLink);
  return structuredJobPosting ||
    explicitListingHeading ||
    (pagePurpose && hasSpecificRole) ||
    links.some(isRecruitmentAtsLink);
}

export function normaliseSponsorWebsite(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function cleanTitle(value: string, url: string): string | null {
  const text = textFromHtml(value).replace(/\s+[|–—-]\s+(apply|details)$/i, "").trim();
  if (text.length >= 4 && text.length <= 180 && !GENERIC_ANCHOR_TEXT.test(text)) return text;
  const parsed = new URL(url);
  const slug = parsed.pathname.split("/").filter(Boolean).at(-1) ?? "";
  const fromSlug = decodeURIComponent(slug)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\d{5,}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return fromSlug.length >= 4 && !GENERIC_ANCHOR_TEXT.test(fromSlug) ? fromSlug : null;
}

function isNonSpecificBambooHrPosting(url: string, title: string): boolean {
  return knownAtsProvider(url) === "BambooHR" && NON_SPECIFIC_BAMBOOHR_TITLE.test(title.trim());
}

function extractAnchors(
  html: string,
  baseUrl: string,
  originHostname: string,
  diagnostics: CompanySiteDiscoveryDiagnostics = emptyDiscoveryDiagnostics(baseUrl),
  rejectionReasons?: Record<string, number>,
): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const attrs = match[1] ?? "";
    const href = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || /^(mailto:|tel:|javascript:|#)/i.test(href)) continue;
    let url: string;
    try {
      url = new URL(decodeHtml(href), baseUrl).toString();
    } catch {
      continue;
    }
    const canonical = canonicalVacancyUrl(url) ?? url;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const context = anchorContext(html, match.index ?? 0, (match.index ?? 0) + match[0].length);
    const anchorNavigationMarkup = [...(match[0] ?? "").matchAll(/<[a-z][^>]*>/gi)]
      .some((tagMatch) => NAVIGATION_MARKER.test(tagMatch[0] ?? ""));
    const text = textFromHtml(match[2] ?? "");
    const provider = detectedAtsProvider(canonical);
    const candidatePath = new URL(canonical).pathname;
    const careerSignal = CAREERS_SIGNAL.test(`${text} ${candidatePath}`);
    const vacancySignal = VACANCY_SIGNAL.test(`${text} ${new URL(canonical).pathname}`);
    const postingOrPagination = isSpecificRoleLink({
      url: canonical,
      text,
      atsProvider: provider,
      contextText: context.text,
      inNavigation: context.inNavigation || anchorNavigationMarkup,
    }) || isPaginationLink({
      url: canonical,
      text,
      atsProvider: provider,
      contextText: context.text,
      inNavigation: context.inNavigation || anchorNavigationMarkup,
    });
    const editorialPath = NEGATIVE_CONTENT_PATH.test(candidatePath);
    const editorialLink = editorialPath;
    const relevant = careerSignal || vacancySignal || provider !== null || editorialLink;
    if (!relevant) continue;
    const link: ExtractedLink = {
      url: canonical,
      text,
      atsProvider: provider,
      contextText: context.text,
      inNavigation: context.inNavigation || anchorNavigationMarkup,
    };
    const pageIsFirstParty = isFirstPartyHost(originHostname, new URL(baseUrl).hostname);
    const blocked = isBlockedVacancyUrl(canonical);
    const allowed = isAllowedCompanyDestination(originHostname, canonical);
    const unsupportedAts = provider !== null && !DIRECT_IMPORT_ATS_PROVIDERS.has(provider);
    const careerReason = careerSignal && !postingOrPagination && !isRecruitmentAtsLink(link)
      ? careerCandidateRejectionReason(link)
      : null;
    const editorialReason = editorialLink;
    let decision: CompanySiteLinkDiagnostic["decision"] = "queued";
    let reason: string | null = null;
    if (blocked) {
      decision = "rejected";
      reason = "blocked by vacancy URL policy";
    } else if (unsupportedAts) {
      decision = "not_followed";
      reason = `unsupported ${provider} platform recorded but not crawled or imported`;
    } else if (!allowed) {
      decision = "rejected";
      reason = "destination is outside the approved employer site or supported ATS scope";
    } else if (editorialReason) {
      decision = "rejected";
      reason = "news, blog, press, or other editorial destination";
    } else if (careerReason) {
      decision = "rejected";
      reason = careerReason;
    }
    if (provider) {
      addAtsDiagnostic(
        diagnostics,
        provider,
        canonical,
        baseUrl,
        pageIsFirstParty,
        false,
        unsupportedAts ? reason : null,
      );
      if (isRecruitmentAtsLink(link)) {
        diagnostics.careersPageFound = true;
        diagnostics.careersUrl ??= canonical;
      }
    }
    const diagnostic = addLinkDiagnostic(diagnostics, {
      url: canonical,
      sourceUrl: baseUrl,
      text: text.slice(0, 220),
      category: provider ? "ats" : careerSignal && !postingOrPagination ? "careers" : "vacancy",
      decision,
      reason,
      atsProvider: provider,
    });
    if (careerSignal && decision === "rejected" && diagnostic &&
      !diagnostics.rejectedCareersLinks.includes(diagnostic)) {
      diagnostics.rejectedCareersLinks.push(diagnostic);
    }
    if (editorialReason && rejectionReasons) {
      rejectionReasons.negative_editorial_context =
        (rejectionReasons.negative_editorial_context ?? 0) + 1;
    } else if (rejectionReasons && !isValidVacancyDeepLink(canonical) && (careerSignal || vacancySignal)) {
      rejectionReasons.invalid_deep_link = (rejectionReasons.invalid_deep_link ?? 0) + 1;
    } else if (careerReason && rejectionReasons) {
      const title = cleanTitle(text, canonical);
      const reasonCode = isGenericCareersContent(`${text} ${context.text}`)
        ? "generic_careers_content"
        : title && isLikelyEditorialTitle(title)
          ? "editorial_or_non_vacancy_title"
          : "missing_listing_context_or_vacancy_signal";
      rejectionReasons[reasonCode] = (rejectionReasons[reasonCode] ?? 0) + 1;
    }
    if (blocked || unsupportedAts || !allowed || careerReason || editorialReason) continue;
    link.diagnostic = diagnostic;
    links.push(link);
  }

  // Embedded ATS iframes are useful evidence, but script assets are never
  // fetched as a substitute for an employer-linked vacancy page.
  const embeddedPattern = /<(iframe|script)\b([^>]*)>/gi;
  for (const match of html.matchAll(embeddedPattern)) {
    const tag = (match[1] ?? "").toLowerCase();
    const attrs = match[2] ?? "";
    const rawUrl = attrs.match(/\b(?:src|data-src)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!rawUrl) continue;
    let url: string;
    try {
      url = new URL(decodeHtml(rawUrl), baseUrl).toString();
    } catch {
      continue;
    }
    const provider = detectedAtsProvider(url);
    if (!provider) continue;
    const supported = DIRECT_IMPORT_ATS_PROVIDERS.has(provider);
    const firstParty = isFirstPartyHost(originHostname, new URL(baseUrl).hostname);
    const shouldFollow = tag === "iframe" && supported && firstParty &&
      isAllowedCompanyDestination(originHostname, url);
    const reason = shouldFollow
      ? null
      : supported
        ? "embedded platform is not a first-party careers link; not followed"
        : `unsupported ${provider} platform recorded but not crawled or imported`;
    addAtsDiagnostic(diagnostics, provider, url, baseUrl, firstParty, shouldFollow, reason);
    if (shouldFollow && !seen.has(url)) {
      const diagnostic = addLinkDiagnostic(diagnostics, {
        url,
        sourceUrl: baseUrl,
        text: "Embedded careers platform",
        category: "ats",
        decision: "queued",
        reason: null,
        atsProvider: provider,
      });
      links.push({
        url,
        text: "Embedded careers platform",
        atsProvider: provider,
        contextText: "Embedded careers platform",
        inNavigation: false,
        diagnostic,
      });
    }
  }
  return links;
}

export type CompanySiteProbeInspection = {
  hasCareersSignal: boolean;
  careersUrl: string | null;
  atsProvider: string | null;
  atsMappingVerified?: boolean;
  atsMappingEvidenceUrl?: string | null;
};

export function inspectCompanySiteProbePage(
  pageUrl: string,
  body: string,
): CompanySiteProbeInspection {
  const parsed = new URL(pageUrl);
  const links = extractAnchors(body, pageUrl, parsed.hostname);
  const atsLink = links.find(isRecruitmentAtsLink);
  const careersLink = links.find(isCareersDestinationLink);
  const atsProvider = knownAtsProvider(pageUrl) ?? atsLink?.atsProvider ?? null;
  const recruitmentPage = hasRecruitmentPageEvidence(pageUrl, body, links);
  const atsMappingVerified =
    knownAtsProvider(parsed.hostname) === null && atsLink !== undefined;
  return {
    hasCareersSignal: atsProvider !== null || careersLink !== undefined || recruitmentPage,
    careersUrl: atsLink?.url ?? careersLink?.url ?? (recruitmentPage ? pageUrl : null),
    atsProvider,
    atsMappingVerified,
    atsMappingEvidenceUrl: atsMappingVerified ? pageUrl : null,
  };
}

function isPaginationLink(link: ExtractedLink): boolean {
  try {
    const parsed = new URL(link.url);
    const hasPageParameter = ["page", "p", "pageNumber", "offset", "start"]
      .some((key) => parsed.searchParams.has(key));
    return (
      (PAGINATION_SIGNAL.test(link.text) || hasPageParameter) &&
      isAllowedCompanyDestination(parsed.hostname, parsed.toString()) &&
      !isBlockedVacancyUrl(parsed.toString())
    );
  } catch {
    return false;
  }
}

function extractSitemapLinks(
  body: string,
  pageUrl: string,
  originHostname: string,
): { nestedSitemaps: string[]; urls: string[] } {
  const nestedSitemaps: string[] = [];
  const urls: string[] = [];
  const seen = new Set<string>();
  const isIndex = /<sitemapindex\b/i.test(body);
  for (const match of body.matchAll(SITEMAP_LOC_PATTERN)) {
    const raw = decodeHtml(
      (match[1] ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1"),
    ).trim();
    if (!raw) continue;
    let url: string;
    try {
      url = new URL(raw, pageUrl).toString();
    } catch {
      continue;
    }
    const canonical = canonicalVacancyUrl(url) ?? url;
    if (
      seen.has(canonical) ||
      !isAllowedCompanyDestination(originHostname, canonical) ||
      isBlockedVacancyUrl(canonical)
    ) continue;
    seen.add(canonical);
    if (isIndex || SITEMAP_SIGNAL.test(canonical)) nestedSitemaps.push(canonical);
    else urls.push(canonical);
  }
  return { nestedSitemaps, urls };
}

function isSitemapDocument(body: string, contentType: string): boolean {
  return /xml/i.test(contentType) || /<(?:urlset|sitemapindex)\b/i.test(body);
}

function isLikelySitemapVacancyUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const pathAndQuery = `${parsed.pathname} ${parsed.search}`;
    if (!CAREERS_SIGNAL.test(pathAndQuery)) return false;
    if (SITEMAP_EXCLUDED_PATH.test(parsed.pathname) &&
      !/\b(?:job|vacanc|career|recruit|opening|position|role)\b/i.test(parsed.pathname)) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function sitemapUrlPriority(url: string): number {
  const path = new URL(url).pathname;
  return (
    (/\b(?:job|vacanc|career|recruit|opening)\b/i.test(path) ? 4 : 0) +
    (/\b(?:position|role|hiring|opportunit)\b/i.test(path) ? 2 : 0) +
    (/\b(?:apprentice|volunteer)\b/i.test(path) ? 1 : 0)
  );
}

function sitemapIndexPriority(url: string): number {
  const path = new URL(url).pathname.toLowerCase();
  const recruitmentMap =
    /(?:job|vacanc|career|recruit|position|role|opening|employment|hiring)/i.test(path);
  const generalPageMap = /(?:page|post)[-_]sitemap|sitemap[-_](?:pages|posts)/i.test(path);
  const lowValueMap =
    /(?:product|review|testimonial|client|portfolio|gallery|news|blog|press|media|event|category|tag|attachment)/i
      .test(path);
  return (recruitmentMap ? 100 : 0) +
    (generalPageMap ? 10 : 0) -
    (lowValueMap ? 50 : 0);
}

function jsonLdLocation(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name === "string") return record.name;
  const address = record.address;
  if (address && typeof address === "object") {
    const addressRecord = address as Record<string, unknown>;
    const parts = ["addressLocality", "addressRegion", "addressCountry"]
      .map((key) => addressRecord[key])
      .filter((part): part is string => typeof part === "string" && part.trim() !== "");
    return parts.join(", ") || null;
  }
  return null;
}

function flattenJsonLd(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const graph = record["@graph"];
  return [record, ...(graph ? flattenJsonLd(graph) : [])];
}

function hasJsonLdJobPosting(html: string): boolean {
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  for (const script of scripts) {
    const raw = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    try {
      if (flattenJsonLd(JSON.parse(raw)).some((record) => {
        const type = record["@type"];
        return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
      })) return true;
    } catch {
      // Malformed JSON-LD is not structured vacancy evidence.
    }
  }
  return false;
}

function extractJsonLdAdverts(
  html: string,
  pageUrl: string,
  originHostname: string,
  organisationName: string,
): BoardAdvert[] {
  const adverts: BoardAdvert[] = [];
  const scripts = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi) ?? [];
  for (const script of scripts) {
    const raw = script.replace(/^<script\b[^>]*>/i, "").replace(/<\/script>$/i, "").trim();
    try {
      for (const record of flattenJsonLd(JSON.parse(raw))) {
        const type = record["@type"];
        if (!(type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting")))) continue;
        const rawUrl = typeof record.url === "string" ? record.url : pageUrl;
        const url = new URL(rawUrl, pageUrl).toString();
        if (
          !isAllowedCompanyDestination(originHostname, url) ||
          !isValidVacancyDeepLink(url) ||
          isBlockedVacancyUrl(url)
        ) continue;
        const title = typeof record.title === "string" ? cleanTitle(record.title, url) : null;
        if (!title) continue;
        if (isLikelyEditorialTitle(title)) continue;
        if (isNonSpecificBambooHrPosting(url, title)) continue;
        const jobLocation = Array.isArray(record.jobLocation) ? record.jobLocation[0] : record.jobLocation;
        const descriptionHtml = typeof record.description === "string" ? record.description : "";
        adverts.push({
          organisationName,
          employer: organisationName,
          title,
          location: jsonLdLocation(jobLocation),
          salary: null,
          url,
          description: descriptionHtml ? textFromHtml(descriptionHtml).slice(0, 8_000) : null,
          postedDate: typeof record.datePosted === "string" ? record.datePosted : null,
          targetRegions: null,
          boardName: null,
          externalId: null,
          sourceType: "company_site",
          contactEmail: extractAdvertContactEmail(
            `${descriptionHtml} ${canonicalVacancyUrl(pageUrl) === canonicalVacancyUrl(url) ? html : ""}`,
            url,
          ),
          contactEvidenceUrl: url,
          closesAt: parseVacancyClosingDate(record.validThrough),
          companyVacancyEvidence: { kind: "json_ld_job_posting" },
        });
      }
    } catch {
      // Invalid third-party JSON-LD must not fail the employer check.
    }
  }
  return adverts;
}

function tagAttribute(attributes: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attributes.match(new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return decodeHtml(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim() || null;
}

function matchingElementEnd(html: string, openTagEnd: number, tagName: string): number | null {
  const tokenPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, "gi");
  tokenPattern.lastIndex = openTagEnd;
  let depth = 1;
  for (const token of html.matchAll(tokenPattern)) {
    const raw = token[0] ?? "";
    if (/^<\//.test(raw)) depth -= 1;
    else if (!/\/>$/.test(raw)) depth += 1;
    if (depth === 0) return (token.index ?? 0) + raw.length;
  }
  return null;
}

function itempropValue(scope: string, names: readonly string[]): string | null {
  const accepted = new Set(names.map((name) => name.toLowerCase()));
  const pattern = /<([a-z][a-z0-9:-]*)\b([^>]*)>/gi;
  for (const match of scope.matchAll(pattern)) {
    const tagName = match[1] ?? "";
    const attributes = match[2] ?? "";
    const props = (tagAttribute(attributes, "itemprop") ?? "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!props.some((prop) => accepted.has(prop))) continue;
    const attributeValue =
      tagAttribute(attributes, "content") ??
      tagAttribute(attributes, "href") ??
      tagAttribute(attributes, "datetime") ??
      tagAttribute(attributes, "value") ??
      tagAttribute(attributes, "src");
    if (attributeValue) return attributeValue;
    const start = (match.index ?? 0) + match[0].length;
    const close = scope.toLowerCase().indexOf(`</${tagName.toLowerCase()}`, start);
    if (close >= 0) {
      const value = textFromHtml(scope.slice(start, close));
      if (value) return value;
    }
  }
  return null;
}

function extractMicrodataAdverts(
  html: string,
  pageUrl: string,
  originHostname: string,
  organisationName: string,
): BoardAdvert[] {
  const adverts: BoardAdvert[] = [];
  const openings = /<([a-z][a-z0-9:-]*)\b([^>]*)>/gi;
  for (const match of html.matchAll(openings)) {
    const tagName = match[1] ?? "";
    const attributes = match[2] ?? "";
    if (!/\bitemscope\b/i.test(attributes) ||
      !/schema\.org\/JobPosting\b/i.test(tagAttribute(attributes, "itemtype") ?? "")) continue;
    const elementStart = match.index ?? 0;
    const openingEnd = elementStart + match[0].length;
    const closingEnd = matchingElementEnd(html, openingEnd, tagName);
    if (closingEnd === null) continue;
    const scope = html.slice(openingEnd, closingEnd).slice(0, 80_000);
    const titleValue = itempropValue(scope, ["title", "name"]);
    const rawUrl = itempropValue(scope, ["url"]);
    let url: string;
    try {
      url = new URL(rawUrl ?? pageUrl, pageUrl).toString();
    } catch {
      continue;
    }
    if (
      !isAllowedCompanyDestination(originHostname, url) ||
      !isValidVacancyDeepLink(url) ||
      isBlockedVacancyUrl(url)
    ) continue;
    const title = titleValue ? cleanTitle(titleValue, url) : null;
    if (!title || isLikelyEditorialTitle(title)) continue;
    const description = itempropValue(scope, ["description"]);
    const location = itempropValue(scope, ["jobLocation"]);
    const datePosted = itempropValue(scope, ["datePosted"]);
    const validThrough = itempropValue(scope, ["validThrough"]);
    adverts.push({
      organisationName,
      employer: organisationName,
      title,
      location: location ? textFromHtml(location).slice(0, 500) : null,
      salary: null,
      url,
      description: description ? textFromHtml(description).slice(0, 8_000) : null,
      postedDate: datePosted,
      targetRegions: null,
      boardName: null,
      externalId: null,
      sourceType: "company_site",
      contactEmail: extractAdvertContactEmail(scope, url),
      contactEvidenceUrl: url,
      closesAt: parseVacancyClosingDate(validThrough),
      companyVacancyEvidence: { kind: "microdata_job_posting" },
    });
    if (adverts.length >= 20) break;
  }
  return adverts;
}

function isOpaqueAtsPostingLink(
  link: ExtractedLink,
  listingPageProvider: string | null,
  listingPageUrl: string,
): boolean {
  const linkProvider = knownAtsProvider(link.url);
  const pathSegments = new URL(link.url).pathname.split("/").filter(Boolean);
  return (
    listingPageProvider !== null &&
    linkProvider === listingPageProvider &&
    link.url !== listingPageUrl &&
    (
      ((linkProvider === "Lever" || linkProvider === "Ashby") && pathSegments.length >= 2) ||
      (linkProvider === "Greenhouse" && /\/jobs\/\d+/i.test(new URL(link.url).pathname)) ||
      (linkProvider !== "Lever" && linkProvider !== "Ashby" && linkProvider !== "Greenhouse")
    )
  );
}

function advertsFromLinks(
  links: readonly ExtractedLink[],
  organisationName: string,
  listingPageProvider: string | null,
  listingPageUrl: string,
  listingPageHtml: string,
  rejectionReasons?: Record<string, number>,
): BoardAdvert[] {
  const reject = (reason: string): BoardAdvert[] => {
    if (rejectionReasons) rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1;
    return [];
  };
  const listingPageContext = /(?:^|\/)(?:careers?|jobs?|vacancies?|opportunities?|positions?)(?:\/|$)/i.test(
    new URL(listingPageUrl).pathname,
  );
  const pageHasRecruitmentEvidence = hasRecruitmentPageEvidence(
    listingPageUrl,
    listingPageHtml,
    links,
  );
  const explicitListingHeading = hasExplicitListingHeading(listingPageHtml);
  const structuredJobPosting = hasJobPostingMarkup(listingPageHtml);
  return links.flatMap((link) => {
    if (ACCESSIBILITY_NAV_ANCHOR_TEXT.test(link.text.trim())) {
      return reject("navigation_link_not_vacancy");
    }
    if (isCareerListingDestination(link)) return reject("generic_careers_content");
    if (!isValidVacancyDeepLink(link.url)) return reject("invalid_deep_link");
    const opaqueAtsPosting = isOpaqueAtsPostingLink(
      link,
      listingPageProvider,
      listingPageUrl,
    );
    if (link.atsProvider && !opaqueAtsPosting) {
      return reject("ats_landing_page_not_vacancy");
    }
    const linkUrl = new URL(link.url);
    if (!opaqueAtsPosting && link.inNavigation) {
      return reject("navigation_link_not_vacancy");
    }
    const confirmedListingContext =
      /(?:^|\/)(?:careers?|jobs?|vacancies?|opportunities?|positions?)(?:\/|$)/i.test(linkUrl.pathname) ||
      /(?:greenhouse|lever|workday|smartrecruiters)/i.test(linkUrl.hostname);
    if (
      !opaqueAtsPosting &&
      (!listingPageContext || !confirmedListingContext || (GENERIC_ANCHOR_TEXT.test(link.text.trim()) &&
        !VACANCY_SIGNAL.test(`${link.text} ${linkUrl.pathname}`)))
    ) return reject("missing_listing_context_or_vacancy_signal");
    if (
      !opaqueAtsPosting &&
      !explicitListingHeading &&
      !structuredJobPosting &&
      !hasPostingSpecificUrlEvidence(link.url)
    ) return reject("missing_posting_specific_evidence");
    if (
      !opaqueAtsPosting &&
      /^(?:apply(?:\s+online)?|apply now)$/i.test(link.text.trim()) &&
      /\/apply(?:-online)?(?:\/|$)/i.test(linkUrl.pathname)
    ) return reject("generic_apply_online");
    if (
      !opaqueAtsPosting &&
      NEGATIVE_CONTENT_PATH.test(linkUrl.pathname) &&
      !/\b(?:job|vacanc(?:y|ies)|position|role|opportunit(?:y|ies)|opening)\b/i.test(link.text)
    ) return reject("negative_editorial_context");
    const title = cleanTitle(link.text, link.url);
    if (!title) return reject("missing_vacancy_title");
    if (
      !opaqueAtsPosting &&
      isGenericCareersContent(`${title} ${link.contextText}`) &&
      !CAREER_RECRUITMENT_CONTEXT.test(link.contextText) &&
      !pageHasRecruitmentEvidence
    ) return reject("generic_careers_content");
    if (isLikelyEditorialTitle(title)) return reject("editorial_or_non_vacancy_title");
    if (isNonSpecificBambooHrPosting(link.url, title)) {
      return reject("non_specific_bamboohr_posting");
    }
    return [{
      organisationName,
      employer: organisationName,
      title,
      location: null,
      salary: null,
      url: link.url,
      description: null,
      postedDate: null,
      targetRegions: null,
      boardName: null,
      externalId: null,
      sourceType: "company_site" as const,
       companyVacancyEvidence: opaqueAtsPosting
         ? { kind: "known_ats_posting", provider: listingPageProvider ?? "unknown" }
         : { kind: "structured_job_card", listingUrl: listingPageUrl },
    }];
  });
}

function selectNavigationLinks(
  links: readonly ExtractedLink[],
  visited: ReadonlySet<string>,
  listingPageProvider: string | null,
  listingPageUrl: string,
  acceptedAdvertUrls: ReadonlySet<string>,
): ExtractedLink[] {
  return links
    .filter((link) => !visited.has(link.url))
    .filter((link) => !acceptedAdvertUrls.has(link.url) || link.atsProvider !== null)
    .filter((link) => !isOpaqueAtsPostingLink(link, listingPageProvider, listingPageUrl))
    .filter((link) =>
      !(
        isValidVacancyDeepLink(link.url) &&
        VACANCY_SIGNAL.test(`${link.text} ${new URL(link.url).pathname}`)
      ),
    )
    .filter((link) =>
      isRecruitmentAtsLink(link) ||
      isPaginationLink(link) ||
      isCareersDestinationLink(link),
    )
    .sort((a, b) => {
      const aScore =
        (isRecruitmentAtsLink(a) ? 2 : 0) +
        (isPaginationLink(a) ? 1 : 0) +
        (isCareersDestinationLink(a) ? 1 : 0);
      const bScore =
        (isRecruitmentAtsLink(b) ? 2 : 0) +
        (isPaginationLink(b) ? 1 : 0) +
        (isCareersDestinationLink(b) ? 1 : 0);
      return bScore - aScore;
    });
}

async function discoverDirectFeedsOnly(
  organisationName: string,
  sourceUrl: string,
  originHostname: string,
  options: CompanySiteDiscoveryOptions,
  deadlineMs: number,
  initialDiagnostics: CompanySiteDiscoveryDiagnostics,
): Promise<CompanySiteDiscoveryResult> {
  const careersUrl = options.knownCareersUrl?.trim() || null;
  const diagnostics: CompanySiteDiscoveryDiagnostics = {
    ...initialDiagnostics,
    directFeedsOnly: true,
    directSourceKind: null,
    directFeedSkipReason: null,
    directFeedSkipDetail: null,
  };
  const makeResult = (
    overrides: Partial<CompanySiteDiscoveryResult> = {},
  ): CompanySiteDiscoveryResult => ({
    adverts: [],
    sourceUrl,
    careersUrl,
    atsProvider: null,
    atsMappingVerified: options.knownCareersMappingVerified === true,
    atsMappingEvidenceUrl: options.knownCareersEvidenceUrl ?? null,
    genericCompleted: false,
    atsCompleted: false,
    transientFailure: false,
    failureClass: null,
    pagesFetched: 0,
    completion: "complete",
    pagesAttempted: 0,
    advertsExtracted: 0,
    advertsRejected: 0,
    rejectionReasons: {},
    discoveredUrls: [],
    observedAdvertUrls: [],
    resumeState: null,
    diagnostics: { ...diagnostics },
    ...overrides,
  });
  const noDirectSource = (detail: string): CompanySiteDiscoveryResult => makeResult({
    diagnostics: {
      ...diagnostics,
      directFeedSkipReason: "no_direct_feed_source",
      directFeedSkipDetail: detail,
    },
  });

  if (!options.knownCareersMappingVerified || !careersUrl) {
    return noDirectSource("no verified careers, ATS, feed, or schema.org mapping is stored");
  }

  const provider = knownAtsProvider(careersUrl);
  if (provider) {
    const mapping = parseDirectBoardMapping(provider, careersUrl, {
      firstPartyEvidenceUrl: options.knownCareersEvidenceUrl,
    });
    if (!mapping) {
      return noDirectSource(`verified ${provider} mapping has no supported direct-feed adapter`);
    }
    if (
      options.knownAtsBoardId &&
      mapping.boardId.toLowerCase() !== options.knownAtsBoardId.trim().toLowerCase()
    ) {
      return noDirectSource("verified ATS board ID does not match the approved careers URL");
    }

    const direct = await fetchDirectEmployerBoard(
      organisationName,
      mapping.provider,
      careersUrl,
      {
        deadlineMs,
        firstPartyEvidenceUrl: options.knownCareersEvidenceUrl,
      },
    );
    if (!direct.mapping) {
      return noDirectSource(direct.error ?? "approved mapping did not resolve to a supported direct feed");
    }
    const adverts = normaliseAndDedupeBoardAdverts(direct.adverts);
    addAtsDiagnostic(
      diagnostics,
      direct.mapping.provider,
      direct.mapping.evidenceUrl,
      options.knownCareersEvidenceUrl ?? sourceUrl,
      true,
      true,
      direct.complete ? null : direct.error ?? "direct feed did not complete",
    );
    diagnostics.careersPageFound = true;
    diagnostics.careersUrl = direct.mapping.evidenceUrl;
    diagnostics.directSourceKind = "ats_feed";
    return makeResult({
      adverts,
      careersUrl: direct.mapping.evidenceUrl,
      atsProvider: direct.mapping.provider,
      atsMappingVerified: true,
      genericCompleted: false,
      atsCompleted: direct.complete,
      transientFailure: direct.transientFailure,
      failureClass: direct.failureClass,
      retryAt: direct.retryAt,
      error: direct.error,
      pagesFetched: direct.pagesFetched,
      completion: direct.complete ? "complete" : "failed",
      pagesAttempted: direct.pagesFetched,
      advertsExtracted: direct.advertsExtracted,
      advertsRejected: Math.max(0, direct.advertsExtracted - adverts.length),
      discoveredUrls: [direct.mapping.feedUrl],
      observedAdvertUrls: adverts.map((advert) => advert.url),
      snapshotScope: direct.complete && AUTHORITATIVE_SNAPSHOT_PROVIDERS.has(direct.mapping.provider)
        ? { provider: direct.mapping.provider, boardId: direct.mapping.boardId }
        : undefined,
      diagnostics: { ...diagnostics },
    });
  }

  let approvedUrl: URL;
  try {
    approvedUrl = new URL(careersUrl);
  } catch {
    return noDirectSource("approved structured-data URL is invalid");
  }
  if (
    approvedUrl.protocol !== "https:" ||
    approvedUrl.username ||
    approvedUrl.password ||
    approvedUrl.port ||
    !isAllowedCompanyDestination(originHostname, approvedUrl.toString())
  ) {
    diagnostics.directFeedSkipDetail = "approved structured-data URL is outside the safe employer-site scope";
    return makeResult({
      completion: "failed",
      failureClass: "permanent",
      error: diagnostics.directFeedSkipDetail,
      diagnostics: { ...diagnostics },
    });
  }

  const page = await fetchCompanySitePage(approvedUrl.toString(), originHostname, deadlineMs);
  diagnostics.pageFetches.push({
    url: approvedUrl.toString(),
    fetchedUrl: page.ok ? page.url : null,
    status: page.ok ? page.status : page.status ?? null,
    fetched: page.ok,
    failureKind: page.ok ? null : page.kind,
    reason: page.ok ? null : page.reason.slice(0, 500),
  });
  if (!page.ok) {
    const failureClass = classifyCompanySiteFailure({
      kind: page.kind,
      reason: page.reason,
      status: page.status,
    });
    return makeResult({
      transientFailure: failureClass === "temporary",
      failureClass,
      error: page.reason,
      pagesAttempted: 1,
      completion: "failed",
      discoveredUrls: [approvedUrl.toString()],
      diagnostics: { ...diagnostics, careersFailureKind: page.kind },
    });
  }

  const jsonLdAdverts = extractJsonLdAdverts(page.body, page.url, originHostname, organisationName);
  const microdataAdverts = extractMicrodataAdverts(page.body, page.url, originHostname, organisationName);
  const rawAdverts = [...jsonLdAdverts, ...microdataAdverts];
  const adverts = normaliseAndDedupeBoardAdverts(rawAdverts);
  const hasStructuredJobPosting = hasJobPostingMarkup(page.body);
  diagnostics.careersPageFound = true;
  diagnostics.careersUrl = page.url;
  diagnostics.careersHttpStatus = page.status;
  diagnostics.jsonLdJobPostingFound = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>[\s\S]*?"@type"\s*:\s*(?:"JobPosting"|\[[^\]]*"JobPosting")/i.test(page.body);
  diagnostics.microdataJobPostingFound = /itemscope\b[^>]*itemtype=["'][^"']*schema\.org\/JobPosting/i.test(page.body);
  diagnostics.directSourceKind = hasStructuredJobPosting ? "schema_org" : null;
  if (!hasStructuredJobPosting) {
    diagnostics.directFeedSkipReason = "no_direct_feed_source";
    diagnostics.directFeedSkipDetail = "approved careers page contains no schema.org JobPosting markup";
  }
  if (hasStructuredJobPosting && adverts.length > 0) {
    diagnostics.vacancyLikePages.push(page.url);
  }
  return makeResult({
    adverts,
    atsCompleted: true,
    pagesFetched: 1,
    pagesAttempted: 1,
    advertsExtracted: rawAdverts.length,
    advertsRejected: Math.max(0, rawAdverts.length - adverts.length),
    discoveredUrls: [page.url],
    observedAdvertUrls: adverts.map((advert) => advert.url),
    diagnostics: { ...diagnostics },
  });
}

export async function discoverCompanySiteVacancies(
  organisationName: string,
  website: string,
  options: CompanySiteDiscoveryOptions = {},
): Promise<CompanySiteDiscoveryResult> {
  const sourceUrl = normaliseSponsorWebsite(website);
  const diagnostics = emptyDiscoveryDiagnostics(sourceUrl ?? website);
  if (options.knownCareersUrl) diagnostics.careersUrl = options.knownCareersUrl;
  if (!sourceUrl) {
    return {
      adverts: [],
      sourceUrl: website,
      careersUrl: null,
      atsProvider: null,
      genericCompleted: false,
      atsCompleted: false,
      transientFailure: false,
      failureClass: "permanent",
      error: "invalid sponsor website",
      pagesFetched: 0,
      completion: "failed",
      pagesAttempted: 0,
      advertsExtracted: 0,
      advertsRejected: 0,
      rejectionReasons: {},
      discoveredUrls: [],
      observedAdvertUrls: [],
      resumeState: null,
      diagnostics,
    };
  }
  diagnostics.homepageUrl = sourceUrl;
  if (options.knownCareersUrl) {
    const storedProvider = detectedAtsProvider(options.knownCareersUrl);
    if (storedProvider) {
      addAtsDiagnostic(
        diagnostics,
        storedProvider,
        options.knownCareersUrl,
        sourceUrl,
        false,
        false,
        options.knownCareersMappingVerified
          ? "stored ATS mapping; verification will be handled by the existing connector"
          : "stored ATS mapping is unverified; not followed without first-party evidence",
      );
    }
  }
  const rejectionReasons: Record<string, number> = {};
  const now = options.now ?? Date.now;
  const deadlineMs = Math.min(
    options.deadlineMs ?? Number.POSITIVE_INFINITY,
    now() + COMPANY_SITE_EMPLOYER_BUDGET_MS,
  );
  const originHostname = new URL(sourceUrl).hostname;
  if (options.directFeedsOnly) {
    return discoverDirectFeedsOnly(
      organisationName,
      sourceUrl,
      originHostname,
      options,
      deadlineMs,
      diagnostics,
    );
  }
  const checkGeneric = options.checkGeneric !== false;
  const checkAts = options.checkAts !== false;
  const directAttempted = new Set<string>();
  if (
    !options.resumeState &&
    checkAts &&
    options.knownCareersUrl &&
    options.knownCareersMappingVerified === true
  ) {
    const direct = await fetchDirectEmployerBoard(
      organisationName,
      knownAtsProvider(options.knownCareersUrl),
      options.knownCareersUrl,
      {
        deadlineMs,
        firstPartyEvidenceUrl: options.knownCareersEvidenceUrl,
      },
    );
    if (direct.mapping) directAttempted.add(direct.mapping.evidenceUrl);
    if (direct.mapping && (direct.complete || direct.adverts.length > 0)) {
      const directAdverts = normaliseAndDedupeBoardAdverts(direct.adverts);
      diagnostics.careersPageFound = true;
      diagnostics.careersUrl = direct.mapping.evidenceUrl;
      diagnostics.careersHttpStatus = null;
      diagnostics.pagesCrawled = direct.pagesFetched;
      diagnostics.pagesAttempted = direct.pagesFetched;
      diagnostics.directSourceKind = "ats_feed";
      addAtsDiagnostic(
        diagnostics,
        direct.mapping.provider,
        direct.mapping.evidenceUrl,
        options.knownCareersEvidenceUrl ?? sourceUrl,
        true,
        true,
        null,
      );
      return {
        adverts: directAdverts,
        sourceUrl,
        careersUrl: direct.mapping.evidenceUrl,
        atsProvider: direct.mapping.provider,
        atsMappingVerified: true,
        atsMappingEvidenceUrl: options.knownCareersEvidenceUrl ?? null,
        genericCompleted: false,
        atsCompleted: direct.complete,
        transientFailure: direct.transientFailure,
        failureClass: direct.failureClass,
        retryAt: direct.retryAt,
        error: direct.error,
        pagesFetched: direct.pagesFetched,
        completion: direct.complete ? "complete" : "failed",
        pagesAttempted: direct.pagesFetched,
        advertsExtracted: direct.advertsExtracted,
        advertsRejected: Math.max(0, direct.advertsExtracted - directAdverts.length),
        rejectionReasons: {},
        discoveredUrls: [direct.mapping.feedUrl],
        observedAdvertUrls: directAdverts.map((advert) => advert.url),
        snapshotScope: direct.complete && AUTHORITATIVE_SNAPSHOT_PROVIDERS.has(direct.mapping.provider)
          ? { provider: direct.mapping.provider, boardId: direct.mapping.boardId }
          : undefined,
        // A direct-board failure is retried from the feed on the next run.
        // Never hand an API endpoint to the HTML crawler as resumable state.
        resumeState: null,
        diagnostics,
      };
    }
  }
  const queue: string[] = [];
  const visited = new Set<string>();
  const queued = new Set<string>();
  const trustedAtsUrls = new Set<string>();
  const trustedAtsBoardScopes = new Set<string>();
  const sitemapUrl = new URL("/sitemap.xml", sourceUrl).toString();
  const seenSitemaps = new Set<string>();
  let sitemapChildCount = 0;
  const addTrustedAtsUrl = (url: string): void => {
    trustedAtsUrls.add(canonicalVacancyUrl(url) ?? url);
    try {
      const parsed = new URL(url);
      const boardId = parsed.pathname.split("/").filter(Boolean)[0];
      if (boardId) trustedAtsBoardScopes.add(`${parsed.hostname.toLowerCase()}/${boardId.toLowerCase()}`);
    } catch {
      // The URL has already passed the crawler's URL validation.
    }
  };
  const isTrustedAtsUrl = (url: string): boolean => {
    if (trustedAtsUrls.has(canonicalVacancyUrl(url) ?? url)) return true;
    try {
      const parsed = new URL(url);
      const boardId = parsed.pathname.split("/").filter(Boolean)[0];
      return Boolean(
        boardId &&
        trustedAtsBoardScopes.has(`${parsed.hostname.toLowerCase()}/${boardId.toLowerCase()}`),
      );
    } catch {
      return false;
    }
  };
  if (options.knownCareersMappingVerified && options.knownCareersUrl) {
    addTrustedAtsUrl(options.knownCareersUrl);
  }
  let sitemapQueued = options.resumeState?.sitemapQueued === true;
  const enqueue = (url: string): void => {
    const canonical = canonicalVacancyUrl(url) ?? url;
    if (visited.has(canonical) || queued.has(canonical)) return;
    queued.add(canonical);
    queue.push(canonical);
  };
  const enqueueCommonCareersPaths = (): void => {
    for (const path of COMMON_CAREERS_PATHS) {
      if (queue.length >= MAX_RESUMABLE_CRAWL_URLS) break;
      enqueue(new URL(path, sourceUrl).toString());
    }
  };
  const prioritizeEnqueue = (urls: readonly string[]): void => {
    const prioritized: string[] = [];
    for (const url of urls) {
      const canonical = canonicalVacancyUrl(url) ?? url;
      if (visited.has(canonical) || queued.has(canonical)) continue;
      queued.add(canonical);
      prioritized.push(canonical);
    }
    if (prioritized.length > 0) queue.unshift(...prioritized);
  };
  if (options.resumeState) {
    for (const url of options.resumeState.queue.slice(0, MAX_RESUMABLE_CRAWL_URLS)) {
      if (
        detectedAtsProvider(url) !== null &&
        !DIRECT_IMPORT_ATS_PROVIDERS.has(detectedAtsProvider(url)!) &&
        url !== sourceUrl
      ) continue;
      if (
        knownAtsProvider(url) !== null &&
        url !== sourceUrl &&
        !isTrustedAtsUrl(url)
      ) continue;
      enqueue(url);
    }
    for (const url of options.resumeState.visited.slice(0, MAX_RESUMABLE_CRAWL_URLS)) visited.add(url);
  } else if (checkGeneric) queue.push(sourceUrl);
  if (
    checkAts &&
    options.knownCareersUrl &&
    knownAtsProvider(options.knownCareersUrl) !== null &&
    DIRECT_IMPORT_ATS_PROVIDERS.has(knownAtsProvider(options.knownCareersUrl)!) &&
    options.knownCareersMappingVerified === true
  ) {
    addTrustedAtsUrl(options.knownCareersUrl);
    enqueue(options.knownCareersUrl);
  }
  if (queue.length === 0) enqueue(sourceUrl);

  const adverts: BoardAdvert[] = [];
  let careersUrl = options.resumeState?.careersUrl ?? options.knownCareersUrl ?? null;
  let atsProvider = options.resumeState?.atsProvider ?? (careersUrl ? knownAtsProvider(careersUrl) : null);
  let atsMappingVerified = options.knownCareersMappingVerified === true;
  let atsMappingEvidenceUrl = options.knownCareersEvidenceUrl ?? null;
  let genericCompleted = false;
  let atsCompleted = false;
  let transientFailure = false;
  let permanentFailure = false;
  let temporaryFailure = false;
  let attemptedPageFailure = false;
  let retryAt: Date | undefined;
  let error: string | undefined;
  let pagesFetched = 0;
  let pagesAttempted = 0;
  const discoveredUrls: string[] = [];

  while (
    queue.length > 0 &&
    pagesAttempted < MAX_COMPANY_SITE_DISCOVERY_PAGES &&
    now() < deadlineMs
  ) {
    const next = queue.shift()!;
    const canonical = canonicalVacancyUrl(next) ?? next;
    if (visited.has(canonical)) continue;
    queued.delete(canonical);
    visited.add(canonical);
    pagesAttempted += 1;
    discoveredUrls.push(canonical);
    const isHomepageRequest =
      (canonicalVacancyUrl(canonical) ?? canonical) === (canonicalVacancyUrl(sourceUrl) ?? sourceUrl);
    const isKnownCareersRequest =
      Boolean(options.knownCareersUrl) &&
      (canonicalVacancyUrl(canonical) ?? canonical) ===
        (canonicalVacancyUrl(options.knownCareersUrl!) ?? options.knownCareersUrl!);
    if (SITEMAP_SIGNAL.test(canonical)) diagnostics.sitemapChecked = true;
    if (isKnownCareersRequest && !diagnostics.careersUrl) diagnostics.careersUrl = canonical;
    const provider = knownAtsProvider(canonical);
    if (provider && checkAts && isTrustedAtsUrl(canonical)) {
      const mapping = parseDirectBoardMapping(provider, canonical, {
        firstPartyEvidenceUrl: atsMappingEvidenceUrl ?? sourceUrl,
      });
      if (mapping && !directAttempted.has(mapping.evidenceUrl)) {
        directAttempted.add(mapping.evidenceUrl);
        const direct = await fetchDirectEmployerBoard(
          organisationName,
          provider,
          canonical,
          {
            deadlineMs,
            firstPartyEvidenceUrl: atsMappingEvidenceUrl ?? sourceUrl,
          },
        );
        if (direct.mapping && (direct.complete || direct.adverts.length > 0)) {
          const directAdverts = normaliseAndDedupeBoardAdverts(direct.adverts);
          addAtsDiagnostic(
            diagnostics,
            direct.mapping.provider,
            direct.mapping.evidenceUrl,
            atsMappingEvidenceUrl ?? sourceUrl,
            true,
            true,
            null,
          );
          diagnostics.directSourceKind = "ats_feed";
          diagnostics.careersPageFound = true;
          diagnostics.careersUrl = direct.mapping.evidenceUrl;
          diagnostics.pagesCrawled += direct.pagesFetched;
          diagnostics.pagesAttempted = pagesAttempted + direct.pagesFetched;
          return {
            adverts: directAdverts,
            sourceUrl,
            careersUrl: direct.mapping.evidenceUrl,
            atsProvider: direct.mapping.provider,
            atsMappingVerified: true,
            atsMappingEvidenceUrl,
            genericCompleted,
            atsCompleted: direct.complete,
            transientFailure: direct.transientFailure,
            failureClass: direct.failureClass,
            retryAt: direct.retryAt,
            error: direct.error,
            pagesFetched: pagesFetched + direct.pagesFetched,
            completion: direct.complete ? "complete" : "failed",
            pagesAttempted: pagesAttempted + direct.pagesFetched,
            advertsExtracted: direct.advertsExtracted,
            advertsRejected: Math.max(0, direct.advertsExtracted - directAdverts.length),
            rejectionReasons,
            discoveredUrls: [...discoveredUrls, direct.mapping.feedUrl],
            observedAdvertUrls: directAdverts.map((advert) => advert.url),
            snapshotScope: direct.complete && AUTHORITATIVE_SNAPSHOT_PROVIDERS.has(direct.mapping.provider)
              ? { provider: direct.mapping.provider, boardId: direct.mapping.boardId }
              : undefined,
            resumeState: null,
            diagnostics,
          };
        }
        // A trusted feed can be temporarily unavailable. Try its already-linked
        // HTML page without granting trust to any unrelated ATS board.
      }
    }
    const result = await fetchCompanySitePage(canonical, originHostname, deadlineMs);
    const fetchDiagnostic: CompanySiteFetchDiagnostic = {
      url: canonical,
      fetchedUrl: result.ok ? result.url : null,
      status: result.ok ? result.status : result.status ?? null,
      fetched: result.ok,
      failureKind: result.ok ? null : result.kind,
      reason: result.ok ? null : result.reason.slice(0, 500),
    };
    diagnostics.pageFetches.push(fetchDiagnostic);
    diagnostics.pagesAttempted = pagesAttempted;
    if (!result.ok) {
      if (isHomepageRequest) {
        diagnostics.homepageFetched = false;
        diagnostics.homepageHttpStatus = result.status ?? null;
      }
      if (result.kind === "robots") {
        diagnostics.robotsResult = result.reason.toLowerCase().includes("could not be checked")
          ? `unable to verify: ${result.reason}`
          : `blocked: ${result.reason}`;
      } else if (diagnostics.robotsResult === "not checked" && result.status !== undefined) {
        diagnostics.robotsResult = "allowed for this path; the HTTP response was received";
      }
      if (isKnownCareersRequest || canonical === diagnostics.careersUrl) {
        diagnostics.careersHttpStatus = result.status ?? null;
        diagnostics.careersFailureKind = result.kind;
      }
      const optionalSitemapUnavailable =
        SITEMAP_SIGNAL.test(canonical) &&
        (result.kind === "robots" ||
          result.status === 403 ||
          result.status === 404 ||
          result.status === 410);
      const optionalCareersPathAbsent =
        (result.status === 404 || result.status === 410) &&
        COMMON_CAREERS_PATHS.some((path) =>
          (canonicalVacancyUrl(new URL(path, sourceUrl).toString()) ?? new URL(path, sourceUrl).toString()) === canonical,
        );
      if (optionalSitemapUnavailable) {
        diagnostics.sitemapChecked = true;
        if (queue.length === 0 && adverts.length === 0) enqueueCommonCareersPaths();
        continue;
      }
      if (optionalCareersPathAbsent) continue;
      attemptedPageFailure = true;
      error ??= result.reason;
      retryAt ??= result.retryAt;
      const failureClass =
        result.failureClass ??
        classifyCompanySiteFailure({
          kind: result.kind,
          reason: result.reason,
          status: result.status,
        });
      permanentFailure ||= failureClass === "permanent";
      temporaryFailure ||= failureClass === "temporary";
      transientFailure ||= failureClass === "temporary";
      continue;
    }
    pagesFetched += 1;
    diagnostics.pagesCrawled = pagesFetched;
    if (isHomepageRequest) {
      diagnostics.homepageFetched = true;
      diagnostics.homepageHttpStatus = result.status;
    }
    if (diagnostics.robotsResult === "not checked") {
      diagnostics.robotsResult = "allowed for fetched URL paths (robots policy passed)";
    }
    if (isKnownCareersRequest || canonical === diagnostics.careersUrl) {
      diagnostics.careersHttpStatus = result.status;
      diagnostics.careersFailureKind = null;
    }
    const sitemapDocument = isSitemapDocument(result.body, result.contentType);
    if (!/html|text|xml/i.test(result.contentType) && !sitemapDocument) continue;
    if (provider) {
      atsProvider ??= provider;
      careersUrl ??= result.url;
      atsCompleted = true;
    } else {
      genericCompleted = true;
    }

    if (sitemapDocument) {
      diagnostics.sitemapChecked = true;
      if (!diagnostics.sitemapDocuments.includes(result.url)) {
        diagnostics.sitemapDocuments.push(result.url);
      }
      seenSitemaps.add(canonicalVacancyUrl(result.url) ?? result.url);
      const sitemapLinks = extractSitemapLinks(result.body, result.url, originHostname);
      const sameSiteSitemaps = sitemapLinks.nestedSitemaps
        .filter((url) => isFirstPartyHost(originHostname, new URL(url).hostname))
        .filter((url) => !seenSitemaps.has(canonicalVacancyUrl(url) ?? url))
        .sort((a, b) =>
          sitemapIndexPriority(b) - sitemapIndexPriority(a) || a.localeCompare(b),
        )
        .slice(0, Math.max(0, MAX_SITEMAP_CHILDREN_PER_EMPLOYER - sitemapChildCount));
      for (const url of sameSiteSitemaps) {
        sitemapChildCount += 1;
        enqueue(url);
      }
      const jobUrls = sitemapLinks.urls
        .filter((url) => isFirstPartyHost(originHostname, new URL(url).hostname))
        .filter(isLikelySitemapVacancyUrl)
        .sort((a, b) => sitemapUrlPriority(b) - sitemapUrlPriority(a))
        .slice(0, MAX_SITEMAP_URLS_PER_DOCUMENT);
      for (const url of jobUrls) {
        if (diagnostics.linksConsidered.length < MAX_DIAGNOSTIC_LINKS) {
          addLinkDiagnostic(diagnostics, {
            url,
            sourceUrl: result.url,
            text: "Sitemap URL",
            category: "careers",
            decision: "queued",
            reason: null,
            atsProvider: detectedAtsProvider(url),
          });
        }
        diagnostics.careersPageFound = true;
        diagnostics.careersUrl ??= url;
      }
      prioritizeEnqueue(jobUrls);
      continue;
    }

    const links = extractAnchors(result.body, result.url, originHostname, diagnostics, rejectionReasons);
    const pageIsFirstParty =
      knownAtsProvider(new URL(result.url).hostname) === null &&
      isFirstPartyHost(originHostname, new URL(result.url).hostname);
    const officialAtsLink = pageIsFirstParty
      ? links.find(isRecruitmentAtsLink)
      : undefined;
    if (officialAtsLink?.atsProvider) {
      addTrustedAtsUrl(officialAtsLink.url);
      atsMappingVerified = true;
      atsMappingEvidenceUrl = result.url;
      careersUrl = officialAtsLink.url;
      atsProvider = officialAtsLink.atsProvider;
      diagnostics.careersPageFound = true;
      diagnostics.careersUrl = officialAtsLink.url;
      addAtsDiagnostic(
        diagnostics,
        officialAtsLink.atsProvider,
        officialAtsLink.url,
        result.url,
        true,
        false,
        "linked from the approved first-party website",
      );
    }
    const jsonLdFound = hasJsonLdJobPosting(result.body);
    const microdataFound = /itemscope\b[^>]*itemtype\s*=\s*["'][^"']*schema\.org\/JobPosting|itemtype\s*=\s*["'][^"']*schema\.org\/JobPosting[^>]*itemscope/i
      .test(result.body);
    diagnostics.jsonLdJobPostingFound ||= jsonLdFound;
    diagnostics.microdataJobPostingFound ||= microdataFound;
    diagnostics.explicitNoVacancies ||= explicitNoVacancyText(result.body);
    diagnostics.jsRenderedJobsLikely ||= likelyJsRenderedJobs(result.body);
    const currentPath = new URL(result.url).pathname;
    const currentPageIsCareer = Boolean(provider) ||
      CAREERS_SIGNAL.test(currentPath) ||
      CAREER_LISTING_HEADING.test(pageHeadingText(result.body));
    if (currentPageIsCareer) {
      diagnostics.careersPageFound = true;
      if (!diagnostics.careersUrl || diagnostics.careersUrl === options.knownCareersUrl) {
        diagnostics.careersUrl = result.url;
      }
      diagnostics.careersHttpStatus ??= result.status;
    }
    const pageAdverts = [
      ...extractJsonLdAdverts(result.body, result.url, originHostname, organisationName),
      ...extractMicrodataAdverts(result.body, result.url, originHostname, organisationName),
      ...advertsFromLinks(
        links,
        organisationName,
        provider,
        result.url,
        result.body,
        rejectionReasons,
      ),
    ];
    adverts.push(...pageAdverts);
    const acceptedLinkUrls = new Set(pageAdverts.map((advert) => advert.url));
    for (const link of links) {
      if (!link.diagnostic || link.diagnostic.decision !== "queued") continue;
      if (acceptedLinkUrls.has(link.url)) {
        link.diagnostic.decision = "vacancy_evidence";
        link.diagnostic.reason = "accepted as a vacancy link from company-site evidence";
      }
    }
    if (jsonLdFound || microdataFound || pageAdverts.length > 0) {
      if (!diagnostics.vacancyLikePages.includes(result.url)) diagnostics.vacancyLikePages.push(result.url);
    }
    for (const link of links) {
      if (!link.diagnostic || link.diagnostic.decision !== "queued") continue;
      if (isCareersDestinationLink(link)) {
        diagnostics.careersPageFound = true;
        if (!diagnostics.careersUrl || diagnostics.careersUrl === options.knownCareersUrl) {
          diagnostics.careersUrl = link.url;
        }
      } else if (link.atsProvider) {
        const ats = diagnostics.atsLinksSeen.find(
          (entry) => entry.provider === link.atsProvider && entry.url === link.url,
        );
        if (ats && pageIsFirstParty) {
          ats.linkedFromFirstParty = true;
        }
      } else if (isSpecificRoleLink(link)) {
        link.diagnostic.decision = "not_followed";
        link.diagnostic.reason = acceptedLinkUrls.has(link.url)
          ? "posting link retained as vacancy evidence; detail page was not fetched"
          : "posting link did not pass vacancy evidence checks";
      } else {
        link.diagnostic.decision = "not_followed";
        link.diagnostic.reason = "not selected as a careers or recruitment navigation destination";
      }
    }
    const navigation = selectNavigationLinks(
      links,
      visited,
      provider,
      result.url,
      acceptedLinkUrls,
    );
    for (const link of navigation) {
      if (queue.length >= MAX_RESUMABLE_CRAWL_URLS) break;
      if (link.atsProvider && !checkAts) continue;
      if (link.atsProvider) {
        if (pageIsFirstParty && isRecruitmentAtsLink(link)) {
          addTrustedAtsUrl(link.url);
          atsMappingVerified = true;
          atsMappingEvidenceUrl = result.url;
        } else if (!isTrustedAtsUrl(link.url)) {
          continue;
        }
      }
      if (link.diagnostic) {
        link.diagnostic.decision = "queued";
        link.diagnostic.reason = null;
      }
      if (link.atsProvider) {
        addAtsDiagnostic(
          diagnostics,
          link.atsProvider,
          link.url,
          result.url,
          pageIsFirstParty,
          true,
          null,
        );
      }
      if (!careersUrl || link.atsProvider) careersUrl = link.url;
      atsProvider ??= link.atsProvider;
      enqueue(link.url);
    }

    // Many employer sites expose jobs only in a sitemap and have no usable
    // careers link in their HTML navigation. Add this only after normal
    // navigation is exhausted and no advert has been found, so it does not
    // displace a known ATS page or cause unnecessary requests.
    if (
      provider === null &&
      queue.length === 0 &&
      adverts.length === 0 &&
      !sitemapQueued
    ) {
      sitemapQueued = true;
      enqueue(sitemapUrl);
    } else if (
      provider === null &&
      queue.length === 0 &&
      adverts.length === 0 &&
      sitemapQueued
    ) {
      // A healthy homepage or sitemap may expose no careers link. Probe only
      // common first-party paths, within the existing page/deadline limits.
      enqueueCommonCareersPaths();
    }
  }

  if (genericCompleted && !atsProvider) atsCompleted = true;
  if (now() >= deadlineMs && queue.length > 0) {
    transientFailure = true;
    temporaryFailure = true;
    error ??= "employer request budget exhausted";
  }

  const normalizedAdverts = normaliseAndDedupeBoardAdverts(adverts);
  const completion =
    attemptedPageFailure && !transientFailure
      ? "failed"
      : transientFailure
        ? (now() >= deadlineMs ? "partial_deadline" : "failed")
        : queue.length > 0
          ? (now() >= deadlineMs ? "partial_deadline" : "partial_page_limit")
          : "complete";
  return {
    adverts: normalizedAdverts,
    sourceUrl,
    careersUrl,
    atsProvider,
    atsMappingVerified,
    atsMappingEvidenceUrl,
    genericCompleted,
    atsCompleted,
    transientFailure,
    failureClass:
      temporaryFailure
        ? "temporary"
        : permanentFailure
          ? "permanent"
          : completion !== "complete"
            ? "temporary"
            : null,
    retryAt,
    error,
    pagesFetched,
    completion,
    pagesAttempted,
    advertsExtracted: adverts.length,
    advertsRejected: Math.max(0, adverts.length - normalizedAdverts.length) +
      Object.values(rejectionReasons).reduce((sum, count) => sum + count, 0),
    rejectionReasons: {
      ...rejectionReasons,
      ...(adverts.length > normalizedAdverts.length
        ? { normalization_or_duplicate: adverts.length - normalizedAdverts.length }
        : {}),
    },
    discoveredUrls,
    observedAdvertUrls: [...new Set(adverts.map((advert) => advert.url))],
    resumeState: completion === "complete"
      ? null
      : {
          queue: queue.slice(0, MAX_RESUMABLE_CRAWL_URLS),
          visited: [...visited].slice(-MAX_RESUMABLE_CRAWL_URLS),
          sitemapQueued,
          careersUrl,
          atsProvider,
        },
    diagnostics: {
      ...diagnostics,
      pagesCrawled: pagesFetched,
      pagesAttempted,
    },
  };
}

export async function persistCompanySiteVacancies(
  adverts: readonly BoardAdvert[],
  options: { queueVerifications?: boolean; requireExisting?: boolean } = {},
): Promise<{ inserted: number; updated: number; revived: number }> {
  return upsertSharedBoardVacancies(adverts, options);
}