import { describe, expect, it } from "vitest";
import { isExamPrepVideoForProfession, normalizeExamPrepProfession } from "./examPrepAccess";

describe("professional exam-prep eligibility", () => {
  it.each([
    ["Doctor", "doctor"],
    ["registered nurse", "nurse"],
    ["Dentist", "dentist"],
  ])("normalizes supported profession %s", (value, expected) => {
    expect(normalizeExamPrepProfession(value)).toBe(expected);
  });

  it.each(["Midwife", "Pharmacist", "Allied Health Professional", "", null])(
    "does not grant exam-prep access to unsupported profession %s",
    (value) => {
      expect(normalizeExamPrepProfession(value)).toBeNull();
    },
  );

  it("filters registration resources to the candidate profession", () => {
    const nurseResource = { category: "professional_registration", applicability: "Nurses preparing for CBT and OSCE" } as const;
    const dentistResource = { category: "professional_registration", applicability: "Dentists preparing for ORE" } as const;
    const unrelatedResource = { category: "jobsage", applicability: "All healthcare professionals" } as const;

    expect(isExamPrepVideoForProfession(nurseResource, "nurse")).toBe(true);
    expect(isExamPrepVideoForProfession(dentistResource, "nurse")).toBe(false);
    expect(isExamPrepVideoForProfession(unrelatedResource, "nurse")).toBe(false);
  });
});
