export const UK_REGIONS = [
  "East of England", "East Midlands", "London", "North East", "North West", "South East",
  "South West", "West Midlands", "Yorkshire and the Humber", "Northern Ireland", "Scotland",
  "Wales", "National / Multiple Regions",
] as const;

export type OpportunityFilterRole = {
  targetRegions?: string[] | null;
};

export type RankedOpportunity = {
  recommended?: boolean;
  aiScore?: number | null;
  matchScore: number;
};

export type OpportunitySource = "job_board" | "company_site" | null | undefined;

export type OpportunityApplyAction = {
  destinationUrl: string;
  label: string;
  usesWebsiteFallback: boolean;
};

export function shouldShowOpportunityApplyActions(sendCvOnly: boolean | undefined): boolean {
  return !sendCvOnly;
}

export function shouldShowSendCv(sendCvEligible: boolean | null | undefined): boolean {
  // TEMP: allow Send CV without destination for client call; restore recipient
  // eligibility gating after call.
  void sendCvEligible;
  return true;
}

export type VacancyLinkStatus = "none" | "live" | "dead" | "unverified" | "inconclusive" | "stale";

export function canSendCvForVacancy({
  sendCvEligible,
  applyUrl,
  linkStatus,
}: {
  sendCvEligible?: boolean | null;
  applyUrl?: string | null;
  linkStatus?: VacancyLinkStatus | null;
}): boolean {
  const effectiveStatus = linkStatus ?? (applyUrl ? "unverified" : "none");
  return shouldShowSendCv(sendCvEligible) && (effectiveStatus === "none" || effectiveStatus === "live");
}

function isDisallowedSendCvApplyUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return ["linkedin.com", "indeed.com"].some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    );
  } catch {
    return true;
  }
}

export function hasUsableSendCvApplyRoute({
  applyUrl,
  linkVerified,
  linkStatus,
}: {
  applyUrl?: string | null;
  linkVerified?: boolean | null;
  linkStatus?: VacancyLinkStatus | null;
}): boolean {
  const effectiveStatus = linkStatus ?? (linkVerified ? "live" : "unverified");
  return !!applyUrl && effectiveStatus === "live" && linkVerified === true && !isDisallowedSendCvApplyUrl(applyUrl);
}

export function shouldShowOnSendCvTab({
  sendCvEligible,
  applyUrl,
  linkVerified,
  linkStatus,
}: {
  sendCvEligible?: boolean | null;
  applyUrl?: string | null;
  linkVerified?: boolean | null;
  linkStatus?: VacancyLinkStatus | null;
}): boolean {
  if (canSendCvForVacancy({ sendCvEligible, applyUrl, linkStatus })) return true;
  return hasUsableSendCvApplyRoute({ applyUrl, linkVerified, linkStatus });
}
export const CONSIDER_MIN_SCORE = 40;

export function getOpportunityApplyAction({
  sourceType,
  applyUrl,
  contactWebsite,
}: {
  sourceType: OpportunitySource;
  applyUrl?: string | null;
  contactWebsite?: string | null;
}): OpportunityApplyAction | null {
  if (applyUrl) {
    return {
      destinationUrl: applyUrl,
      label: sourceType === "company_site" ? "Apply on company's website" : "Apply Via Job Board",
      usesWebsiteFallback: false,
    };
  }

  if (!contactWebsite) return null;
  return {
    destinationUrl: contactWebsite.startsWith("http") ? contactWebsite : `https://${contactWebsite}`,
    label: "Open employer website",
    usesWebsiteFallback: true,
  };
}

export function opportunityScore(role: RankedOpportunity): number {
  return role.aiScore ?? role.matchScore;
}

export function groupRankedOpportunities<T extends RankedOpportunity>(roles: T[]): {
  recommended: T[];
  consider: T[];
  remaining: T[];
} {
  const recommended = roles.filter((role) => role.recommended === true).slice(0, 5);
  const recommendedSet = new Set(recommended);
  const consider = roles
    .filter((role) => !recommendedSet.has(role) && opportunityScore(role) >= CONSIDER_MIN_SCORE)
    .slice(0, 5);
  const considerSet = new Set(consider);
  const remaining = roles.filter((role) => !recommendedSet.has(role) && !considerSet.has(role));
  return { recommended, consider, remaining };
}

function regionKey(region: string): string {
  return region.trim().toLowerCase().replace(/\s+/g, " ");
}

export function hasRegionOverlap(targetRegions: string[] | null | undefined, selectedRegions: string[]): boolean {
  if (selectedRegions.length === 0 || !targetRegions || targetRegions.length === 0) return true;
  const selected = new Set(selectedRegions.map(regionKey));
  if (targetRegions.some((region) => regionKey(region) === regionKey("National / Multiple Regions"))) return true;
  return targetRegions.some((region) => selected.has(regionKey(region)));
}

export function filterOpportunities<T extends OpportunityFilterRole>(
  roles: T[],
  filters: { selectedRegions: string[] },
): T[] {
  return roles.filter((role) => hasRegionOverlap(role.targetRegions, filters.selectedRegions));
}

export function filterSendCvSponsors<T extends { sendCvEligible?: boolean | null }>(
  companies: T[],
): T[] {
  return companies.filter((company) => shouldShowSendCv(company.sendCvEligible));
}
