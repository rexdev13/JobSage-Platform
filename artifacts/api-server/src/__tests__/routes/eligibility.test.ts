import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const { eligResults } = vi.hoisted(() => ({ eligResults: [] as any[] }));

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from() { return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return chain; },
      values() { return chain; },
      set() { return chain; },
      then(resolve: any, reject?: any) {
        return Promise.resolve(eligResults.shift() ?? []).then(resolve, reject);
      },
      catch() { return chain; },
      returning() { return Promise.resolve(eligResults.shift() ?? []); },
    };
    return chain;
  }
  return {
    db: {
      select: () => makeChain(),
      insert: () => makeChain(),
      update: () => makeChain(),
      delete: () => makeChain(),
    },
    profilesTable: {},
    rulesetsTable: {},
    rulesetRulesTable: {},
    decisionRecordsTable: {},
    reviewCasesTable: {},
  };
});

vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return {
    ...actual,
    getSession: vi.fn().mockResolvedValue({
      user: { id: "cand-1", email: "cand@test.com", role: "candidate", firstName: null, lastName: null, profileImageUrl: null },
    }),
    clearSession: vi.fn(),
    deleteSession: vi.fn(),
    createSession: vi.fn().mockResolvedValue("sess"),
  };
});

vi.mock("../../middlewares/consentMiddleware", () => ({
  requireConsent: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("../../routes/remediation", () => ({
  ensureRemediationPlan: vi.fn().mockResolvedValue(undefined),
}));

const eligibilityRouter = (await import("../../routes/eligibility")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(eligibilityRouter);
  return app;
}

const SESS = "cand-session";

describe("POST /eligibility/evaluate", () => {
  beforeEach(() => { eligResults.length = 0; });

  it("returns 400 when no profile found", async () => {
    eligResults.push([]);
    const app = buildApp();
    const res = await request(app)
      .post("/eligibility/evaluate")
      .set("Authorization", `Bearer ${SESS}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Profile not found");
  });

  it("returns 400 when no ruleset found for profession", async () => {
    eligResults.push(
      [{ id: 1, userId: "cand-1", profession: "accountant", qualificationCountry: "UK", qualificationType: "ACA", registrationStatus: "full", residencyStatus: "citizen", requiresSponsorship: false, experienceYears: 5, licenceReady: true }],
      [],
    );
    const app = buildApp();
    const res = await request(app)
      .post("/eligibility/evaluate")
      .set("Authorization", `Bearer ${SESS}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("No published ruleset");
  });

  it("returns eligibility result when profile and ruleset found", async () => {
    eligResults.push(
      [{ id: 1, userId: "cand-1", profession: "nurse", qualificationCountry: "United Kingdom", qualificationType: "RN", registrationStatus: "full", residencyStatus: "citizen", requiresSponsorship: false, experienceYears: 3, licenceReady: true }],
      [{ id: 101, regulator: "NMC", status: "published", version: 1, effectiveDate: new Date("2023-01-01"), createdAt: new Date() }],
      [],
      [{ id: 500, userId: "cand-1", outcome: "not_eligible", explanationText: "No rule matched.", reasonCodes: ["NO_RULE_MATCHED"], pathways: null, rulesetId: 101, rulesetVersion: 1, profileSnapshotHash: "abc123", reviewFlagged: 1, reviewNote: "Review required.", createdAt: new Date() }],
    );
    const app = buildApp();
    const res = await request(app)
      .post("/eligibility/evaluate")
      .set("Authorization", `Bearer ${SESS}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(500);
    expect(["eligible", "not_eligible", "ineligible"]).toContain(res.body.outcome);
  });

  it("returns 400 when no profession set", async () => {
    eligResults.push(
      [{ id: 1, userId: "cand-1", profession: null, qualificationCountry: "UK", qualificationType: "MBBS", registrationStatus: "full", residencyStatus: "citizen", requiresSponsorship: false, experienceYears: 5, licenceReady: true }],
    );
    const app = buildApp();
    const res = await request(app)
      .post("/eligibility/evaluate")
      .set("Authorization", `Bearer ${SESS}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("profession");
  });
});

describe("GET /eligibility/history", () => {
  beforeEach(() => { eligResults.length = 0; });

  it("returns empty decisions when none exist", async () => {
    eligResults.push([]);
    const app = buildApp();
    const res = await request(app)
      .get("/eligibility/history")
      .set("Authorization", `Bearer ${SESS}`);
    expect(res.status).toBe(200);
    expect(res.body.decisions).toEqual([]);
  });

  it("returns decision list when decisions exist", async () => {
    eligResults.push([
      { id: 1, userId: "cand-1", outcome: "eligible", explanationText: "You are eligible.", reasonCodes: ["GMC_FULL_REG"], pathways: null, rulesetId: 10, rulesetVersion: 1, profileSnapshotHash: "abc", reviewFlagged: 0, reviewNote: null, createdAt: new Date() },
    ]);
    const app = buildApp();
    const res = await request(app)
      .get("/eligibility/history")
      .set("Authorization", `Bearer ${SESS}`);
    expect(res.status).toBe(200);
    expect(res.body.decisions).toHaveLength(1);
    expect(res.body.decisions[0].outcome).toBe("eligible");
  });
});

describe("GET /eligibility/results/:id", () => {
  beforeEach(() => { eligResults.length = 0; });

  it("returns 400 for non-numeric id", async () => {
    const app = buildApp();
    const res = await request(app)
      .get("/eligibility/results/abc")
      .set("Authorization", `Bearer ${SESS}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Invalid");
  });

  it("returns 404 when decision not found", async () => {
    eligResults.push([]);
    const app = buildApp();
    const res = await request(app)
      .get("/eligibility/results/9999")
      .set("Authorization", `Bearer ${SESS}`);
    expect(res.status).toBe(404);
  });

  it("returns decision when found", async () => {
    eligResults.push([
      { id: 42, userId: "cand-1", outcome: "eligible", explanationText: "All clear.", reasonCodes: ["OK"], pathways: null, rulesetId: 1, rulesetVersion: 1, profileSnapshotHash: "hash", reviewFlagged: 0, reviewNote: null, createdAt: new Date() },
    ]);
    const app = buildApp();
    const res = await request(app)
      .get("/eligibility/results/42")
      .set("Authorization", `Bearer ${SESS}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(42);
  });
});
