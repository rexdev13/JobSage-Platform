import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const { profileResults, conflictUpdates } = vi.hoisted(() => ({
  profileResults: [] as any[],
  conflictUpdates: [] as any[],
}));

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from() { return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return chain; },
      values() { return chain; },
      set() { return chain; },
      onConflictDoUpdate(config: any) { conflictUpdates.push(config); return chain; },
      then(resolve: any, reject?: any) {
        return Promise.resolve(profileResults.shift() ?? []).then(resolve, reject);
      },
      catch() { return chain; },
      returning() { return Promise.resolve(profileResults.shift() ?? []); },
    };
    return chain;
  }
  return {
    db: {
      select: () => makeChain(),
      insert: () => makeChain(),
      update: () => makeChain(),
      delete: () => makeChain(),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    },
    profilesTable: {},
    usersTable: {},
    consentLogsTable: {},
    sessionsTable: {},
  };
});

const mockGetSession = vi.fn().mockResolvedValue({
  user: { id: "candidate-1", email: "cand@test.com", role: "candidate", firstName: "Jane", lastName: "Doe", profileImageUrl: null },
});

vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return {
    ...actual,
    createSession: vi.fn().mockResolvedValue("sess"),
    getSession: mockGetSession,
    clearSession: vi.fn(),
    deleteSession: vi.fn(),
  };
});

vi.mock("../../lib/jobsageEmailGen", () => ({
  generateJobsageEmail: vi.fn().mockReturnValue("jane.doe.1234@jobsage.co.uk"),
}));

vi.mock("../../lib/audit", () => ({
  writeAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

const profileRouter = (await import("../../routes/profiles")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(profileRouter);
  return app;
}

const AUTH_HEADER = "Bearer candidate-session-token";
const candidateSession = {
  user: { id: "candidate-1", email: "cand@test.com", role: "candidate", firstName: "Jane", lastName: "Doe", profileImageUrl: null },
};
const consentRow = { id: 1, userId: "candidate-1", consentedAt: new Date() };
const profileRow = {
  id: 10, userId: "candidate-1", profession: "nurse", specialty: "ICU",
  qualificationCountry: "Nigeria", qualificationType: "bachelor",
  qualificationYear: 2015, experienceYears: 5,
  registrationStatus: "registered" as const, licenceReady: true,
  dbsClearanceLevel: "enhanced" as const, safeguardingTrainingLevel: "level_2" as const,
  residencyStatus: "visa_required", requiresSponsorship: true,
  preferredRegion: ["London"], alertFrequency: "daily" as const,
  preferredStartDate: null, profilePhotoKey: null, languages: ["English"],
  additionalNotes: null, jobsageEmail: "jane.doe.1234@jobsage.co.uk",
  profileBoostActive: false, profileBoostExpiry: null,
  lastAlertSentAt: null, boostProfile: false,
  createdAt: new Date("2024-01-01"), updatedAt: new Date("2024-06-01"),
};

// ─── GET /profiles/me ───────────────────────────────────────────────
describe("GET /profiles/me", () => {
  beforeEach(() => {
    profileResults.length = 0;
    conflictUpdates.length = 0;
    mockGetSession.mockResolvedValue(candidateSession);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const resp = await request(buildApp()).get("/profiles/me");
    expect(resp.status).toBe(401);
  });

  it("returns 403 when consent not given", async () => {
    profileResults.push([]);
    const resp = await request(buildApp())
      .get("/profiles/me")
      .set("Authorization", AUTH_HEADER);
    expect(resp.status).toBe(403);
    expect(resp.body.error).toMatch(/consent/i);
  });

  it("returns 404 when profile not found", async () => {
    profileResults.push([consentRow]);
    profileResults.push([]);
    const resp = await request(buildApp())
      .get("/profiles/me")
      .set("Authorization", AUTH_HEADER);
    expect(resp.status).toBe(404);
    expect(resp.body.error).toMatch(/not found/i);
  });

  it("returns 200 with profile including completionPct", async () => {
    profileResults.push([consentRow]);
    profileResults.push([{ ...profileRow }]);
    const resp = await request(buildApp())
      .get("/profiles/me")
      .set("Authorization", AUTH_HEADER);
    expect(resp.status).toBe(200);
    expect(resp.body).toHaveProperty("profession", "nurse");
    expect(resp.body).toHaveProperty("completionPct");
    expect(typeof resp.body.completionPct).toBe("number");
  });
});

// ─── PUT /profiles/me ───────────────────────────────────────────────
describe("PUT /profiles/me", () => {
  const validBody = {
    profession: "nurse",
    specialty: "ICU",
    qualificationCountry: "Nigeria",
    qualificationType: "bachelor",
    qualificationYear: 2015,
    experienceYears: 5,
    registrationStatus: "registered",
    residencyStatus: "visa_required",
    requiresSponsorship: true,
    preferredRegion: ["London"],
  };

  beforeEach(() => {
    profileResults.length = 0;
    conflictUpdates.length = 0;
    mockGetSession.mockResolvedValue(candidateSession);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const resp = await request(buildApp()).put("/profiles/me").send(validBody);
    expect(resp.status).toBe(401);
  });

  it("returns 403 when consent not given", async () => {
    profileResults.push([]);
    const resp = await request(buildApp())
      .put("/profiles/me")
      .set("Authorization", AUTH_HEADER)
      .send(validBody);
    expect(resp.status).toBe(403);
  });

  it("returns 400 on invalid body (missing required fields)", async () => {
    profileResults.push([consentRow]);
    const resp = await request(buildApp())
      .put("/profiles/me")
      .set("Authorization", AUTH_HEADER)
      .send({ profession: "nurse" });
    expect(resp.status).toBe(400);
  });

  it("returns 200 with upserted profile on valid body", async () => {
    profileResults.push([consentRow]);
    profileResults.push([{ jobsageEmail: "jane.doe.1234@jobsage.co.uk" }]);
    profileResults.push([{ ...profileRow }]);
    const resp = await request(buildApp())
      .put("/profiles/me")
      .set("Authorization", AUTH_HEADER)
      .send(validBody);
    expect(resp.status).toBe(200);
    expect(resp.body).toHaveProperty("profession", "nurse");
  });

  it("preserves recorded safeguarding values when a partial profile save omits them", async () => {
    profileResults.push([consentRow]);
    profileResults.push([{ ...profileRow }]);
    profileResults.push([{ ...profileRow }]);
    const resp = await request(buildApp())
      .put("/profiles/me")
      .set("Authorization", AUTH_HEADER)
      .send(validBody);
    expect(resp.status).toBe(200);
    const updateSet = conflictUpdates.at(-1)?.set ?? {};
    expect(updateSet).not.toHaveProperty("dbsClearanceLevel");
    expect(updateSet).not.toHaveProperty("safeguardingTrainingLevel");
  });
});

// ─── GET /professions ───────────────────────────────────────────────
describe("GET /professions", () => {
  beforeEach(() => {
    profileResults.length = 0;
    mockGetSession.mockResolvedValue(candidateSession);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const resp = await request(buildApp()).get("/professions");
    expect(resp.status).toBe(401);
  });

  it("returns 200 with profession list", async () => {
    // db.execute is mocked to return { rows: [] }, well-known professions still included
    const resp = await request(buildApp())
      .get("/professions")
      .set("Authorization", AUTH_HEADER);
    expect(resp.status).toBe(200);
    expect(resp.body).toHaveProperty("professions");
    expect(Array.isArray(resp.body.professions)).toBe(true);
    expect(resp.body.professions.length).toBeGreaterThan(0);
  });
});
