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
    ["Software Engineering", "IT"],
    ["Business Development Manager", "BUSINESS_DEVELOPMENT"],
  ])("maps onboarding profession %s to %s", (profession, expected) => {
    expect(professionCategoryFor(profession)).toBe(expected);
  });

  it("keeps every onboarding profession on a non-null opportunity category", () => {
    expect(ONBOARDING_PROFESSIONS).toHaveLength(21);
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
    ["Software Engineering", "IT"],
    ["business_development_manager", "BUSINESS_DEVELOPMENT"],
  ])("maps %s to %s", (profession, expected) => {
    expect(regulatorForProfession(profession)).toBe(expected);
  });
});