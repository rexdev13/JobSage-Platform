import type { EmployerRow } from "./companySiteDiscoveryInput";

export const HEALTHCARE_SELECTOR =
  "industry IN (Healthcare, Social Care), or Public Services with organisation name cues: NHS, National Health Service, public health, clinical commissioning group, CCG, ICB";

const PUBLIC_SERVICE_CUES = /\b(?:NHS|National Health Service|public health|clinical commissioning group|CCG|ICB)\b/i;

export function matchesHealthcareSelector(
  industry: string | null | undefined,
  organisationName: string,
): boolean {
  return industry === "Healthcare" ||
    industry === "Social Care" ||
    (industry === "Public Services" && PUBLIC_SERVICE_CUES.test(organisationName));
}

export function savedCareersOnlyPageUrls(employer: Pick<EmployerRow, "careers_url">): string[] {
  const careersUrl = employer.careers_url?.trim();
  return careersUrl ? [careersUrl] : [];
}

export function isFirstPartyEvidenceHost(hostname: string, employerHostname: string): boolean {
  const normalise = (host: string) => host.trim().toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
  const host = normalise(hostname);
  const employer = normalise(employerHostname);
  return host === employer || host.endsWith(`.${employer}`);
}

export type OperatorEvidenceOutcome =
  | "not_provided"
  | "verified_ats_feed"
  | "fetched_no_verified_ats_feed"
  | "robots_blocked"
  | "rate_limited"
  | "invalid_or_not_first_party"
  | "unavailable";

export type OperatorEvidenceAttemptOutcome =
  | "fetched"
  | "robots_blocked"
  | "rate_limited"
  | "not_attempted_after_rate_limit"
  | "not_attempted_page_limit"
  | "not_attempted_deadline"
  | "invalid_or_not_first_party"
  | "unavailable";

export function classifyOperatorEvidenceAttempt(attempt: {
  fetched?: boolean;
  failureKind?: string | null;
  status?: number | null;
  invalidFirstParty?: boolean;
  notAttemptedAfterRateLimit?: boolean;
  notAttemptedReason?: "page_limit" | "deadline";
}): OperatorEvidenceAttemptOutcome {
  if (attempt.fetched) return "fetched";
  if (attempt.notAttemptedAfterRateLimit) return "not_attempted_after_rate_limit";
  if (attempt.notAttemptedReason === "page_limit") return "not_attempted_page_limit";
  if (attempt.notAttemptedReason === "deadline") return "not_attempted_deadline";
  if (attempt.failureKind === "rate_limited" || attempt.status === 429) return "rate_limited";
  if (attempt.failureKind === "robots") return "robots_blocked";
  if (attempt.invalidFirstParty) return "invalid_or_not_first_party";
  return "unavailable";
}

export function classifyOperatorEvidenceOutcome(input: {
  provided: boolean;
  verified: boolean;
  attempts: Array<{
    fetched?: boolean;
    failureKind?: string | null;
    status?: number | null;
    invalidFirstParty?: boolean;
    notAttemptedAfterRateLimit?: boolean;
    notAttemptedReason?: "page_limit" | "deadline";
  }>;
}): OperatorEvidenceOutcome {
  if (!input.provided) return "not_provided";
  if (input.verified) return "verified_ats_feed";
  if (input.attempts.some((attempt) => attempt.fetched)) return "fetched_no_verified_ats_feed";
  const attemptOutcomes = input.attempts.map(classifyOperatorEvidenceAttempt);
  if (attemptOutcomes.includes("rate_limited") ||
      attemptOutcomes.includes("not_attempted_after_rate_limit")) return "rate_limited";
  if (attemptOutcomes.includes("robots_blocked")) return "robots_blocked";
  if (attemptOutcomes.includes("invalid_or_not_first_party")) {
    return "invalid_or_not_first_party";
  }
  return "unavailable";
}