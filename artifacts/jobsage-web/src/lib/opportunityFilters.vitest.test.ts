import { describe, expect, it } from "vitest";
import { defaultSponsorshipOnly, filterOpportunities } from "./opportunityFilters";

describe("opportunity filters", () => {
  const roles = [
    { id: 1, sponsorshipOffered: true, targetRegions: ["London"] },
    { id: 2, sponsorshipOffered: false, targetRegions: ["London"] },
    { id: 3, sponsorshipOffered: true, targetRegions: ["North West"] },
    { id: 4, sponsorshipOffered: true, targetRegions: [] },
  ];

  it("defaults sponsorship-only on only when the candidate needs sponsorship", () => {
    expect(defaultSponsorshipOnly(true)).toBe(true);
    expect(defaultSponsorshipOnly(false)).toBe(false);
    expect(defaultSponsorshipOnly(undefined)).toBe(false);
  });

  it("keeps unknown regions while applying region and sponsorship filters", () => {
    expect(filterOpportunities(roles, { selectedRegions: ["London"], sponsorshipOnly: true }).map((role) => role.id))
      .toEqual([1, 4]);
    expect(filterOpportunities(roles, { selectedRegions: ["London"], sponsorshipOnly: false }).map((role) => role.id))
      .toEqual([1, 2, 4]);
  });

  it("compares region values consistently despite casing or surrounding whitespace", () => {
    expect(filterOpportunities(
      [{ id: 1, sponsorshipOffered: true, targetRegions: [" london "] }],
      { selectedRegions: ["London"], sponsorshipOnly: false },
    )).toHaveLength(1);
  });
});