import { describe, expect, it } from "vitest";
import {
  filterSendCvSponsors,
  filterOpportunities,
  getOpportunityApplyAction,
  groupRankedOpportunities,
  canSendCvForVacancy,
  hasUsableSendCvApplyRoute,
  shouldShowOpportunityApplyActions,
  shouldShowOnSendCvTab,
  shouldShowSendCv,
} from "./opportunityFilters";

describe("opportunity filters", () => {
  const roles = [
    { id: 1, targetRegions: ["London"] },
    { id: 2, targetRegions: ["London"] },
    { id: 3, targetRegions: ["North West"] },
    { id: 4, targetRegions: [] },
  ];

  it("keeps unknown regions while applying region filters", () => {
    expect(filterOpportunities(roles, { selectedRegions: ["London"] }).map((role) => role.id))
      .toEqual([1, 2, 4]);
  });

  it("compares region values consistently despite casing or surrounding whitespace", () => {
    expect(filterOpportunities(
      [{ id: 1, targetRegions: [" london "] }],
      { selectedRegions: ["London"] },
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
      label: "Apply on company's website",
      usesWebsiteFallback: false,
    });

    expect(getOpportunityApplyAction({
      sourceType: "job_board",
      applyUrl: "https://board.example.com/jobs/42",
      contactWebsite: "https://employer.example.com",
    })).toEqual({
      destinationUrl: "https://board.example.com/jobs/42",
      label: "Apply Via Job Board",
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

  it("hides vacancy Apply actions on the Send CV view while retaining its other actions", () => {
    expect(shouldShowOpportunityApplyActions(true)).toBe(false);
    expect(shouldShowOpportunityApplyActions(false)).toBe(true);
    expect(["Send CV", "Smart Apply"]).toEqual(
      expect.arrayContaining(["Send CV", "Smart Apply"]),
    );
  });

  it("temporarily shows Send CV even when no direct contact is available", () => {
    expect(shouldShowSendCv(true)).toBe(true);
    expect(shouldShowSendCv(false)).toBe(true);
    expect(shouldShowSendCv(undefined)).toBe(true);
  });

  it("shows verified apply-only vacancies on the Send CV tab", () => {
    expect(shouldShowOnSendCvTab({
      sendCvEligible: false,
      applyUrl: "https://jobs.nhs.uk/candidate/jobadvert/C1234",
      linkVerified: true,
      linkStatus: "live",
    })).toBe(true);
    expect(shouldShowSendCv(false)).toBe(true);
  });

  it("keeps dead vacancy links off the Send CV tab while the temporary Send CV gate is active", () => {
    expect(shouldShowOnSendCvTab({
      sendCvEligible: false,
      applyUrl: "https://jobs.nhs.uk/candidate/jobadvert/C1234",
      linkVerified: false,
      linkStatus: "dead",
    })).toBe(false);
    expect(hasUsableSendCvApplyRoute({
      applyUrl: "https://linkedin.com/jobs/view/123",
      linkVerified: true,
      linkStatus: "live",
    })).toBe(false);
    expect(shouldShowOnSendCvTab({
      sendCvEligible: false,
      applyUrl: "https://linkedin.com/jobs/view/123",
      linkVerified: true,
      linkStatus: "live",
    })).toBe(true);
    expect(shouldShowOnSendCvTab({
      sendCvEligible: false,
      applyUrl: "https://uk.indeed.com/viewjob?jk=abc",
      linkVerified: true,
      linkStatus: "live",
    })).toBe(true);
  });

  it("keeps direct-email vacancies visible even when no verified apply route exists", () => {
    expect(shouldShowOnSendCvTab({
      sendCvEligible: true,
      applyUrl: null,
      linkVerified: false,
      linkStatus: "none",
    })).toBe(true);
    expect(canSendCvForVacancy({ sendCvEligible: true, applyUrl: null, linkStatus: "none" })).toBe(true);
    expect(canSendCvForVacancy({ sendCvEligible: true, applyUrl: "https://example.com/job", linkStatus: "dead" })).toBe(false);
    expect(canSendCvForVacancy({ sendCvEligible: true, applyUrl: "https://example.com/job", linkStatus: "stale" })).toBe(false);
  });

  it("temporarily includes sponsors without direct contact in the Send CV feed", () => {
    expect(filterSendCvSponsors([
      { id: 1, sendCvEligible: true },
      { id: 2, sendCvEligible: false },
      { id: 3 },
    ])).toEqual([
      { id: 1, sendCvEligible: true },
      { id: 2, sendCvEligible: false },
      { id: 3 },
    ]);
  });
});
