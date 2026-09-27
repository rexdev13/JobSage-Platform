import {
  normalizeWebsiteName,
  verifyOfficialWebsiteIdentity,
} from "./nonHealthcareWebsiteIdentity";
import type { PageResult } from "./sponsor-contact-discovery/http";

export type VerificationPageKind = "homepage" | "about" | "contact" | "careers";

export type VerificationPage = {
  kind: VerificationPageKind;
  page: PageResult;
};

export type FetchFailure = {
  url: string;
  message: string;
};

export type LiveIdentityAssessment = {
  verificationStatus: "upgraded" | "kept_medium" | "rejected" | "inconclusive";
  newConfidence: "high" | "medium" | "none";
  signalsMatched: string[];
  conflictsFound: string[];
  reason: string;
  pageAssessmentNotes: string[];
  structuredOrganizationNames: string[];
  pageEmailDomains: string[];
};

export type AnchorCandidate = {
  url: string;
  kind: Exclude<VerificationPageKind, "homepage">;
  label: string;
  score: number;
};

type StructuredEvidence = {
  names: string[];
  locations: string[];
  emailDomains: string[];
};

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, decimal: string) =>
      String.fromCodePoint(Number(decimal)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    );
}

function visibleText(body: string): string {
  return decodeHtml(
    body
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizedWebsiteHost(value: string): string {
  try {
    const raw = value.trim();
    const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  } catch {
    return "";
  }
}

function sameSite(hostname: string, baseHost: string): boolean {
  const host = normalizedWebsiteHost(hostname);
  const base = normalizedWebsiteHost(baseHost);
  return Boolean(
    host &&
      base &&
      (host === base || host.endsWith(`.${base}`) || base.endsWith(`.${host}`)),
  );
}

function linkKind(label: string, url: URL): AnchorCandidate["kind"] | null {
  const probe = normalizeWebsiteName(`${label} ${url.pathname}`);
  if (/\babout\b|our (company|story|business)|who we are/.test(probe)) return "about";
  if (/\bcontact\b|find us|our locations|location|address|reach us/.test(probe)) {
    return "contact";
  }
  if (
    /\bcareers?\b|\bjobs?\b|\bvacancies\b|work for us|join our team|recruitment/.test(
      probe,
    )
  ) {
    return "careers";
  }
  return null;
}

function linkScore(kind: AnchorCandidate["kind"], label: string, url: URL): number {
  const normalizedLabel = normalizeWebsiteName(label);
  const normalizedPath = normalizeWebsiteName(url.pathname);
  const kindWord = kind === "careers" ? /career|job|vacanc|recruit/ : new RegExp(kind);
  return (
    (kindWord.test(normalizedLabel) ? 4 : 0) +
    (kindWord.test(normalizedPath) ? 3 : 0) +
    (normalizedLabel.length > 0 ? 1 : 0)
  );
}

function canonicalPageUrl(value: string): string {
  const parsed = new URL(value);
  parsed.hash = "";
  parsed.search = "";
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return parsed.toString();
}

export function extractLinkedVerificationPages(
  homepage: PageResult,
  candidateDomain: string,
): AnchorCandidate[] {
  const candidates: AnchorCandidate[] = [];
  for (const match of homepage.body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const attributes = match[1] ?? "";
    const hrefMatch = attributes.match(
      /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i,
    );
    const rawHref = decodeHtml(hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? "").trim();
    if (!rawHref || /^(?:mailto:|tel:|javascript:|data:)/i.test(rawHref)) continue;
    const label = visibleText(match[2] ?? "");
    try {
      const url = new URL(rawHref, homepage.url);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        !sameSite(url.hostname, candidateDomain) ||
        /\.(?:pdf|docx?|xlsx?|pptx?|zip|png|jpe?g|gif|svg|webp|mp4|mp3)$/i.test(
          url.pathname,
        )
      ) {
        continue;
      }
      url.search = "";
      url.hash = "";
      const kind = linkKind(label, url);
      if (!kind || canonicalPageUrl(url.toString()) === canonicalPageUrl(homepage.url)) {
        continue;
      }
      candidates.push({
        url: url.toString(),
        kind,
        label: label.slice(0, 200),
        score: linkScore(kind, label, url),
      });
    } catch {
      // Ignore malformed links; no URL is inferred or searched for.
    }
  }

  const selected: AnchorCandidate[] = [];
  const seenUrls = new Set<string>();
  for (const kind of ["about", "contact", "careers"] as const) {
    const best = candidates
      .filter((candidate) => candidate.kind === kind)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.url.length - right.url.length ||
          left.url.localeCompare(right.url),
      )
      .find((candidate) => !seenUrls.has(canonicalPageUrl(candidate.url)));
    if (!best) continue;
    selected.push(best);
    seenUrls.add(canonicalPageUrl(best.url));
  }
  return selected;
}

