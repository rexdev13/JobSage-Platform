import { beforeEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
}));

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: createMock,
      },
    },
  },
}));

const { batchScoreRoles } = await import("../../lib/candidateAiMatch");

const profile = {
  profession: "IT Professional",
  specialty: "Platform engineering",
  experienceYears: 5,
  qualificationCountry: "United Kingdom",
  registrationStatus: "not_registered",
  requiresSponsorship: false,
};

function role(
  id: number,
  title: string,
  opportunityCategory: string,
) {
  return {
    id,
    title,
    employer: "Example Ltd",
    location: "London",
    regulator: opportunityCategory,
    opportunityCategory,
    sponsorshipOffered: true,
    requiredRegistration: "Relevant professional experience",
  };
}

describe("candidate AI category policy", () => {
  beforeEach(() => {
    createMock.mockReset();
  });

  it("scores an IT professional's software role instead of globally rejecting it", async () => {
    createMock.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            scores: [{
              roleId: 1,
              score: 88,
              explanation: "Strong software and platform engineering match",
            }],
          }),
        },
      }],
    });

    const result = await batchScoreRoles(profile, [
      role(1, "Software Engineer", "IT"),
    ]);

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(result.get(1)?.score).toBe(88);
  });

  it("deterministically rejects a professional role from another candidate category", async () => {
    const result = await batchScoreRoles(profile, [
      role(2, "Senior Staff Nurse", "NMC"),
    ]);

    expect(createMock).not.toHaveBeenCalled();
    expect(result.get(2)).toEqual({
      score: 0,
      explanation: "Out of professional scope",
    });
  });

  it("keeps the explicit manual-labour rule regardless of candidate category", async () => {
    const result = await batchScoreRoles(profile, [
      role(3, "Warehouse Operative", "IT"),
    ]);

    expect(createMock).not.toHaveBeenCalled();
    expect(result.get(3)).toEqual({
      score: 0,
      explanation: "Out of professional scope",
    });
  });
});