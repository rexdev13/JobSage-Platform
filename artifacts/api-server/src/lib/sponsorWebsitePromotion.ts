export type SponsorWebsitePromotionDecision =
  | "auto_promote"
  | "review_required"
  | "reject";

export type SponsorWebsitePromotionInput = {
  organisationName: string;
  townCity: string | null;
  candidateWebsite: string | null;
  evidenceUrl: string | null;
  originalConfidence: "high" | "medium" | "low" | "none";
  sourceType: string | null;
  fetched: boolean;
  pageUrl: string | null;
  pageTitle: string | null;
  pageExcerpt: string | null;
  candidateSnippet: string | null;
  identityVerified: boolean;
  geographyMismatch: boolean;
  existingWebsiteUrls: string[];
  existingCareersUrls: string[];
  existingAtsMappingStatuses: Array<"verified" | "unverified" | "invalid" | null>;
  atsLeadUnverified: boolean;
  sponsorLicenceIds: number[];
};

export type SponsorWebsitePromotionResult = {
  promotionDecision: SponsorWebsitePromotionDecision;
  decisionReason: string;
  domainMatchScore: number;
  identityMatchEvidence: string | null;
  geographyCheck: "match" | "mismatch" | "missing";
  blockedHostCheck: string;
  existingDataConflictCheck: string;
};

const LEGAL_SUFFIXES =
  /\b(?:limited|ltd|plc|llp|lp|incorporated|inc|corporation|corp|company|co)\b\.?/gi;
const BRAND_STOP_WORDS = new Set([
  "a", "an", "and", "at", "by", "co", "company", "for", "group", "health",
  "healthcare", "home", "homes", "inc", "incorporated", "limited", "ltd",
  "medical", "nursing", "of", "plc", "service", "services", "solution",
  "solutions", "the", "to", "uk", "llp", "lp", "care", "centre", "center",
  "clinic", "clinics", "practice", "practices", "restaurant", "restaurants",
  "hotel", "hotels", "newsagent", "newsagents", "retail", "construction",
  "engineering", "textiles", "products",
  "indian", "precision",
]);
const THIRD_PARTY_SOURCE_TYPES = new Set([
  "social",
  "directory",
  "aggregator",
  "job_board",
  "supported_ats",
  "unsupported_ats",
]);
const BLOCKED_HOSTS = [
  "autumna.co.uk",
  "carehome.co.uk",
  "cqc.org.uk",
  "companieshouse.gov.uk",
  "crunchbase.com",
  "cutshort.io",
  "facebook.com",
  "find-and-update.company-information.service.gov.uk",
  "glassdoor.com",
  "harri.com",
  "indeed.com",
  "instagram.com",
  "linkedin.com",
  "nhs.uk",
  "nhs.net",
  "reed.co.uk",
  "tracxn.com",
  "twitter.com",
  "x.com",
  "yellowpages.com",
  "yell.com",
];
const BLOCKED_ATS_HOSTS = [
  "ashbyhq.com",
  "bamboohr.com",
  "breezy.hr",
  "greenhouse.io",
  "icims.com",
  "jobvite.com",
  "lever.co",
  "myworkdayjobs.com",
  "oraclecloud.com",
  "personio.com",
  "pinpointhq.com",
  "recruitee.com",
  "smartrecruiters.com",
  "successfactors.com",
  "taleo.net",
  "teamtailor.com",
  "workable.com",
];
const UK_LOCATION_MARKERS =
  /\b(?:united kingdom|great britain|england|scotland|wales|northern ireland|uk)\b/i;
const UK_POSTCODE_MARKER =
  /\b(?:GIR\s?0AA|(?:[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}))\b/i;
const MULTI_PART_PUBLIC_SUFFIXES = new Set([
  "ac.uk",
  "co.uk",
  "gov.uk",
  "ltd.uk",
  "me.uk",
  "net.uk",
  "org.uk",
  "plc.uk",
  "com.au",
  "co.nz",
  "com.sg",
]);

function normaliseName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en-GB")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function brandName(organisationName: string): string {
  const tradingName =
    organisationName.match(/\b(?:t\/a|trading\s+as)\s+(.+)$/i)?.[1] ??
    organisationName;
  return normaliseName(tradingName.replace(LEGAL_SUFFIXES, " "));
}

function hostFromUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function rootDomain(host: string): string {
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const suffix = labels.slice(-2).join(".");
  const suffixLength = MULTI_PART_PUBLIC_SUFFIXES.has(suffix) ? 2 : 1;
  return labels.slice(-(suffixLength + 1)).join(".");
}