function collectOrganizationObjects(value: unknown, output: Record<string, unknown>[], depth = 0): void {
  if (depth > 8 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectOrganizationObjects(item, output, depth + 1);
    return;
  }
  const record = value as Record<string, unknown>;
  const rawType = record["@type"];
  const types = (Array.isArray(rawType) ? rawType : [rawType])
    .filter((type): type is string => typeof type === "string")
    .join(" ");
  if (
    /Organization|Corporation|LocalBusiness|EducationalOrganization|GovernmentOrganization|ProfessionalService|MedicalOrganization|School|CollegeOrUniversity/i.test(
      types,
    )
  ) {
    output.push(record);
  }
  for (const child of Object.values(record)) {
    collectOrganizationObjects(child, output, depth + 1);
  }
}

function nestedAddressText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const output: string[] = [];
  for (const key of [
    "streetAddress",
    "addressLocality",
    "addressRegion",
    "postalCode",
    "addressCountry",
  ]) {
    const field = record[key];
    if (typeof field === "string" && field.trim()) output.push(field.trim());
  }
  return output;
}

function extractStructuredEvidence(body: string): StructuredEvidence {
  const objects: Record<string, unknown>[] = [];
  for (const match of body.matchAll(
    /<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script\s*>/gi,
  )) {
    const jsonText = decodeHtml(match[1] ?? "").trim().replace(/^<!--|-->$/g, "");
    try {
      collectOrganizationObjects(JSON.parse(jsonText) as unknown, objects);
    } catch {
      // Malformed structured data is ignored; visible page content is still assessed.
    }
  }
  const names = new Set<string>();
  const locations = new Set<string>();
  const emailDomains = new Set<string>();
  for (const organization of objects) {
    if (typeof organization.name === "string" && organization.name.trim()) {
      names.add(organization.name.trim());
    }
    for (const location of nestedAddressText(organization.address)) {
      locations.add(location);
    }
    if (typeof organization.email === "string") {
      const email = organization.email.replace(/^mailto:/i, "").trim();
      const match = email.match(/^[^@\s]+@([^@\s]+)$/);
      if (match) emailDomains.add(normalizedWebsiteHost(match[1]!));
    }
  }
  return {
    names: [...names],
    locations: [...locations],
    emailDomains: [...emailDomains].filter(Boolean),
  };
}

