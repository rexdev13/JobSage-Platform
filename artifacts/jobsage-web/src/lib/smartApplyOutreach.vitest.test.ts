import { describe, expect, it } from "vitest";
import { compileSmartApplyOutreach } from "./smartApplyOutreach";

describe("compileSmartApplyOutreach", () => {
  it("compiles all six questionnaire answers into the employer message", () => {
    const result = compileSmartApplyOutreach({
      employerName: "Example NHS Trust",
      jobTitle: "Staff Nurse",
      candidateName: "Jane Doe",
      answers: {
        motivation: "I am motivated by patient-centred care.",
        clinical_experience: "I have four years of ward experience.",
        uk_registration: "I am NMC registered.",
        right_to_work: "I require Skilled Worker sponsorship.",
        strengths: "I communicate clearly and work calmly under pressure.",
        availability: "I can start after one month's notice.",
      },
    });

    expect(result).toContain("Dear Hiring Team at Example NHS Trust,");
    expect(result).toContain("interest in the Staff Nurse position");
    expect(result).toContain("• Motivation:\nI am motivated by patient-centred care.");
    expect(result).toContain("• Relevant Clinical Experience:\nI have four years of ward experience.");
    expect(result).toContain("• UK Regulatory Registration Status:\nI am NMC registered.");
    expect(result).toContain("• Right to Work & Sponsorship Status:\nI require Skilled Worker sponsorship.");
    expect(result).toContain("• Key Professional Strengths:\nI communicate clearly and work calmly under pressure.");
    expect(result).toContain("• Availability & Notice Period:\nI can start after one month's notice.");
    expect(result).toContain("Kind regards,\nJane Doe");
  });
});