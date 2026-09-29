export const HEALTHCARE_BATCH_MAX_EMPLOYERS = 15;
export const HEALTHCARE_BATCH_DEFAULT_BUDGET_MS = 240_000;
export const HEALTHCARE_BATCH_APPLY_CONFIRMATION = "apply-reviewed-healthcare-company-site-batch";
export const NAMED_BATCH_APPLY_CONFIRMATION = "apply-reviewed-named-company-site-batch";
export const SCHEDULED_NAMED_BATCH_APPLY_CONFIRMATION = "scheduled-apply-named-company-site-batch";

export type CompanySiteBatchApplyMode = "reviewed" | "scheduled";

export type HealthcareBatchEmployer = {
  organisationName: string;
  website: string;
  careersUrl: string;
};

export function scheduledApplyBlockReason(input: {
  found: number;
  accepted: number;
  budgetExhausted: boolean;
  employersChecked: Array<Record<string, unknown>>;
  acceptedRows: Array<{ applicationUrl: string | null; contactEmail: string | null }>;
}): string | null {
  const paced = input.employersChecked.some((row) =>
    typeof row.error === "string" && row.error.includes("paced or in backoff"),
  );
  if (paced && input.accepted === 0) return "discovery_paced";
  if (input.found === 0) return "found_zero";
  if (input.accepted === 0) return "accepted_zero";
  if (input.budgetExhausted && input.accepted === 0) return "budget_exhausted";
  const missingRoute = input.acceptedRows.some((row) => {
    const apply = row.applicationUrl?.trim() ?? "";
    const email = row.contactEmail?.trim() ?? "";
    const applyOk = (() => {
      try {
        const parsed = new URL(apply);
        return parsed.protocol === "https:" && Boolean(parsed.hostname);
      } catch {
        return false;
      }
    })();
    return !applyOk && !email;
  });
  if (missingRoute) return "missing_https_apply_route";
  return null;
}

/**
 * A named cohort employer is allowed when the sponsor register has no industry
 * yet. A sponsor already labelled as another sector is still refused.
 */
export function namedSponsorIndustryAllowed(
  industry: string | null | undefined,
  allowedIndustries: readonly string[],
): boolean {
  const value = industry?.trim() ?? "";
  if (!value) return true;
  return allowedIndustries.includes(value);
}

export function parseHealthcareBatchEmployers(value: unknown): HealthcareBatchEmployer[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("employers must be a non-empty array.");
  }
  if (value.length > HEALTHCARE_BATCH_MAX_EMPLOYERS) {
    throw new Error(`employers is limited to ${HEALTHCARE_BATCH_MAX_EMPLOYERS} entries.`);
  }
  return value.map((row, index) => {
    if (!row || typeof row !== "object") throw new Error(`employers[${index}] must be an object.`);
    const record = row as Record<string, unknown>;
    const organisationName = typeof record.organisationName === "string" ? record.organisationName.trim() : "";
    const website = typeof record.website === "string" ? record.website.trim() : "";
    const careersUrl = typeof record.careersUrl === "string" ? record.careersUrl.trim() : "";
    if (!organisationName || !website || !careersUrl) {
      throw new Error(`employers[${index}] needs organisationName, website, and careersUrl.`);
    }
    for (const candidate of [website, careersUrl]) {
      let parsed: URL;
      try {
        parsed = new URL(candidate);
      } catch {
        throw new Error(`employers[${index}] has an invalid URL.`);
      }
      if (parsed.protocol !== "https:") throw new Error(`employers[${index}] URLs must use https.`);
    }
    return { organisationName, website, careersUrl };
  });
}
