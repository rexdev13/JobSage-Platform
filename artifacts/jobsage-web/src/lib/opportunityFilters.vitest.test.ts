import { describe, expect, it } from "vitest";
import {
  defaultSponsorshipOnly,
  filterOpportunities,
  getOpportunityApplyAction,
  groupRankedOpportunities,
} from "./opportunityFilters";

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

  it("keeps only server-approved roles in Apply First and separates low scores", () => {
    const grouped = groupRankedOpportunities([
      { id: 1, recommended: true, aiScore: 82, matchScore: 70 },
      { id: 2, recommended: false, aiScore: 63, matchScore: 70 },
      { id: 3, recommended: false, aiScore: 0, matchScore: 80 },
    ]);

    expect(grouped.recommended.map((role) => role.id)).toEqual([1]);
    expect(grouped.consider.map((role) => role.id)).toEqual([2]);
    expect(grouped.remaining.map((role) => role.id)).toEqual([3]);
  });

  it("keeps the exact source-specific vacancy URL ahead of an employer website fallback", () => {
    expect(getOpportunityApplyAction({
      sourceType: "company_site",
      applyUrl: "https://ats.example.com/jobs/registered-nurse-42",
      contactWebsite: "https://employer.example.com",
    })).toEqual({
      destinationUrl: "https://ats.example.com/jobs/registered-nurse-42",
      label: "Apply on company site",
      usesWebsiteFallback: false,
    });

    expect(getOpportunityApplyAction({
      sourceType: "job_board",
      applyUrl: "https://board.example.com/jobs/42",
      contactWebsite: "https://employer.example.com",
    })).toEqual({
      destinationUrl: "https://board.example.com/jobs/42",
      label: "Apply on job boards",
      usesWebsiteFallback: false,
    });
  });

  it("clearly labels and normalises the employer website fallback", () => {
    expect(getOpportunityApplyAction({
      sourceType: "company_site",
      applyUrl: null,
      contactWebsite: "employer.example.com/careers",
    })).toEqual({
      destinationUrl: "https://employer.example.com/careers",
      label: "Open employer website",
      usesWebsiteFallback: true,
    });
  });
});
