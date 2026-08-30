import { describe, expect, it } from "vitest";
import { regulatorForProfession } from "../../lib/opportunityProfession";
import {
  ONBOARDING_PROFESSIONS,
  professionCategoryFor,
  statutoryRegulatorForCategory,
} from "../../lib/professionCategory";

describe("opportunity profession mapping", () => {
  it.each([
    ["Doctor", "GMC"],
    ["Nurse", "NMC"],
    ["Midwife", "NMC"],
    ["Allied Health Professional", "HCPC"],
    ["Clinical Academic", "GMC"],
    ["Dentist", "DENTAL"],
    ["Pharmacist", "PHARMACY"],
    ["Optometrist", "HCPC"],
    ["Physiotherapist", "HCPC"],
    ["Radiographer", "HCPC"],
    ["Paramedic", "HCPC"],
    ["Occupational Therapist", "HCPC"],
    ["Social Worker", "SOCIAL_WORK"],
    ["Teacher / Lecturer", "EDUCATION"],
    ["Engineer", "ENGINEERING"],
    ["Accountant", "ACCOUNTING"],
    ["IT Professional", "IT"],
    ["Lawyer / Solicitor", "LEGAL"],
    ["Architect", "ARCHITECTURE"],
  ])("maps onboarding profession %s to %s", (profession, expected) => {
    expect(professionCategoryFor(profession)).toBe(expected);
  });

  it("keeps the onboarding source of truth at 19 non-null mappings", () => {
    expect(ONBOARDING_PROFESSIONS).toHaveLength(19);
    expect(ONBOARDING_PROFESSIONS.every((profession) => professionCategoryFor(profession) !== null)).toBe(true);
  });

  it("keeps opportunity categories separate from statutory regulators", () => {
    expect(statutoryRegulatorForCategory(professionCategoryFor("Doctor"))).toBe("GMC");
    expect(statutoryRegulatorForCategory(professionCategoryFor("Nurse"))).toBe("NMC");
    expect(statutoryRegulatorForCategory(professionCategoryFor("Teacher / Lecturer"))).toBeNull();
    expect(statutoryRegulatorForCategory(professionCategoryFor("Accountant"))).toBeNull();
  });

  it.each([
    ["clinical academic", "GMC"],
    ["allied-health-professional", "HCPC"],
    [" Teacher / Lecturer ", "EDUCATION"],
    ["teacher_/_lecturer", "EDUCATION"],
    ["teacher", "EDUCATION"],
    ["teaching", "EDUCATION"],
    ["engineer", "ENGINEERING"],
    ["engineering", "ENGINEERING"],
  ])("maps %s to %s", (profession, expected) => {
    expect(regulatorForProfession(profession)).toBe(expected);
  });
});