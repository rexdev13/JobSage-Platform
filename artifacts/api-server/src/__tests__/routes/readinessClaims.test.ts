import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { filterAcknowledgedGaps } from "../../lib/readinessClaims";

const { dbResults, mockGetSession } = vi.hoisted(() => ({
  dbResults: [] as any[],
  mockGetSession: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from() { return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return chain; },
      values() { return chain; },
      onConflictDoNothing() { return chain; },
      then(resolve: any, reject?: any) {
        return Promise.resolve(dbResults.shift() ?? []).then(resolve, reject);
      },
      returning() {
        return Promise.resolve(dbResults.shift() ?? []);
      },
    };
    return chain;
  }

  return {
    db: {
      select: vi.fn(() => makeChain()),
      insert: vi.fn(() => makeChain()),
    },
    candidateReadinessClaimsTable: {},
  };
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

const readinessClaimsRouter = (await import("../../routes/readinessClaims")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

const candidateSession = {
  user: {
    id: "candidate-1",
    email: "candidate@test.com",
    role: "candidate",
    firstName: "Pat",
    lastName: "Lee",
    profileImageUrl: null,
  },
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(readinessClaimsRouter);
  return app;
}

describe("candidate readiness claims", () => {
  beforeEach(() => {
    dbResults.length = 0;
    mockGetSession.mockResolvedValue(candidateSession);
  });

  it("requires authentication", async () => {
    mockGetSession.mockResolvedValue(null);
    const response = await request(buildApp()).get("/readiness/claims");
    expect(response.status).toBe(401);
  });

  it("does not expose claims to employer accounts", async () => {
    mockGetSession.mockResolvedValue({
      user: { ...candidateSession.user, id: "employer-1", role: "employer" },
    });
    const response = await request(buildApp())
      .get("/readiness/claims")
      .set("Authorization", "Bearer employer-session");
    expect(response.status).toBe(403);
  });

  it("returns only the signed-in candidate's selected claims", async () => {
    dbResults.push([{
      id: 9,
      userId: "candidate-1",
      claimKey: "venepuncture experience",
      claimText: "Venepuncture experience",
      sourceRoleId: 12,
      sourceVacancyId: null,
      createdAt: new Date("2026-08-29T08:00:00Z"),
      updatedAt: new Date("2026-08-29T08:00:00Z"),
    }]);
    const response = await request(buildApp())
      .get("/readiness/claims")
      .set("Authorization", "Bearer candidate-session");
    expect(response.status).toBe(200);
    expect(response.body.claims).toEqual([expect.objectContaining({
      id: 9,
      claimKey: "venepuncture experience",
      sourceRoleId: 12,
    })]);
    expect(response.body.claims[0]).not.toHaveProperty("userId");
  });

  it("validates claim input before writing", async () => {
    const response = await request(buildApp())
      .post("/readiness/claims")
      .set("Authorization", "Bearer candidate-session")
      .send({ claimText: " " });
    expect(response.status).toBe(400);
  });

  it.each([
    "My NMC registration is complete",
    "I have an active GMC PIN",
    "My professional licensure is current",
    "I already have an enhanced DBS",
    "My background check is complete",
    "My safeguarding training is current",
    "I have the right to work in the UK",
    "I have indefinite leave to remain",
    "My work authorisation is valid",
    "I do not require visa sponsorship",
  ])("rejects regulated profile claims without changing profile fields: %s", async (claimText) => {
    const response = await request(buildApp())
      .post("/readiness/claims")
      .set("Authorization", "Bearer candidate-session")
      .send({ claimText });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      code: "STRUCTURED_PROFILE_FIELD",
      profilePath: "/profile",
    });
  });

  it("creates a normalized self-declared claim with source context", async () => {
    dbResults.push(
      [],
      [{
        id: 10,
        userId: "candidate-1",
        claimKey: "venipuncture",
        claimText: "Venepuncture experience!",
        sourceRoleId: null,
        sourceVacancyId: 55,
        createdAt: new Date("2026-08-29T08:00:00Z"),
        updatedAt: new Date("2026-08-29T08:00:00Z"),
      }],
    );
    const response = await request(buildApp())
      .post("/readiness/claims")
      .set("Authorization", "Bearer candidate-session")
      .send({ claimText: "Venepuncture experience!", sourceVacancyId: 55 });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      created: true,
      claim: { claimKey: "venipuncture", sourceVacancyId: 55 },
    });
  });

  it("returns an equivalent legacy claim safely instead of inserting a duplicate", async () => {
    dbResults.push([{
      id: 10,
      userId: "candidate-1",
      claimKey: "No evidence of venepuncture experience",
      claimText: "Venepuncture experience",
      sourceRoleId: 12,
      sourceVacancyId: null,
      createdAt: new Date("2026-08-29T08:00:00Z"),
      updatedAt: new Date("2026-08-29T08:00:00Z"),
    }]);
    const response = await request(buildApp())
      .post("/readiness/claims")
      .set("Authorization", "Bearer candidate-session")
      .send({ claimText: "Venepuncture experience" });
    expect(response.status).toBe(200);
    expect(response.body.created).toBe(false);
    expect(response.body.claim.id).toBe(10);
  });

  it("filters rephrased gaps from cached or regenerated analyses using legacy keys", () => {
    const claims = [{ claimKey: "No evidence of venepuncture experience" }];
    expect(filterAcknowledgedGaps(["Venipuncture experience is not shown"], claims)).toEqual([]);
    expect(filterAcknowledgedGaps(["Medication administration experience"], claims)).toEqual([
      "Medication administration experience",
    ]);
  });

  it("never filters structured gaps based on legacy self-declared claims", () => {
    expect(filterAcknowledgedGaps(
      ["NMC registration is missing", "Enhanced DBS is not shown"],
      [{ claimKey: "NMC registration" }, { claimKey: "Enhanced DBS" }],
    )).toEqual(["NMC registration is missing", "Enhanced DBS is not shown"]);
  });
});