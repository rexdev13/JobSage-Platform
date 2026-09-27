import type { PageResult } from "./sponsor-contact-discovery/http";

export type WebsiteCandidate = {
  url: string;
  domain: string;
  source: string;
  evidenceUrl: string;
};

export type WebsiteIdentityAssessment = {
  accepted: boolean;
  confidence: "high" | "medium" | "none";
  potential: boolean;
  reason: string;
};

const BLOCKED_HOSTS = [
  "facebook.com",
  "linkedin.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "tiktok.com",
  "wikipedia.org",
  "sponsorlist.co.uk",
  "yell.com",
  "thomsonlocal.com",
  "192.com",
  "opencorporates.com",
  "dnb.com",
  "endole.co.uk",
  "companycheck.co.uk",
  "companieshouse.gov.uk",
  "find-and-update.company-information.service.gov.uk",
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "myworkdayjobs.com",
  "workday.com",
  "smartrecruiters.com",
  "personio.com",
  "recruitee.com",
  "workable.com",
  "bamboohr.com",
  "icims.com",
  "jobvite.com",
  "taleo.net",
  "oraclecloud.com",
  "successfactors.com",
  "dayforcehcm.com",
  "teamtailor.com",
  "pinpointhq.com",
  "applytojob.com",
  "indeed.com",
  "reed.co.uk",
  "totaljobs.com",
];

const FREE_EMAIL_HOSTS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "fastmail.com",
]);

const GENERIC_IDENTITY_TOKENS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "the",
  "to",
  "uk",
  "united",
  "kingdom",
  "ltd",
  "limited",
  "plc",
  "llp",
  "llc",
  "inc",
  "incorporated",
  "company",
  "co",
  "group",
  "holdings",
  "holding",
  "services",
  "service",
  "solutions",
  "international",
  "global",
  "industries",
  "industry",
  "partners",
  "partnership",
  "associates",
  "health",
  "healthcare",
  "care",
  "medical",
  "clinic",
  "dental",
  "practice",
  "school",
  "college",
  "university",
  "engineering",
  "technology",
  "software",
  "transport",
  "construction",
  "hospitality",
  "retail",
  "finance",
  "legal",
  "professional",
  "manufacturing",
  "public",
]);

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeWebsiteName(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function hostnameIsBlocked(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  return BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

export function websiteCandidateFromValue(
  value: string,
  source: string,
  evidenceUrl = value,
): WebsiteCandidate | null {
  const raw = text(value);
  if (!raw) return null;
  let candidate = raw;
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(candidate)) candidate = `https://${candidate}`;

  try {
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username ||
      parsed.password ||
      !parsed.hostname.includes(".") ||
      parsed.hostname.includes("%") ||
      parsed.hostname === "localhost" ||
      hostnameIsBlocked(parsed.hostname)
    ) {
      return null;
    }

    const domain = parsed.hostname.toLowerCase().replace(/\.$/, "");
    return {
      url: `https://${domain}/`,
      domain,
      source,
      evidenceUrl: text(evidenceUrl) || raw,
    };
  } catch {
    return null;
  }
}

export function websiteCandidateFromEmail(
  email: string,
  source = "contact_email_domain",
): WebsiteCandidate | null {
  const match = text(email).match(/^[^@\s]+@([^@\s]+)$/);
  if (!match) return null;
  const domain = match[1]!.toLowerCase().replace(/\.$/, "");
  if (
    FREE_EMAIL_HOSTS.has(domain) ||
    domain.startsWith("mail.") ||
    domain.endsWith(".gov.uk") ||
    domain.endsWith(".nhs.uk") ||
    domain.endsWith(".ac.uk") ||
    domain.endsWith(".edu")
  ) {
    return null;
  }
  return websiteCandidateFromValue(domain, source, `mailto:${text(email)}`);
}

function identityNameGroups(value: string): string[][] {
  const aliases = value.split(
    /\b(?:t\s*\/\s*a|trading\s+as|also\s+known\s+as|a\.?k\.?a\.?)\b/iu,
  );
  return aliases
    .map((part) =>
      normalizeWebsiteName(part)
        .split(" ")
        .filter((token) => token.length >= 3 && !GENERIC_IDENTITY_TOKENS.has(token)),
    )
    .filter((tokens) => tokens.length > 0);
}

