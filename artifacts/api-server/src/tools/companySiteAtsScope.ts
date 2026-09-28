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