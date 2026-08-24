import { COUNTY_TO_REGION } from "./countyToRegion";

export const UK_REGIONS = [
  "East of England",
  "East Midlands",
  "London",
  "North East",
  "North West",
  "South East",
  "South West",
  "West Midlands",
  "Yorkshire and the Humber",
  "Northern Ireland",
  "Scotland",
  "Wales",
  "National / Multiple Regions",
] as const;

export type UkRegion = (typeof UK_REGIONS)[number];

const REGION_ALIASES: Record<string, UkRegion> = {
  "east of england": "East of England",
  "east england": "East of England",
  "east midlands": "East Midlands",
  london: "London",
  "north east": "North East",
  northeast: "North East",
  "north west": "North West",
  northwest: "North West",
  "south east": "South East",
  southeast: "South East",
  "south west": "South West",
  southwest: "South West",
  "west midlands": "West Midlands",
  "yorkshire and the humber": "Yorkshire and the Humber",
  "yorkshire & the humber": "Yorkshire and the Humber",
  yorkshire: "Yorkshire and the Humber",
  "northern ireland": "Northern Ireland",
  scotland: "Scotland",
  wales: "Wales",
  "national / multiple regions": "National / Multiple Regions",
  "national": "National / Multiple Regions",
  "multiple regions": "National / Multiple Regions",
};

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeRegion(value: string | null | undefined): UkRegion | null {
  if (!value) return null;
  return REGION_ALIASES[normalizeText(value)] ?? null;
}

export function normalizeRegionList(values: readonly (string | null | undefined)[] | null | undefined): UkRegion[] {
  return [...new Set((values ?? []).map(normalizeRegion).filter((region): region is UkRegion => region !== null))];
}

/**
 * Empty target regions mean that the publisher has not supplied a restriction.
 * Empty candidate preferences mean that the candidate is open to any location.
 * Both cases therefore keep the role visible.
 */
export function regionsOverlap(
  targetRegions: readonly (string | null | undefined)[] | null | undefined,
  preferredRegions: readonly (string | null | undefined)[] | null | undefined,
): boolean {
  const targets = normalizeRegionList(targetRegions);
  const preferred = normalizeRegionList(preferredRegions);
  if (targets.length === 0 || preferred.length === 0) return true;
  if (targets.includes("National / Multiple Regions")) return true;
  return targets.some((region) => preferred.includes(region));
}

/**
 * Resolve a sponsor vacancy's location only when it contains a known,
 * deterministic UK county, city, nation, or region phrase. An empty result is
 * intentionally treated as unknown by callers and must not exclude a vacancy.
 */
export function regionsFromLocationText(location: string | null | undefined): UkRegion[] {
  if (!location?.trim()) return [];
  const normalizedLocation = normalizeText(location);
  const terms = Object.keys(COUNTY_TO_REGION)
    .sort((a, b) => b.length - a.length)
    .filter((term) => {
      const normalizedTerm = normalizeText(term);
      return new RegExp(`(?:^| )${normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`).test(normalizedLocation);
    })
    .map((term) => normalizeRegion(COUNTY_TO_REGION[term]))
    .filter((region): region is UkRegion => region !== null);
  const directRegion = Object.keys(REGION_ALIASES)
    .sort((a, b) => b.length - a.length)
    .filter((term) => new RegExp(`(?:^| )${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`).test(normalizedLocation))
    .map((term) => REGION_ALIASES[term]);
  return [...new Set([...terms, ...directRegion])];
}