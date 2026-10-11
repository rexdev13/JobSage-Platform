import { hasRegionOverlap } from "./opportunityFilters";

export interface SponsorPanelVacancy {
  title: string;
  location?: string | null;
  targetRegions?: string[] | null;
  ukLocationStatus?: "confirmed_uk" | "confirmed_non_uk" | "unknown" | null;
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
    .filter((vacancy) => vacancy.ukLocationStatus == null || vacancy.ukLocationStatus === "confirmed_uk")
    .filter((vacancy) => !preferredRegionOnly || hasRegionOverlap(vacancy.targetRegions, preferredRegions))
    .filter((vacancy) =>
      query.length === 0
        ? true
        : `${vacancy.title} ${vacancy.location ?? ""}`.toLowerCase().includes(query),
    );
}