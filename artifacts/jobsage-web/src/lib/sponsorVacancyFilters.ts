import { hasRegionOverlap } from "./opportunityFilters";

export interface SponsorPanelVacancy {
  title: string;
  location?: string | null;
  targetRegions?: string[] | null;
}

export function filterSponsorPanelVacancies<T extends SponsorPanelVacancy>(
  vacancies: T[],
  {
    search,
    preferredRegions,
    preferredRegionOnly,
  }: {
    search: string;
    preferredRegions: string[];
    preferredRegionOnly: boolean;
  },
): T[] {
  const query = search.trim().toLowerCase();
  return vacancies
    .filter((vacancy) => !preferredRegionOnly || hasRegionOverlap(vacancy.targetRegions, preferredRegions))
    .filter((vacancy) =>
      query.length === 0
        ? true
        : `${vacancy.title} ${vacancy.location ?? ""}`.toLowerCase().includes(query),
    );
}