import { describe, expect, it } from "vitest";
import {
  compareOpportunityRanking,
  effectiveOpportunityScore,
  qualifiesForApplyFirst,
} from "../../lib/opportunityRanking";

function opportunity(overrides: Partial<{
  aiScore: number | null;
  matchScore: number;
  isEligible: boolean;
  linkVerified: boolean;
  id: number;
}> = {}) {
  return {
    aiScore: overrides.aiScore ?? null,
    matchScore: overrides.matchScore ?? 50,
    isEligible: overrides.isEligible ?? true,
    linkVerified: overrides.linkVerified ?? false,
    role: { id: overrides.id ?? 1 },
  };
}

describe("opportunity ranking", () => {
  it("ranks a stronger professional match above a verified low score", () => {
    const strong = opportunity({ id: 1, aiScore: 71, linkVerified: false });
    const weakVerified = opportunity({ id: 2, aiScore: 0, linkVerified: true });
    expect([weakVerified, strong].sort(compareOpportunityRanking).map((item) => item.role.id)).toEqual([1, 2]);
  });

  it("uses link verification only as a tie-breaker", () => {
    const unverifiedEligible = opportunity({ id: 1, aiScore: 70, linkVerified: false, isEligible: true });
    const verifiedIneligible = opportunity({ id: 2, aiScore: 70, linkVerified: true, isEligible: false });
    expect([unverifiedEligible, verifiedIneligible].sort(compareOpportunityRanking).map((item) => item.role.id))
      .toEqual([2, 1]);
  });

  it("never marks low-scoring or ineligible roles Apply First", () => {
    expect(qualifiesForApplyFirst(opportunity({ aiScore: 54 }))).toBe(false);
    expect(qualifiesForApplyFirst(opportunity({ aiScore: 90, isEligible: false }))).toBe(false);
    expect(qualifiesForApplyFirst(opportunity({ aiScore: 55, isEligible: true }))).toBe(true);
    expect(effectiveOpportunityScore(opportunity({ aiScore: null, matchScore: 68 }))).toBe(68);
  });

  it("puts the seeded proof role above unscored opportunities using the persisted score", () => {
    const proofRole = opportunity({ id: 9001, aiScore: 100, linkVerified: true });
    const pendingRole = opportunity({ id: 1, aiScore: 50, linkVerified: true });

    expect([pendingRole, proofRole].sort(compareOpportunityRanking).map((item) => item.role.id))
      .toEqual([9001, 1]);
  });
});