function domainBody(host: string): string {
  const rootLabels = rootDomain(host).split(".").filter(Boolean);
  const suffix = rootLabels.slice(-2).join(".");
  const suffixLength = MULTI_PART_PUBLIC_SUFFIXES.has(suffix) ? 2 : 1;
  return rootLabels.slice(0, -suffixLength).join(".");
}

function hostnameMatchesBlocklist(host: string, entries: string[]): string | null {
  return entries.find((entry) => host === entry || host.endsWith(`.${entry}`)) ?? null;
}

export function scoreSponsorWebsiteDomainMatch(
  organisationName: string,
  candidateWebsite: string | null,
): number {
  const host = hostFromUrl(candidateWebsite);
  if (!host) return 0;
  const domain = domainBody(host)
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const compactDomain = domain.replace(/[^a-z0-9]/g, "");
  const brand = brandName(organisationName);
  const compactBrand = brand.replace(/[^a-z0-9]/g, "");

  if (compactBrand.length >= 4 && compactDomain.includes(compactBrand)) return 100;

  const brandTokens = brand
    .split(" ")
    .filter((token) =>
      (token.length >= 3 || /^\d+$/.test(token)) &&
      !BRAND_STOP_WORDS.has(token),
    );
  if (brandTokens.length === 0) return 0;
  const meaningfulBrand = brandTokens.join("");
  if (meaningfulBrand.length >= 4 && compactDomain.includes(meaningfulBrand)) {
    return brandTokens.length >= 2 ? 100 : brandTokens[0]!.length >= 5 ? 90 : 0;
  }
  const domainTokens = domain.split(/\s+/).filter(Boolean);
  const compactDomainOnly = domainTokens.length <= 1;
  const matchedCount = brandTokens.filter((token) =>
    domainTokens.includes(token) ||
    (compactDomainOnly && token.length >= 6 && compactDomain.includes(token)),
  ).length;
  const coverage = matchedCount / brandTokens.length;
  if (matchedCount === 1 && brandTokens.length === 1 && brandTokens[0]!.length >= 6) {
    return 90;
  }
  return Math.round(coverage * 100);
}

function geographyEvidence(
  input: SponsorWebsitePromotionInput,
): "match" | "mismatch" | "missing" {
  if (input.geographyMismatch) return "mismatch";
  const evidence = [
    input.pageTitle ?? "",
    input.pageExcerpt ?? "",
    input.candidateSnippet ?? "",
  ].join(" ");
  const town = input.townCity?.trim();
  if (town) {
    const escaped = town.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(evidence)) return "match";
  }
  return UK_LOCATION_MARKERS.test(evidence) || UK_POSTCODE_MARKER.test(evidence)
    ? "match"
    : "missing";
}

function isSecureAndSameSite(input: SponsorWebsitePromotionInput): boolean {
  if (!input.candidateWebsite || !input.evidenceUrl || !input.pageUrl) return false;
  try {
    const website = new URL(input.candidateWebsite);
    const evidence = new URL(input.evidenceUrl);
    const page = new URL(input.pageUrl);
    if (
      website.protocol !== "https:" ||
      evidence.protocol !== "https:" ||
      page.protocol !== "https:" ||
      website.username ||
      website.password ||
      evidence.username ||
      evidence.password
    ) return false;
    const expectedRoot = rootDomain(website.hostname.toLowerCase().replace(/^www\./, ""));
    return [evidence.hostname, page.hostname].every((candidateHost) => {
      const candidateRoot = rootDomain(candidateHost.toLowerCase().replace(/^www\./, ""));
      return candidateRoot === expectedRoot;
    });
  } catch {
    return false;
  }
}

function getBlockedHostCheck(input: SponsorWebsitePromotionInput): string {
  const sourceType = input.sourceType?.toLowerCase() ?? "";
  if (THIRD_PARTY_SOURCE_TYPES.has(sourceType)) {
    return `blocked source type: ${sourceType}`;
  }
  const host = hostFromUrl(input.candidateWebsite);
  if (!host) return "not checked: candidate URL missing or invalid";
  const blocked = hostnameMatchesBlocklist(host, BLOCKED_HOSTS);
  if (blocked) return `blocked host: ${blocked}`;
  const atsHost = hostnameMatchesBlocklist(host, BLOCKED_ATS_HOSTS);
  if (atsHost) return `blocked third-party ATS host: ${atsHost}`;
  if (host.endsWith(".gov.uk") || host === "gov.uk") return "blocked government registry host";
  if (!["official_site", "stored_website", "careers"].includes(sourceType)) {
    return `unclear source type: ${sourceType || "missing"}`;
  }
  return "clear";
}

