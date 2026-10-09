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
    ["Finance Professional", "FINANCE"],
    ["IT Professional", "IT"],
    ["Lawyer / Solicitor", "LEGAL"],
    ["Architect", "ARCHITECTURE"],
    ["Software Engineering", "IT"],
    ["Business Development Manager", "BUSINESS_DEVELOPMENT"],
    ["Hospitality", "HOSPITALITY"],
    ["Construction", "CONSTRUCTION"],
    ["Manufacturing", "MANUFACTURING"],
    ["Retail", "RETAIL"],
    ["Healthcare Support", "HEALTHCARE_SUPPORT"],
    ["Care / Support Work", "CARE_SUPPORT"],
    ["Clinical / Healthcare Practitioner", "HEALTHCARE_CLINICAL"],
    ["Research / Academia", "RESEARCH_ACADEMIA"],
    ["Project / Programme Management", "PROJECT_PROGRAMME"],
    ["Human Resources / Recruitment", "HR_RECRUITMENT"],
    ["Procurement / Supply Chain", "PROCUREMENT_SUPPLY_CHAIN"],
    ["Transport / Logistics", "TRANSPORT_LOGISTICS"],
  ])("maps onboarding profession %s to %s", (profession, expected) => {
    expect(professionCategoryFor(profession)).toBe(expected);
  });

  it("keeps every onboarding profession on a non-null opportunity category", () => {
    expect(ONBOARDING_PROFESSIONS.length).toBeGreaterThanOrEqual(35);
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
    ["finance", "FINANCE"],
    ["Software Engineering", "IT"],
    ["business_development_manager", "BUSINESS_DEVELOPMENT"],
    ["hospitality", "HOSPITALITY"],
    ["construction", "CONSTRUCTION"],
    ["manufacturing", "MANUFACTURING"],
    ["retail", "RETAIL"],
    ["healthcare assistant", "HEALTHCARE_SUPPORT"],
    ["care assistant", "CARE_SUPPORT"],
    ["clinical practitioner", "HEALTHCARE_CLINICAL"],
    ["academic research", "RESEARCH_ACADEMIA"],
    ["project manager", "PROJECT_PROGRAMME"],
    ["human resources", "HR_RECRUITMENT"],
    ["public affairs", "PUBLIC_POLICY"],
  ])("maps %s to %s", (profession, expected) => {
    expect(regulatorForProfession(profession)).toBe(expected);
  });
});
