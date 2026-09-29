import { isLikelyEditorialTitle } from "./vacancyTitlePolicy";
import { isBlockedVacancyUrl, isValidVacancyDeepLink } from "./vacancyUrlPolicy";
import { extractAdvertContactEmail } from "./publishedContactEmail";

export const HEALTHCARE_ROLE_TITLE_PATTERN =
  /\b(?:registered nurses?|staff nurses?|nurses?|midwi(?:fe|ves)|carers?|care assistants?|support workers?|healthcare assistants?|health care assistants?|social workers?|physiotherapists?|occupational therapists?|radiographers?|pharmacists?|dental nurses?|dentists?|paramedics?|nursing associates?|care workers?|domiciliary|clinical leads?|healthcare support workers?|home managers?|registered managers?|deputy managers?|ward managers?)\b/i;

export const HEALTHCARE_ROLE_TITLE_SQL_PATTERN =
  "\\m(registered nurses?|staff nurses?|nurses?|midwi(fe|ves)|carers?|care assistants?|support workers?|healthcare assistants?|health care assistants?|social workers?|physiotherapists?|occupational therapists?|radiographers?|pharmacists?|dental nurses?|dentists?|paramedics?|nursing associates?|care workers?|domiciliary|clinical leads?|healthcare support workers?|home managers?|registered managers?|deputy managers?|ward managers?)\\M";

export const RECRUITMENT_EMAIL_PATTERN =
  /^(?:jobs|careers|recruitment|recruit|hr|hiring|talent|vacancies|vacancy|apply|nursing)(?:[._+-][a-z0-9._+-]+)?@[a-z0-9.-]+\.[a-z]{2,}$/i;

export const RECRUITMENT_EMAIL_SQL_PATTERN =
  "^(jobs|careers|recruitment|recruit|hr|hiring|talent|vacancies|vacancy|apply|nursing)([._+-][a-z0-9._+-]+)?@[a-z0-9.-]+\\.[a-z]{2,}$";

const JUNK_TITLE =
  /^(?:careers?|jobs?|vacancies|why work here|our benefits|benefits|skip(?:\s+to)?\s+(?:main\s+)?content|contact(?:\s+us)?|about(?:\s+us)?|home|training|our values|culture|news|blog|current vacancies|work with us|join us)$/i;

const JUNK_PATH =
  /\/(?:benefits|why-work(?:-here)?|our-values|values|culture|training|news|blog|resources|about(?:-us)?|contact(?:-us)?)(?:\/|$)/i;

const RECRUITMENT_PATH =
  /\/(?:careers?|jobs?|vacanc(?:y|ies)|join-us|work-with-us|recruit(?:ment)?)(?:\/|$)/i;

const APPLY_LINK_TEXT =
  /^(?:apply(?:\s+now|\s+online|\s+for\s+this\s+(?:role|job|vacancy|position))?|submit\s+(?:your\s+)?application|start\s+application)$/i;

const APPLY_PAGE_TEXT =
  /\b(?:apply now|apply for this (?:role|job|vacancy|position)|submit (?:your )?application|application form)\b/i;

const ATS_APPLY_HOSTS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "myworkdayjobs.com",
  "smartrecruiters.com",
  "recruitee.com",
  "personio.com",
  "personio.de",
  "pinpointhq.com",
  "tal.net",
  "eploy.net",
];

export type StrictHealthcareRoleEvidence = {
  kind: "strict_role_page";
  sector: "healthcare";
  listingUrl: string;
  detailUrl: string;
  applicationUrl?: string;
  contactEmail?: string;
  trustedSource: "manual_review";
  roleEligibilityReview: {
    status: "approved";
    socCode: string;
    evidenceUrl: string;
  };
};

export function isRecruitmentEmail(value: string | null | undefined): boolean {
  return RECRUITMENT_EMAIL_PATTERN.test(value?.trim().toLowerCase() ?? "");
}

export function isSpecificHealthcareRoleTitle(title: string | null | undefined): boolean {
  const text = title?.replace(/\s+/g, " ").trim() ?? "";
  if (text.length < 3 || text.length > 120) return false;
  if (JUNK_TITLE.test(text)) return false;
  if (isLikelyEditorialTitle(text)) return false;
  return HEALTHCARE_ROLE_TITLE_PATTERN.test(text);
}

export function socForHealthcareTitle(title: string): string {
  const value = title.toLowerCase();
  if (/\bsocial workers?\b/.test(value)) return "2461";
  if (/\bphysiotherapists?\b/.test(value)) return "2221";
  if (/\boccupational therapists?\b/.test(value)) return "2222";
  if (/\bradiographers?\b/.test(value)) return "2254";
  if (/\bpharmacists?\b/.test(value)) return "2251";
  if (/\b(?:dentists?|dental nurses?)\b/.test(value)) return "2253";
  if (/\bmidwi(?:fe|ves)\b/.test(value)) return "2232";
  if (/\bparamedics?\b/.test(value)) return "2255";
  if (/\b(?:doctors?|consultants?|general practitioners?)\b/.test(value)) return "2211";
  if (/\b(?:nurses?|nursing associates?|nursing)\b/.test(value)) return "2231";
  if (/\bhealthcare assistants?|health care assistants?\b/.test(value)) return "6131";
  return "6135";
}

