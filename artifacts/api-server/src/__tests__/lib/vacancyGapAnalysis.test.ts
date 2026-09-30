import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectResults, insertedValues, completionCreate } = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  insertedValues: [] as Array<Record<string, unknown>>,
  completionCreate: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  function selectChain(result: unknown[]): any {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  }

  return {
    db: {
      select: vi.fn(() => selectChain(selectResults.shift() ?? [])),
      insert: vi.fn(() => ({
        values: (values: Record<string, unknown>) => {
          insertedValues.push(values);
          return {
            onConflictDoUpdate: () => Promise.resolve(),
          };
        },
      })),
    },
    candidateReadinessClaimsTable: { userId: "userId", createdAt: "createdAt" },
    profilesTable: { userId: "userId" },
    sponsorLicenceVacanciesTable: { id: "id" },
    sponsorLicenceGapAnalysesTable: {
      userId: "userId",
      vacancyId: "vacancyId",
      generatedAt: "generatedAt",
    },
    roleGapAnalysesTable: {
      userId: "userId",
      generatedAt: "generatedAt",
    },
    usersTable: {
      id: "id",
      plan: "plan",
      bonusReadinessChecks: "bonusReadinessChecks",
      subscriptionExpiresAt: "subscriptionExpiresAt",
    },
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  gte: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: completionCreate,
      },
    },
  },
}));

const { getOrGenerateGapAnalysis } = await import("../../lib/vacancyGapAnalysis");

const legacyClaim = {
  id: 1,
  userId: "candidate-1",
  claimKey: "No evidence of venepuncture experience",
  claimText: "No evidence of venepuncture experience",
  sourceRoleId: 12,
  sourceVacancyId: null,
  createdAt: new Date("2026-08-01T10:00:00Z"),
  updatedAt: new Date("2026-08-01T10:00:00Z"),
};

describe("sponsor vacancy readiness claim suppression", () => {
  beforeEach(() => {
    selectResults.length = 0;
    insertedValues.length = 0;
    completionCreate.mockReset();
  });

  it("filters rephrased claims whenever a cached analysis is reopened", async () => {
    selectResults.push(
      [legacyClaim],
      [{
        matchedRequirements: [],
        gaps: ["Venipuncture experience is not shown", "Medication administration experience"],
        optimizationSteps: [],
        generatedAt: new Date(),
      }],
    );

    const result = await getOrGenerateGapAnalysis("candidate-1", 55);

    expect(result.fromCache).toBe(true);
    expect(result.gaps).toEqual(["Medication administration experience"]);
    expect(completionCreate).not.toHaveBeenCalled();
  });

  it("filters rephrased claims from regenerated analyses before caching them", async () => {
    selectResults.push(
      [legacyClaim],
      [],
      [],
      [{ count: 0 }],
      [{ count: 0 }],
      [{
        profession: "nurse",
        specialty: "adult",
        experienceYears: 3,
        qualificationType: "degree",
        qualificationCountry: "Nigeria",
        qualificationYear: 2022,
        registrationStatus: "not_started",
        residencyStatus: "overseas",
        requiresSponsorship: true,
        preferredRegion: [],
        languages: [],
        additionalNotes: null,
      }],
      [{
        id: 55,
        title: "Staff Nurse",
        organisationName: "Example Trust",
        location: "London",
        salary: null,
        postedDate: null,
        description: "Ward role",
      }],
    );
    completionCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            matchedRequirements: [],
            gaps: ["Venipuncture experience is not shown", "Medication administration experience"],
            optimizationSteps: [],
          }),
        },
      }],
    });

    const result = await getOrGenerateGapAnalysis("candidate-1", 55);

    expect(result.fromCache).toBe(false);
    expect(result.gaps).toEqual(["Medication administration experience"]);
    expect(insertedValues[0]?.gaps).toEqual(["Medication administration experience"]);
  });
});