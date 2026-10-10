import { beforeEach, describe, expect, it, vi } from "vitest";

const { createCompletion } = vi.hoisted(() => ({ createCompletion: vi.fn() }));

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: createCompletion } } },
}));

import { prefillApplicationAnswers } from "../../lib/smartApply";

const profile = {
  profession: "nurse",
  specialty: "adult medical nursing",
  qualificationCountry: "Ghana",
  qualificationType: "BSc Nursing",
  qualificationYear: 2017,
  experienceYears: 8,
  registrationStatus: "in_process",
  requiresSponsorship: true,
  additionalNotes: null,
  cvText: "Eight years on adult medical wards. NMC application in progress.",
};

const role = {
  title: "Adult Ward Staff Nurse",
  employer: "Example Health Trust",
  description: "Adult medical ward.",
  regulator: "NMC",
  location: "Manchester",
  sponsorshipOffered: true,
};

function modelPrefills(overrides: Record<string, unknown> = {}) {
  return [
    { questionId: "motivation", aiAnswer: "I am passionate about this role.", confidence: "high", needsReview: false },
    { questionId: "clinical_experience", aiAnswer: "I have eight years on adult medical wards.", confidence: "high", needsReview: false },
    { questionId: "uk_registration", aiAnswer: "My NMC application is in process.", confidence: "high", needsReview: false },
    { questionId: "right_to_work", aiAnswer: "I require visa sponsorship.", confidence: "high", needsReview: false },
    { questionId: "strengths", aiAnswer: "My strengths include excellent teamwork.", confidence: "high", needsReview: false },
    { questionId: "availability", aiAnswer: "I can start as soon as my visa is approved.", confidence: "high", needsReview: false },
    ...Object.values(overrides),
  ];
}

describe("Smart Apply prefill safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blanks questions without structured evidence and forces review on every generated answer", async () => {
    createCompletion.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ prefills: modelPrefills() }) } }],
    });

    const result = await prefillApplicationAnswers(profile, role);
    const byId = Object.fromEntries(result.map((item) => [item.questionId, item]));

    expect(byId.motivation.aiAnswer).toBe("");
    expect(byId.strengths.aiAnswer).toBe("");
    expect(byId.availability.aiAnswer).toBe("");
    expect(byId.clinical_experience.aiAnswer).toBe("I have eight years on adult medical wards.");
    expect(result).toHaveLength(6);
    expect(result.every((item) => item.needsReview)).toBe(true);
    expect(result.filter((item) => item.aiAnswer).every((item) => item.confidence === "medium")).toBe(true);
    expect(createCompletion).toHaveBeenCalledWith(expect.objectContaining({ model: "gpt-4o" }));
  });

  it("leaves no-evidence answers blank even if the model supplies text or omits review flags", async () => {
    createCompletion.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            prefills: [
              { questionId: "clinical_experience", aiAnswer: "An unsupported answer.", confidence: "none" },
              { questionId: "uk_registration", aiAnswer: "I am registered.", confidence: "high", needsReview: false },
            ],
          }),
        },
      }],
    });

    const result = await prefillApplicationAnswers(profile, role);
    const byId = Object.fromEntries(result.map((item) => [item.questionId, item]));

    expect(byId.clinical_experience.aiAnswer).toBe("");
    expect(byId.clinical_experience.confidence).toBe("none");
    expect(byId.uk_registration.needsReview).toBe(true);
    expect(byId.right_to_work.aiAnswer).toBe("");
    expect(result).toHaveLength(6);
  });
});