function httpsUrl(value: string | null | undefined): URL | null {
  if (!value?.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) return null;
    return parsed;
  } catch {
    return null;
  }
}

function relatedHost(left: string, right: string): boolean {
  const a = left.toLowerCase().replace(/^www\./, "");
  const b = right.toLowerCase().replace(/^www\./, "");
  return a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`);
}

function allowedApplyHost(hostname: string, employerHost: string): boolean {
  const host = hostname.toLowerCase();
  if (relatedHost(host, employerHost)) return true;
  return ATS_APPLY_HOSTS.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function recruitmentPath(url: string): boolean {
  try {
    return RECRUITMENT_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export function junkVacancyPath(url: string): boolean {
  try {
    return JUNK_PATH.test(new URL(url).pathname);
  } catch {
    return true;
  }
}

export function extractHealthcareApplicationRoute(
  html: string,
  pageUrl: string,
  employerHost: string,
): { applicationUrl: string | null; contactEmail: string | null } {
  const contactEmail = extractAdvertContactEmail(html, pageUrl);
  const recruitmentEmail = isRecruitmentEmail(contactEmail) ? contactEmail : null;
  const applyLinks = [...html.matchAll(/<a\b([^>]*?)>([\s\S]*?)<\/a>/gi)];
  for (const match of applyLinks) {
    const attributes = match[1] ?? "";
    const text = (match[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!APPLY_LINK_TEXT.test(text)) continue;
    const href = attributes.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const raw = href?.[1] ?? href?.[2] ?? "";
    if (!raw || /^(?:mailto:|tel:|javascript:)/i.test(raw)) continue;
    let resolved: URL;
    try {
      resolved = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    if (
      resolved.protocol === "https:" &&
      allowedApplyHost(resolved.hostname, employerHost) &&
      !isBlockedVacancyUrl(resolved.toString())
    ) {
      return { applicationUrl: resolved.toString(), contactEmail: recruitmentEmail };
    }
  }
  const page = httpsUrl(pageUrl);
  if (
    page &&
    isValidVacancyDeepLink(page.toString()) &&
    !junkVacancyPath(page.toString()) &&
    APPLY_PAGE_TEXT.test(html.replace(/<[^>]+>/g, " "))
  ) {
    return { applicationUrl: page.toString(), contactEmail: recruitmentEmail };
  }
  return { applicationUrl: null, contactEmail: recruitmentEmail };
}

export function buildStrictHealthcareRoleEvidence(input: {
  title: string;
  detailUrl: string;
  listingUrl: string;
  employerHost: string;
  applicationUrl?: string | null;
  contactEmail?: string | null;
}): StrictHealthcareRoleEvidence | null {
  if (!isSpecificHealthcareRoleTitle(input.title)) return null;
  const detail = httpsUrl(input.detailUrl);
  const listing = httpsUrl(input.listingUrl);
  if (!detail || !listing) return null;
  if (!relatedHost(detail.hostname, input.employerHost) && !allowedApplyHost(detail.hostname, input.employerHost)) {
    return null;
  }
  if (!isValidVacancyDeepLink(detail.toString()) || isBlockedVacancyUrl(detail.toString()) || junkVacancyPath(detail.toString())) {
    return null;
  }
  if (!recruitmentPath(listing.toString()) && !recruitmentPath(detail.toString())) return null;
  const application = httpsUrl(input.applicationUrl);
  const email = isRecruitmentEmail(input.contactEmail) ? input.contactEmail!.trim().toLowerCase() : null;
  if (application && (!allowedApplyHost(application.hostname, input.employerHost) || isBlockedVacancyUrl(application.toString()))) {
    return null;
  }
  if (!application && !email) return null;
  return {
    kind: "strict_role_page",
    sector: "healthcare",
    listingUrl: listing.toString(),
    detailUrl: detail.toString(),
    ...(application ? { applicationUrl: application.toString() } : {}),
    ...(email ? { contactEmail: email } : {}),
    trustedSource: "manual_review",
    roleEligibilityReview: {
      status: "approved",
      socCode: socForHealthcareTitle(input.title),
      evidenceUrl: detail.toString(),
    },
  };
}

export function hasStrictHealthcareRoleEvidence(
  evidence: unknown,
  title: string | null | undefined,
): boolean {
  if (!evidence || typeof evidence !== "object") return false;
  const value = evidence as Record<string, unknown>;
  if (value.kind !== "strict_role_page" || value.sector !== "healthcare") return false;
  if (value.trustedSource !== "manual_review") return false;
  const review = value.roleEligibilityReview;
  if (!review || typeof review !== "object") return false;
  const reviewValue = review as Record<string, unknown>;
  if (reviewValue.status !== "approved" || typeof reviewValue.socCode !== "string" || !/^\d{4}$/.test(reviewValue.socCode)) {
    return false;
  }
  return buildStrictHealthcareRoleEvidence({
    title: title ?? "",
    detailUrl: typeof value.detailUrl === "string" ? value.detailUrl : "",
    listingUrl: typeof value.listingUrl === "string" ? value.listingUrl : "",
    employerHost: (() => {
      try {
        return new URL(String(value.detailUrl)).hostname;
      } catch {
        return "";
      }
    })(),
    applicationUrl: typeof value.applicationUrl === "string" ? value.applicationUrl : null,
    contactEmail: typeof value.contactEmail === "string" ? value.contactEmail : null,
  }) !== null;
}
