export const UK_REGIONS = [
  "East of England", "East Midlands", "London", "North East", "North West", "South East",
  "South West", "West Midlands", "Yorkshire and the Humber", "Northern Ireland", "Scotland",
  "Wales", "National / Multiple Regions",
] as const;

export type OpportunityFilterRole = {
  sponsorshipOffered: boolean;
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
      label: sourceType === "company_site" ? "Apply on company site" : "Apply Via Job Board",
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

export function defaultSponsorshipOnly(requiresSponsorship: boolean | null | undefined): boolean {
  return requiresSponsorship === true;
}

export function filterOpportunities<T extends OpportunityFilterRole>(
  roles: T[],
  filters: { selectedRegions: string[]; sponsorshipOnly: boolean },
): T[] {
  return roles.filter((role) =>
    (!filters.sponsorshipOnly || role.sponsorshipOffered) &&
    hasRegionOverlap(role.targetRegions, filters.selectedRegions),
  );
}