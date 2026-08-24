export const UK_REGIONS = [
  "East of England", "East Midlands", "London", "North East", "North West", "South East",
  "South West", "West Midlands", "Yorkshire and the Humber", "Northern Ireland", "Scotland",
  "Wales", "National / Multiple Regions",
] as const;

export type OpportunityFilterRole = {
  sponsorshipOffered: boolean;
  targetRegions?: string[] | null;
};

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