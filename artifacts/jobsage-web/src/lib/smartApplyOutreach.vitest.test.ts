import { describe, expect, it } from "vitest";
import { compileSmartApplyOutreach } from "./smartApplyOutreach";

describe("compileSmartApplyOutreach", () => {
  it("compiles all six questionnaire answers into seamless body paragraphs", () => {
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

    expect(result).toBe([
      "I am motivated by patient-centred care.",
      "I have four years of ward experience.",
      "I am NMC registered.",
      "I require Skilled Worker sponsorship.",
      "I communicate clearly and work calmly under pressure.",
      "I can start after one month's notice.",
    ].join("\n\n"));
    expect(result).not.toContain("Dear Hiring Team");
    expect(result).not.toContain("Motivation:");
    expect(result).not.toContain("Kind regards");
  });
});