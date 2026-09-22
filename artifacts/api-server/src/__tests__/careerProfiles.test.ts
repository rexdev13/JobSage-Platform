import { describe, expect, it } from "vitest";
import {
  buildCareerProfileMakerEvidence,
  buildCareerProfileMakerSystemPrompt,
  buildCareerProfileMakerUserPrompt,
  validateCareerProfileMakerSource,
} from "../routes/careerProfiles";

describe("AI CV Maker evidence contract", () => {
  it("keeps only confirmed allowlisted profile/source fields", () => {
    const evidence = buildCareerProfileMakerEvidence({
      careerProfile: { name: "Clinical direction", focusArea: "Critical Care" },
      baseProfile: {
        profession: "nurse",
        specialty: "Adult nursing",
        qualificationType: "BSc Nursing",
        qualificationCountry: "Ghana",
        qualificationYear: 2018,
        experienceYears: 7,
        registrationStatus: "registered",
        languages: ["English"],
        additionalNotes: "Worked at Fictional General Hospital and led a 20-bed ICU.",
        streetAddress: "1 Private Street",
      },
      sourceParsedData: {
        profession: "nurse",
        rawNotes: "Employer: Fictional General Hospital; achieved a 30% reduction.",
        confidence: { profession: "high" },
        qualificationType: "BSc Nursing",
      },
      contactEmail: "candidate@jobsage.co.uk",
    });

    expect(evidence.candidateName).toBe("Clinical direction");
    expect(evidence.targetDirection).toBe("Critical Care");
    expect(evidence.profileFacts).toEqual({
      profession: "nurse",
      specialty: "Adult nursing",
      qualificationType: "BSc Nursing",
      qualificationCountry: "Ghana",
      qualificationYear: 2018,
      experienceYears: 7,
      registrationStatus: "registered",
      languages: ["English"],
      contactEmail: "candidate@jobsage.co.uk",
    });
    expect(evidence.profileFacts).not.toHaveProperty("additionalNotes");
    expect(evidence.profileFacts).not.toHaveProperty("streetAddress");
    expect(evidence.sourceCvFacts).toEqual({
      profession: "nurse",
      qualificationType: "BSc Nursing",
    });
    expect(evidence.sourceCvFacts).not.toHaveProperty("rawNotes");
    expect(evidence.sourceCvFacts).not.toHaveProperty("confidence");
  });

  it("treats missing source data as absent instead of turning notes into facts", () => {
    const evidence = buildCareerProfileMakerEvidence({
      careerProfile: { name: "Academic direction", focusArea: "Clinical education" },
      baseProfile: { profession: "nurse", qualificationYear: 0, experienceYears: 0 },
      sourceParsedData: { rawNotes: "The candidate worked at an unconfirmed employer." },
    });

    expect(evidence.sourceCvFacts).toBeNull();
    expect(evidence.profileFacts).toEqual({ profession: "nurse" });
  });

  it("states that the focus is direction only and requires visible completion requests", () => {
    const systemPrompt = buildCareerProfileMakerSystemPrompt();
    const userPrompt = buildCareerProfileMakerUserPrompt({
      candidateName: "Clinical direction",
      profileFacts: { profession: "nurse" },
      sourceCvFacts: null,
      targetDirection: "Critical Care",
    });

    expect(systemPrompt).toContain("targetDirection is targeting guidance only");
    expect(systemPrompt).toContain("Never invent or guess employers");
    expect(systemPrompt).toContain("obvious bracketed completion request");
    expect(systemPrompt).not.toContain("submission-ready CV");
    expect(userPrompt).toContain('"targetDirection": "Critical Care"');
    expect(userPrompt).toContain("Do not fill gaps with plausible or approximate content");
  });
});

describe("AI CV Maker source-CV ownership and readiness", () => {
  it("rejects missing, foreign, or non-CV documents without exposing ownership", () => {
    expect(validateCareerProfileMakerSource(null, "candidate-1")?.statusCode).toBe(404);
    expect(
      validateCareerProfileMakerSource(
        { userId: "candidate-2", documentType: "cv", parsedData: {} },
        "candidate-1",
      )?.error,
    ).toContain("Source CV not found");
    expect(
      validateCareerProfileMakerSource(
        { userId: "candidate-1", documentType: "qualification", parsedData: {} },
        "candidate-1",
      )?.statusCode,
    ).toBe(404);
  });

  it("requires candidate-confirmed parsed fields on an owned CV", () => {
    const result = validateCareerProfileMakerSource(
      { userId: "candidate-1", documentType: "cv", parsedData: null },
      "candidate-1",
    );

    expect(result).toEqual({
      statusCode: 400,
      error: expect.stringContaining("Parse it and save the reviewed fields"),
    });
  });

  it("accepts an owned CV after candidate-confirmed fields are saved", () => {
    expect(
      validateCareerProfileMakerSource(
        { userId: "candidate-1", documentType: "cv", parsedData: { profession: "nurse" } },
        "candidate-1",
      ),
    ).toBeNull();
  });
});