function getExistingDataConflictCheck(input: SponsorWebsitePromotionInput): {
  hasConflict: boolean;
  detail: string;
} {
  const candidateHost = hostFromUrl(input.candidateWebsite);
  const existingHosts = [...new Set(
    input.existingWebsiteUrls
      .map((url) => hostFromUrl(url))
      .filter((host): host is string => host !== null),
  )];
  const malformedExisting = input.existingWebsiteUrls.some((url) => !hostFromUrl(url));
  const conflictingHosts = candidateHost
    ? existingHosts.filter((host) => rootDomain(host) !== rootDomain(candidateHost))
    : existingHosts;
  const hasConflict = malformedExisting || conflictingHosts.length > 0;
  const careers = [...new Set(input.existingCareersUrls.filter(Boolean))];
  const verifiedAtsCount = input.existingAtsMappingStatuses.filter(
    (status) => status === "verified",
  ).length;
  const preserved = [
    careers.length ? `${careers.length} existing careers URL(s) preserved` : "careers data unchanged",
    verifiedAtsCount ? `${verifiedAtsCount} verified ATS mapping(s) preserved` : "ATS data unchanged",
  ].join("; ");
  const websites = existingHosts.length
    ? `existing website host(s): ${existingHosts.join(", ")}`
    : "existing website is blank";
  return {
    hasConflict,
    detail: hasConflict
      ? `conflict: ${websites}; candidate host: ${candidateHost ?? "missing"}; ${preserved}`
      : `no website conflict: ${websites}; importer updates blank website fields only; ${preserved}`,
  };
}

export function classifySponsorWebsitePromotion(
  input: SponsorWebsitePromotionInput,
): SponsorWebsitePromotionResult {
  const domainMatchScore = scoreSponsorWebsiteDomainMatch(
    input.organisationName,
    input.candidateWebsite,
  );
  const strongDomainMatch = domainMatchScore >= 80;
  const identityConfirmed = input.fetched && input.identityVerified;
  const identityMatchEvidence =
    input.fetched && input.identityVerified && input.pageUrl
      ? [
          `Fetched and identity-confirmed at ${input.pageUrl}`,
          input.pageTitle ? `Title: ${input.pageTitle}` : null,
          input.pageExcerpt?.trim() || null,
        ].filter(Boolean).join(" — ").slice(0, 900)
      : null;
  const geographyCheck = geographyEvidence(input);
  const blockedHostCheck = getBlockedHostCheck(input);
  const existingData = getExistingDataConflictCheck(input);
  const result = (
    promotionDecision: SponsorWebsitePromotionDecision,
    decisionReason: string,
  ): SponsorWebsitePromotionResult => ({
    promotionDecision,
    decisionReason,
    domainMatchScore,
    identityMatchEvidence,
    geographyCheck,
    blockedHostCheck,
    existingDataConflictCheck: existingData.detail,
  });

  if (!input.candidateWebsite || input.originalConfidence === "none") {
    return result("reject", "no confirmed website candidate in the audit");
  }
  if (blockedHostCheck.startsWith("blocked")) {
    return result("reject", blockedHostCheck);
  }
  if (blockedHostCheck.startsWith("unclear")) {
    return result("review_required", blockedHostCheck);
  }
  if (input.geographyMismatch) {
    return result("reject", "fetched page contains conflicting geography evidence");
  }
  if (!input.fetched) {
    return result("reject", "candidate page was not fetched successfully");
  }
  if (existingData.hasConflict) {
    return result("review_required", existingData.detail);
  }
  if (input.sponsorLicenceIds.length === 0) {
    return result("review_required", "no matching sponsor_licences row exists in development");
  }
  if (input.atsLeadUnverified) {
    return result("review_required", "an ATS lead exists but its employer mapping is unverified");
  }
  if (!strongDomainMatch && !identityConfirmed) {
    return result(
      "review_required",
      `neither a strong domain/brand match (${domainMatchScore}/100) nor page-confirmed employer identity was found`,
    );
  }
  if (!input.evidenceUrl || !isSecureAndSameSite(input)) {
    return result("review_required", "HTTPS page/evidence or same-site redirect could not be confirmed");
  }
  if (input.pageTitle && /\b(?:login|sign in|register|product gallery|photo gallery|blog)\b/i.test(input.pageTitle)) {
    return result("reject", "fetched page appears to be a login, registration, product, gallery, or blog page");
  }
  return result(
    "auto_promote",
    [
      strongDomainMatch ? `strong brand/domain match (${domainMatchScore}/100)` : null,
      identityConfirmed ? "fetched page confirms employer identity" : null,
      geographyCheck === "match" ? "location corroborated" : "no conflicting geography evidence",
      "HTTPS evidence is same-site",
    ].filter(Boolean).join("; "),
  );
}