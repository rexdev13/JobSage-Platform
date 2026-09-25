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
import { fetchDirectEmployerBoard } from "./directEmployerBoardConnectors";

export const MAX_COMPANY_SITE_DISCOVERY_PAGES = 6;
// The crawl remains bounded by pages, response bytes, host pacing and the
// employer deadline. Do not silently discard valid jobs after extraction.
export const MAX_COMPANY_SITE_VACANCIES_PER_EMPLOYER = Number.POSITIVE_INFINITY;
const MAX_RESUMABLE_CRAWL_URLS = 100;

const CAREERS_SIGNAL = /\b(career|careers|job|jobs|vacanc|vacancies|open positions|opportunities|join (?:our|the) team|work (?:for|with) us)\b/i;
const VACANCY_SIGNAL =
  /\b(jobs?|vacanc(?:y|ies)|positions?|roles?|opportunit(?:y|ies)|openings?|apply)\b/i;
const NAVIGATION_MARKER =
  /(?:^|[\s"'_-])(?:nav|navigation|menu|subnav|sub-menu|submenu|tabs?|tablist|breadcrumb)(?:$|[\s"'_-])/i;
const GENERIC_ANCHOR_TEXT = /^(apply|apply now|view|view job|view vacancy|details|more|read more|learn more|job details)$/i;
const NON_SPECIFIC_BAMBOOHR_TITLE =
  /^(?:join\s+(?:our|the)\s+)?(?:talent\s+pool|team)$/i;
const NEGATIVE_CONTENT_PATH = /\/(?:news|blog|press|media|about|insights)(?:\/|$)/i;
const CAREER_CONTENT_TOPIC =
  /\b(?:our culture|workplace culture|our values|our benefits|our team|our people|meet (?:our|the) team|employee stories|life at|working here|talent community|talent pool|register (?:your )?interest|diversity and inclusion)\b/i;
const CAREER_RECRUITMENT_CONTEXT =
  /\b(?:job|vacanc(?:y|ies)|role|position|hiring|recruit(?:ment|er)|apply|current openings?|open roles?)\b/i;
const CAREER_LISTING_HEADING =
  /\b(?:current|open|available|search|browse)\s+(?:jobs?|vacanc(?:y|ies)|positions?|roles?|openings?)\b|\b(?:we(?:'re| are) hiring|job openings|no current vacancies)\b/i;
const PAGINATION_SIGNAL = /\b(next|more jobs|older jobs|page\s*\d+)\b/i;
const SITEMAP_SIGNAL = /(?:^|\/)sitemap(?:[_-][^/]+)?\.xml(?:$|\?)/i;
const SITEMAP_LOC_PATTERN = /<loc\b[^>]*>\s*([\s\S]*?)\s*<\/loc>/gi;

type ExtractedLink = {
  url: string;
  text: string;
  atsProvider: string | null;
  contextText: string;
  inNavigation: boolean;
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
  resumeState: CompanySiteDiscoveryOptions["resumeState"];
};

export type CompanySiteDiscoveryOptions = {
  knownCareersUrl?: string | null;
  knownCareersMappingVerified?: boolean;
  knownCareersEvidenceUrl?: string | null;
  checkGeneric?: boolean;
  checkAts?: boolean;
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

function isGenericCareersContent(value: string): boolean {
  const text = textFromHtml(value);
  return CAREER_CONTENT_TOPIC.test(text) &&
    !/\b(?:job|vacanc(?:y|ies)|position|role|opening|apply|recruitment)\b/i.test(text);
}

function isCareersDestinationLink(link: ExtractedLink): boolean {
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
  const structuredJobPosting = /"@type"\s*:\s*(?:"JobPosting"|\[[^\]]*"JobPosting")/i.test(html);
  const explicitListingHeading = CAREER_LISTING_HEADING.test(heading);
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

function extractAnchors(html: string, baseUrl: string, originHostname: string): ExtractedLink[] {
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
    if (seen.has(canonical) || !isAllowedCompanyDestination(originHostname, canonical)) continue;
    if (isBlockedVacancyUrl(canonical)) continue;
    seen.add(canonical);
    const context = anchorContext(html, match.index ?? 0, (match.index ?? 0) + match[0].length);
    const anchorNavigationMarkup = [...(match[0] ?? "").matchAll(/<[a-z][^>]*>/gi)]
      .some((tagMatch) => NAVIGATION_MARKER.test(tagMatch[0] ?? ""));
    links.push({
      url: canonical,
      text: textFromHtml(match[2] ?? ""),
      atsProvider: knownAtsProvider(canonical),
      contextText: context.text,
      inNavigation: context.inNavigation || anchorNavigationMarkup,
    });
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
): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(SITEMAP_LOC_PATTERN)) {
    const raw = decodeHtml(match[1] ?? "").trim();
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
    links.push(canonical);
  }
  return links;
}

function isSitemapDocument(body: string, contentType: string): boolean {
  return /xml/i.test(contentType) || /<(?:urlset|sitemapindex)\b/i.test(body);
}

function isLikelySitemapVacancyUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      SITEMAP_SIGNAL.test(url) ||
      VACANCY_SIGNAL.test(`${parsed.pathname} ${parsed.search}`)
    );
  } catch {
    return false;
  }
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
  return links.flatMap((link) => {
    if (!isValidVacancyDeepLink(link.url)) return reject("invalid_deep_link");
    const opaqueAtsPosting = isOpaqueAtsPostingLink(
      link,
      listingPageProvider,
      listingPageUrl,
    );
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
): ExtractedLink[] {
  return links
    .filter((link) => !visited.has(link.url))
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

export async function discoverCompanySiteVacancies(
  organisationName: string,
  website: string,
  options: CompanySiteDiscoveryOptions = {},
): Promise<CompanySiteDiscoveryResult> {
  const sourceUrl = normaliseSponsorWebsite(website);
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
    };
  }
  const rejectionReasons: Record<string, number> = {};
  const now = options.now ?? Date.now;
  const deadlineMs = Math.min(
    options.deadlineMs ?? Number.POSITIVE_INFINITY,
    now() + COMPANY_SITE_EMPLOYER_BUDGET_MS,
  );
  const originHostname = new URL(sourceUrl).hostname;
  const checkGeneric = options.checkGeneric !== false;
  const checkAts = options.checkAts !== false;
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
      { deadlineMs },
    );
    if (direct.mapping) {
      const directAdverts = normaliseAndDedupeBoardAdverts(direct.adverts);
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
        // A direct-board failure is retried from the feed on the next run.
        // Never hand an API endpoint to the HTML crawler as resumable state.
        resumeState: null,
      };
    }
  }
  const queue: string[] = [];
  const visited = new Set<string>();
  const queued = new Set<string>();
  const trustedAtsUrls = new Set<string>();
  const trustedAtsBoardScopes = new Set<string>();
  const sitemapUrl = new URL("/sitemap.xml", sourceUrl).toString();
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
  if (options.resumeState) {
    for (const url of options.resumeState.queue.slice(0, MAX_RESUMABLE_CRAWL_URLS)) {
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
    const provider = knownAtsProvider(canonical);
    const result = await fetchCompanySitePage(canonical, originHostname, deadlineMs);
    if (!result.ok) {
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
      const sitemapLinks = extractSitemapLinks(result.body, result.url, originHostname)
        .filter((url) => isLikelySitemapVacancyUrl(url))
        .slice(0, 20);
      for (const url of sitemapLinks) enqueue(url);
      continue;
    }

    const links = extractAnchors(result.body, result.url, originHostname);
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
    }
    adverts.push(
      ...extractJsonLdAdverts(result.body, result.url, originHostname, organisationName),
      ...advertsFromLinks(
        links,
        organisationName,
        provider,
        result.url,
        result.body,
        rejectionReasons,
      ),
    );
    const navigation = selectNavigationLinks(links, visited, provider, result.url);
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
  };
}

export async function persistCompanySiteVacancies(
  adverts: readonly BoardAdvert[],
  options: { queueVerifications?: boolean } = {},
): Promise<{ inserted: number; updated: number; revived: number }> {
  return upsertSharedBoardVacancies(adverts, options);
}