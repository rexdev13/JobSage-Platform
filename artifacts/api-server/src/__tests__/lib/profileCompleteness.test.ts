import { describe, expect, it } from "vitest";
import { computeSmartApplyReady } from "../../lib/profileCompleteness";

function completeProfile(overrides: Record<string, unknown> = {}) {
  return {
    profession: "nurse",
    specialty: "acute care",
    qualificationCountry: "UK",
    qualificationType: "BSc Nursing",
    qualificationYear: 2016,
    experienceYears: 7,
    registrationStatus: "registered",
    residencyStatus: "Outside UK",
    preferredRegion: [],
    preferredStartDate: new Date("2026-09-01"),
    languages: ["English"],
    ...overrides,
  } as unknown as Parameters<typeof computeSmartApplyReady>[0];
}

describe("computeSmartApplyReady", () => {
  it("does not block Smart Apply when the optional preferred-region search filter is empty", () => {
    expect(computeSmartApplyReady(completeProfile())).toEqual({
      ready: true,
      missingFields: [],
    });
  });

  it("still reports genuinely required application profile fields", () => {
    expect(computeSmartApplyReady(completeProfile({ profession: null }))).toEqual({
      ready: false,
      missingFields: ["Profession"],
    });
  });
});