function extractPageEmailDomains(body: string): string[] {
  const text = `${visibleText(body)} ${decodeHtml(body)}`;
  const domains = new Set<string>();
  for (const match of text.matchAll(/[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi)) {
    const domain = normalizedWebsiteHost(match[1] ?? "");
    if (domain) domains.add(domain);
  }
  for (const match of body.matchAll(/\bmailto:([^"'?\s>]+)/gi)) {
    const email = decodeHtml(match[1] ?? "");
    const domain = normalizedWebsiteHost(email.split("@")[1] ?? "");
    if (domain) domains.add(domain);
  }
  return [...domains];
}

function assessmentForBody(
  source: Record<string, string>,
  page: PageResult,
  body: string,
) {
  return verifyOfficialWebsiteIdentity(source, {
    ...page,
    body,
  });
}

export function assessLiveWebsiteIdentity(
  source: Record<string, string>,
  candidateDomain: string,
  contactEmailDomain: string,
  pages: readonly VerificationPage[],
): LiveIdentityAssessment {
  const candidateHost = normalizedWebsiteHost(candidateDomain);
  const emailHost = normalizedWebsiteHost(contactEmailDomain);
  const emailDomainMatch = Boolean(candidateHost && emailHost && candidateHost === emailHost);
  const pageAssessments = pages.map(({ page }) =>
    verifyOfficialWebsiteIdentity(source, page),
  );
  const pageStructured = pages.map(({ page }) => extractStructuredEvidence(page.body));
  const structuredNames = [...new Set(pageStructured.flatMap((evidence) => evidence.names))];
  const pageEmailDomains = [
    ...new Set(
      pages.flatMap(({ page }, index) => [
        ...extractPageEmailDomains(page.body),
        ...pageStructured[index]!.emailDomains,
      ]),
    ),
  ];
  const schemaAssessmentsByPage = pageStructured.map((evidence, index) => {
    if (evidence.names.length === 0 && evidence.locations.length === 0) return null;
    const page = pages[index]!.page;
    return assessmentForBody(
      source,
      page,
      `${evidence.names.join(" ")} ${evidence.locations.join(" ")}`,
    );
  });
  const schemaAssessments = schemaAssessmentsByPage.filter(
    (assessment): assessment is Exclude<typeof assessment, null> => assessment !== null,
  );

  const homepageIndex = pages.findIndex((entry) => entry.kind === "homepage");
  const homepageStructuredNames =
    homepageIndex >= 0 ? pageStructured[homepageIndex]!.names : [];
  const homepageSchemaAssessments = homepageStructuredNames.map((name) =>
    assessmentForBody(source, pages[homepageIndex]!.page, name),
  );
  const homepageHasNameConflict =
    homepageStructuredNames.length > 0 &&
    homepageSchemaAssessments.every((assessment) => !assessment.potential) &&
    !pageAssessments.some((assessment) => assessment.potential) &&
    !schemaAssessments.some((assessment) => assessment.potential);

  const conflictsFound: string[] = [];
  if (!emailDomainMatch) conflictsFound.push("candidate_domain_differs_from_contact_email_domain");
  if (homepageHasNameConflict) {
    conflictsFound.push("homepage_structured_organization_name_does_not_match_employer");
  }

  const signalsMatched: string[] = [];
  if (emailDomainMatch) signalsMatched.push("candidate_domain_matches_contact_email_domain");
  if (pages.some(({ kind }) => kind === "homepage")) {
    signalsMatched.push("candidate_homepage_fetched_on_first_party_site");
  }
  if (pageAssessments.some((assessment) => assessment.potential)) {
    signalsMatched.push("employer_name_tokens_found_on_first_party_page");
  }
  if (pageAssessments.some((assessment) => assessment.accepted)) {
    signalsMatched.push("employer_name_identity_threshold_met_on_page");
  }
  if (
    [...pageAssessments, ...schemaAssessments].some((assessment) =>
      assessment.reason.includes("name_tokens_on_host"),
    )
  ) {
    signalsMatched.push("employer_name_tokens_match_site_domain");
  }
  if (
    [...pageAssessments, ...schemaAssessments].some((assessment) =>
      assessment.reason.includes("location_on_page"),
    )
  ) {
    signalsMatched.push("town_county_or_region_corroborated_on_page");
  }
  if (schemaAssessments.some((assessment) => assessment.potential)) {
    signalsMatched.push("structured_organization_name_matches_employer");
  }
  if (pageEmailDomains.includes(candidateHost)) {
    signalsMatched.push("candidate_contact_email_domain_seen_on_page");
  }
  for (const kind of ["about", "contact", "careers"] as const) {
    if (pages.some((entry) => entry.kind === kind)) {
      signalsMatched.push(`same_site_${kind}_page_checked`);
    }
  }

  const hardConflict = !emailDomainMatch || homepageHasNameConflict;
  const highIdentityEvidence = [...pageAssessments, ...schemaAssessments].some(
    (assessment) => assessment.accepted && assessment.confidence === "high",
  );
  const mediumIdentityEvidence = [...pageAssessments, ...schemaAssessments].some(
    (assessment) => assessment.accepted,
  );

  let verificationStatus: LiveIdentityAssessment["verificationStatus"];
  let newConfidence: LiveIdentityAssessment["newConfidence"];
  let reason: string;
  if (hardConflict) {
    verificationStatus = "rejected";
    newConfidence = "none";
    reason = conflictsFound.join("; ");
  } else if (highIdentityEvidence) {
    verificationStatus = "upgraded";
    newConfidence = "high";
    reason =
      "Distinctive employer identity is supported by first-party page evidence and corroborating location or site-domain signals.";
  } else if (mediumIdentityEvidence) {
    verificationStatus = "kept_medium";
    newConfidence = "medium";
    reason =
      "The first-party site contains employer identity evidence, but it does not meet the high-confidence corroboration threshold.";
  } else {
    verificationStatus = "inconclusive";
    newConfidence = "medium";
    reason =
      "Fetched pages did not provide enough reliable evidence to confirm or reject the employer identity.";
  }

  const pageAssessmentNotes = pages.map(({ kind, page }, index) => {
    const pageAssessment = pageAssessments[index]!;
    const schemaAssessment = schemaAssessmentsByPage[index];
    return `${kind} ${page.url}: ${pageAssessment.reason}${
      schemaAssessment ? `; structured data: ${schemaAssessment.reason}` : ""
    }`;
  });

  return {
    verificationStatus,
    newConfidence,
    signalsMatched: [...new Set(signalsMatched)],
    conflictsFound,
    reason,
    pageAssessmentNotes,
    structuredOrganizationNames: structuredNames,
    pageEmailDomains,
  };
}

export function isBlockedOrTimeoutError(message: string): boolean {
  return /robots|policy|blocked|HTTP (?:401|403|429)|private or unresolved|timed? ?out|timeout|AbortError|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|unsafe|redirect/i.test(
    message,
  );
}

export function isTimeoutError(message: string): boolean {
  return /timed? ?out|timeout|AbortError|ETIMEDOUT|HTTP (?:408|504)/i.test(message);
}

export function hasTimeoutSignalInNotes(notes: string): boolean {
  const explicitCount = notes.match(/\btimeout_errors=(\d+)\b/);
  if (explicitCount) return Number(explicitCount[1]) > 0;
  const notesWithoutStatusMetric = notes.replace(/\bblocked_or_timeout=\d+\b/g, "");
  return /timed? ?out|timeout|AbortError|ETIMEDOUT|HTTP (?:408|504)/i.test(
    notesWithoutStatusMetric,
  );
}

export function isBlockedError(message: string): boolean {
  return /robots|policy|blocked|HTTP (?:401|403|429)|private or unresolved|unsafe|redirect/i.test(
    message,
  );
}

export function normalizedOrganisationName(value: string): string {
  return normalizeWebsiteName(value);
}