function visibleText(body: string): string {
  return body
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, " and ")
    .replace(/&(?:quot|#34);/gi, " ")
    .replace(/&#39;|&apos;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(normalizeWebsiteName(value).split(" ").filter(Boolean));
}

export function verifyOfficialWebsiteIdentity(
  source: Record<string, string>,
  page: PageResult,
): WebsiteIdentityAssessment {
  let hostname = "";
  try {
    hostname = new URL(page.url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return {
      accepted: false,
      confidence: "none",
      potential: false,
      reason: "invalid_evidence_url",
    };
  }

  const groups = identityNameGroups(text(source.organisation_name));
  const pageTokens = tokenSet(visibleText(page.body));
  const hostTokens = tokenSet(hostname.replace(/\./g, " "));
  const locationTokens = [
    source.town_city,
    source.county,
    source.region,
  ]
    .flatMap((value) => normalizeWebsiteName(text(value)).split(" "))
    .filter((token) => token.length >= 4 && !GENERIC_IDENTITY_TOKENS.has(token));

  let best: {
    pageMatches: string[];
    hostMatches: string[];
  } | null = null;

  for (const tokens of groups) {
    const pageMatches = tokens.filter((token) => pageTokens.has(token));
    const hostMatches = tokens.filter((token) => hostTokens.has(token));
    if (pageMatches.length === 0) continue;
    if (!best || pageMatches.length + hostMatches.length > best.pageMatches.length + best.hostMatches.length) {
      best = { pageMatches, hostMatches };
    }
  }

  if (!best) {
    return {
      accepted: false,
      confidence: "none",
      potential: false,
      reason: "no_distinctive_employer_name_token_on_first_party_page",
    };
  }

  const corroboratedLocation = locationTokens.some((token) => pageTokens.has(token));
  const enoughIdentity = best.hostMatches.length > 0 || best.pageMatches.length >= 2;
  if (!enoughIdentity) {
    return {
      accepted: false,
      confidence: "none",
      potential: true,
      reason: `only_one_name_token_on_page_without_hostname_match:${best.pageMatches[0]}`,
    };
  }

  return {
    accepted: true,
    confidence:
      corroboratedLocation || (best.hostMatches.length > 0 && best.pageMatches.length >= 2)
        ? "high"
        : "medium",
    potential: true,
    reason: [
      `name_tokens_on_page:${best.pageMatches.join("+")}`,
      best.hostMatches.length ? `name_tokens_on_host:${best.hostMatches.join("+")}` : "",
      corroboratedLocation ? "location_on_page" : "",
    ]
      .filter(Boolean)
      .join(";"),
  };
}

export function sponsorListWebsiteLead(
  source: Record<string, string>,
  payload: unknown,
): WebsiteCandidate | null {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as { sponsors?: unknown }).sponsors)) {
    return null;
  }

  const sourceName = normalizeWebsiteName(text(source.organisation_name));
  if (!sourceName) return null;
  const sourceLocations = [source.town_city, source.county, source.region]
    .map((value) => normalizeWebsiteName(text(value)))
    .filter(Boolean);
  const matches: WebsiteCandidate[] = [];

  for (const raw of (payload as { sponsors: unknown[] }).sponsors) {
    if (!raw || typeof raw !== "object") continue;
    const record = raw as {
      name?: unknown;
      city?: unknown;
      county?: unknown;
      url?: unknown;
      enrichment?: { website?: unknown };
    };
    if (normalizeWebsiteName(text(record.name)) !== sourceName) continue;

    const recordLocations = [record.city, record.county]
      .map((value) => normalizeWebsiteName(text(value)))
      .filter(Boolean);
    if (
      sourceLocations.length > 0 &&
      (recordLocations.length === 0 ||
        !sourceLocations.some((sourceLocation) =>
          recordLocations.some(
            (recordLocation) =>
              recordLocation === sourceLocation ||
              recordLocation.includes(sourceLocation) ||
              sourceLocation.includes(recordLocation),
          ),
        ))
    ) {
      continue;
    }

    let evidenceUrl = "";
    try {
      const parsedEvidence = new URL(text(record.url));
      if (
        parsedEvidence.protocol !== "https:" ||
        parsedEvidence.hostname.toLowerCase() !== "sponsorlist.co.uk" ||
        !parsedEvidence.pathname.startsWith("/sponsors/")
      ) {
        continue;
      }
      evidenceUrl = parsedEvidence.toString();
    } catch {
      continue;
    }

    const candidate = websiteCandidateFromValue(
      text(record.enrichment?.website),
      "SponsorList",
      evidenceUrl,
    );
    if (candidate) matches.push(candidate);
  }

  const distinctDomains = new Set(matches.map((candidate) => candidate.domain));
  if (distinctDomains.size !== 1) return null;
  return matches[0] ?? null;
}

export function extractBingWebsiteLeads(payload: unknown): WebsiteCandidate[] {
  if (!payload || typeof payload !== "object") return [];
  const webPages = (payload as { webPages?: { value?: unknown } }).webPages;
  if (!webPages || !Array.isArray(webPages.value)) return [];
  const candidates: WebsiteCandidate[] = [];
  for (const raw of webPages.value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as { url?: unknown };
    const candidate = websiteCandidateFromValue(text(item.url), "Bing");
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}