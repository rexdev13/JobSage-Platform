const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com",
  "outlook.com", "live.com", "icloud.com", "aol.com", "proton.me", "protonmail.com",
]);

const BLOCKED_CONTACT_DOMAINS = [
  "linkedin.com", "indeed.com", "facebook.com", "instagram.com", "x.com",
  "twitter.com", "find-and-update.company-information.service.gov.uk", "gov.uk",
  "yell.com", "glassdoor.com", "reed.co.uk", "jobs.nhs.uk", "greenhouse.io",
  "lever.co", "myworkdayjobs.com", "workday.com", "smartrecruiters.com",
  "teamtailor.com", "jobvite.com", "bamboohr.com",
];

const BLOCKED_EVIDENCE_HOSTS = ["linkedin.com", "indeed.com"];
const EMAIL = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;

function hostnameIsBlocked(hostname: string, blockedHosts: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return blockedHosts.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

function cleanVisibleText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:amp|#38);/gi, "&")
    .replace(/&#64;|&commat;/gi, "@")
    .replace(/\s+/g, " ")
    .trim();
}

export function validatePublishedContactEmail(value: string | null | undefined): string | null {
  const email = value?.trim().toLowerCase().replace(/^mailto:/, "").replace(/[)>.,;:]+$/, "") ?? "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return null;
  const [local, domain] = email.split("@");
  if (!local || !domain || FREE_EMAIL_DOMAINS.has(domain)) return null;
  if (/^(?:no-?reply|donotreply|do-not-reply)$/i.test(local)) return null;
  if (hostnameIsBlocked(domain, BLOCKED_CONTACT_DOMAINS)) return null;
  return email;
}

export function choosePreferredPublishedEmail(emails: readonly string[]): string | null {
  return [...emails].sort((a, b) => {
    const score = (email: string) => /\b(recruit(?:ment|ing)?|jobs?|careers?|hr)\b/i.test(email) ? 2 :
      /\b(info|contact|admin)\b/i.test(email) ? 1 : 0;
    return score(b) - score(a) || a.localeCompare(b);
  })[0] ?? null;
}

/** Extracts only visible/plain-text or mailto addresses from HTML already fetched for an advert. */
export function extractAdvertContactEmail(html: string, evidenceUrl: string): string | null {
  let evidence: URL;
  try {
    evidence = new URL(evidenceUrl);
  } catch {
    return null;
  }
  if (hostnameIsBlocked(evidence.hostname, BLOCKED_EVIDENCE_HOSTS)) return null;

  const mailtos = [...html.matchAll(/\bhref\s*=\s*["']mailto:([^"'?#\s]+)/gi)]
    .map((match) => {
      try {
        return decodeURIComponent(match[1] ?? "");
      } catch {
        return match[1] ?? "";
      }
    });
  const visible = cleanVisibleText(html).match(EMAIL) ?? [];
  const valid = [...new Set([...mailtos, ...visible]
    .map(validatePublishedContactEmail)
    .filter((email): email is string => email !== null))];
  return choosePreferredPublishedEmail(valid);
}