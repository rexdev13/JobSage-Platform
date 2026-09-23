import {
  getProfileCompletenessTarget,
  getProfileCompletenessSectionLabel,
  getRemainingCompletenessPct,
  PROFILE_COMPLETENESS_FIELD_LABELS,
} from "./profileCompletenessChecklist";

describe("profile completeness checklist", () => {
  it("maps every field calculated by the profile completeness list to a profile section", () => {
    expect(PROFILE_COMPLETENESS_FIELD_LABELS).toEqual([
      "Profession",
      "Specialty",
      "Qualification country",
      "Qualification type",
      "Qualification year",
      "Years of experience",
      "Registration status",
      "Residency status",
      "Preferred region",
      "Preferred start date",
      "Profile photo",
      "Languages",
      "Additional notes",
    ]);

    for (const label of PROFILE_COMPLETENESS_FIELD_LABELS) {
      expect(getProfileCompletenessTarget(label)).toMatch(/^profile-/);
    }
  });

  it("reports the rounded percentage remaining without exceeding the score bounds", () => {
    expect(getRemainingCompletenessPct(92)).toBe(8);
    expect(getRemainingCompletenessPct(100)).toBe(0);
    expect(getRemainingCompletenessPct(-10)).toBe(100);
    expect(getRemainingCompletenessPct(120)).toBe(0);
  });

  it("does not invent a destination for an unknown calculator label", () => {
    expect(getProfileCompletenessTarget("Unlisted requirement")).toBeNull();
  });

  it("provides the section name shown beside each blocker", () => {
    expect(getProfileCompletenessSectionLabel("Profession")).toBe("Professional Information");
    expect(getProfileCompletenessSectionLabel("Profile photo")).toBe("Profile photo");
    expect(getProfileCompletenessSectionLabel("Unlisted requirement")).toBe("Profile");
  });
});