import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const {
  selectResults,
  insertedValues,
  completionCreate,
  getClaims,
  mockGetSession,
} = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
  insertedValues: [] as Array<Record<string, unknown>>,
  completionCreate: vi.fn(),
  getClaims: vi.fn(),
  mockGetSession: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  function table(fields: string[]) {
    return Object.fromEntries(fields.map((field) => [field, field]));
  }
  function chain(result: unknown[]): any {
    const value: any = {
      from: () => value,
      innerJoin: () => value,
      leftJoin: () => value,
      where: () => value,
      orderBy: () => value,
      limit: () => value,
      values: (values: Record<string, unknown>) => {
        insertedValues.push(values);
        return value;
      },
      set: () => value,
      onConflictDoNothing: () => value,
      onConflictDoUpdate: () => value,
      returning: () => Promise.resolve([]),
      then: (resolve: (result: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return value;
  }

  const tables = {
    rolesTable: table(["id", "active", "importedAt", "applyUrl", "liveness"]),
    profilesTable: table(["userId"]),
    decisionRecordsTable: table(["userId"]),
    rulesetRulesTable: table(["id"]),
    auditEventsTable: table(["id"]),
    applicationsTable: table(["id"]),
    speculativeApplicationsTable: table(["id"]),
    jobListingsTable: table(["id"]),
    employerProfilesTable: table(["id"]),
    candidateMatchScoresTable: table(["id"]),
    matchDismissalsTable: table(["id"]),
    vacancyFavoritesTable: table(["id"]),
    sponsorLicenceBookmarksTable: table(["id"]),
    sponsorLicencesTable: table(["id"]),
    smartApplyDraftsTable: table(["id"]),
    sponsorLicenceVacancyScoresTable: table(["id"]),
    roleGapAnalysesTable: table(["userId", "roleId", "generatedAt"]),
    sponsorLicenceGapAnalysesTable: table(["userId"]),
    usersTable: table(["id", "plan", "bonusReadinessChecks", "subscriptionExpiresAt"]),
    careerProfilesTable: table(["id"]),
  };

  return {
    db: {
      select: vi.fn(() => chain(selectResults.shift() ?? [])),
      insert: vi.fn(() => chain([])),
      update: vi.fn(() => chain([])),
      delete: vi.fn(() => chain([])),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    },
    ...tables,
  };
});

vi.mock("drizzle-orm", () => {
  const expression = vi.fn(() => ({}));
  const sql: any = vi.fn(() => ({}));
  sql.raw = vi.fn(() => ({}));
  return {
    eq: expression,
    desc: expression,
    and: expression,
    inArray: expression,
    gte: expression,
    or: expression,
    isNotNull: expression,
    ne: expression,
    sql,
  };
});

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: completionCreate } } },
}));

vi.mock("../../lib/readinessClaims", async () => {
  const actual = await vi.importActual<typeof import("../../lib/readinessClaims")>("../../lib/readinessClaims");
  return { ...actual, getCandidateReadinessClaims: getClaims };
});

vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return {
    ...actual,
    getSession: mockGetSession,
    clearSession: vi.fn(),
    deleteSession: vi.fn(),
    createSession: vi.fn().mockResolvedValue("sess"),
  };
});

vi.mock("../../middlewares/consentMiddleware", () => ({
  requireConsent: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));
vi.mock("../../lib/candidateAiMatch", () => ({ batchScoreRoles: vi.fn() }));
vi.mock("../../lib/candidateBoardDiscovery", () => ({
  candidateBoardSourceForProfession: vi.fn().mockReturnValue("nhs"),
  hasFreshCandidateBoardSnapshot: vi.fn().mockReturnValue(false),
  refreshCandidateBoardVacancies: vi.fn().mockResolvedValue({
    searched: false,
    discovered: 0,
    sponsorMatched: 0,
    inserted: 0,
    revived: 0,
  }),
}));
vi.mock("../../lib/sponsorshipFeasibility", () => ({ assessSponsorshipFeasibility: vi.fn() }));

const rolesRouter = (await import("../../routes/roles")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(rolesRouter);
  return app;
}

const claim = {
  claimKey: "No evidence of manual handling experience",
  claimText: "Manual handling experience",
};

describe("regular role readiness claim suppression", () => {
  beforeEach(() => {
    selectResults.length = 0;
    insertedValues.length = 0;
    completionCreate.mockReset();
    getClaims.mockResolvedValue([claim]);
    mockGetSession.mockResolvedValue({
      user: {
        id: "candidate-1",
        email: "candidate@test.com",
        role: "candidate",
        firstName: "Pat",
        lastName: "Lee",
        profileImageUrl: null,
      },
    });
  });

  it("filters a rephrased acknowledgement from cached regular-role results", async () => {
    selectResults.push([{
      matchedRequirements: [],
      gaps: ["Manual handling experience is not shown", "Medication administration experience"],
      optimizationSteps: [],
      generatedAt: new Date(),
    }]);

    const response = await request(buildApp())
      .get("/opportunities/roles/42/gap-analysis")
      .set("Authorization", "Bearer candidate-session");

    expect(response.status).toBe(200);
    expect(response.body.fromCache).toBe(true);
    expect(response.body.gaps).toEqual(["Medication administration experience"]);
  });

  it("filters a rephrased acknowledgement from generated regular-role results", async () => {
    selectResults.push(
      [],
      [{
        id: 42,
        title: "Staff Nurse",
        employer: "Example Trust",
        location: "London",
        regulator: "NMC",
        requiredRegistration: "NMC registration",
        sponsorshipOffered: true,
      }],
      [{
        profession: "nurse",
        specialty: "adult",
        experienceYears: 3,
        qualificationType: "degree",
        qualificationCountry: "Nigeria",
        registrationStatus: "not_started",
        residencyStatus: "overseas",
      }],
      [],
      [{ count: 0 }],
      [{ count: 0 }],
    );
    completionCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            matchedRequirements: [],
            gaps: ["Experience with manual handling", "Medication administration experience"],
            optimizationSteps: [],
          }),
        },
      }],
    });

    const response = await request(buildApp())
      .get("/opportunities/roles/42/gap-analysis")
      .set("Authorization", "Bearer candidate-session");

    expect(response.status).toBe(200);
    expect(response.body.fromCache).toBe(false);
    expect(response.body.gaps).toEqual(["Medication administration experience"]);
    expect(insertedValues.at(-1)?.gaps).toEqual(["Medication administration experience"]);
  });

  it("refreshes a stale existing role without consuming another quota slot", async () => {
    selectResults.push(
      [{
        matchedRequirements: [],
        gaps: ["Experience with manual handling"],
        optimizationSteps: [],
        generatedAt: new Date("2020-01-01T00:00:00Z"),
      }],
      [{
        id: 42,
        title: "Staff Nurse",
        employer: "Example Trust",
        location: "London",
        regulator: "NMC",
        requiredRegistration: "NMC registration",
        sponsorshipOffered: true,
      }],
      [{
        profession: "nurse",
        specialty: "adult",
        experienceYears: 3,
        qualificationType: "degree",
        qualificationCountry: "Nigeria",
        registrationStatus: "not_started",
        residencyStatus: "overseas",
      }],
    );
    completionCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            matchedRequirements: [],
            gaps: ["Experience with manual handling"],
            optimizationSteps: [],
          }),
        },
      }],
    });

    const response = await request(buildApp())
      .get("/opportunities/roles/42/gap-analysis")
      .set("Authorization", "Bearer candidate-session");

    expect(response.status).toBe(200);
    expect(response.body.fromCache).toBe(false);
    expect(response.body.gaps).toEqual([]);
  });
});