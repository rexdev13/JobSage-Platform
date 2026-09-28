import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const { dbResults } = vi.hoisted(() => ({ dbResults: [] as any[] }));

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from() { return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      groupBy() { return chain; },
      limit() { return chain; },
      values() { return chain; },
      set() { return chain; },
      innerJoin() { return chain; },
      $dynamic() { return chain; },
      then(resolve: any, reject?: any) {
        return Promise.resolve(dbResults.shift() ?? []).then(resolve, reject);
      },
      catch() { return chain; },
      returning() { return Promise.resolve(dbResults.shift() ?? []); },
    };
    return chain;
  }
  return {
    db: {
      select: () => makeChain(),
      selectDistinct: () => makeChain(),
      insert: () => makeChain(),
      update: () => makeChain(),
      delete: () => makeChain(),
      execute: vi.fn(async () => ({ rows: [] })),
    },
    sponsorLicencesTable: {},
    sponsorLicenceSyncLogTable: {},
    sponsorLicenceVacancyChecksTable: {},
    sponsorLicenceBookmarksTable: {},
    sponsorLicenceVacanciesTable: {},
    sponsorLicenceVacancyScoresTable: {},
    applicationsTable: {},
    speculativeApplicationsTable: {},
    profilesTable: {},
  };
});

const { runVacancyCheckMock } = vi.hoisted(() => ({
  runVacancyCheckMock: vi.fn(async (name: string) => ({
    vacanciesFound: true,
    vacancyCount: 3,
    sourceUrl: "https://example.com" as string | null,
    summary: `Found for ${name}`,
    checkedAt: new Date("2026-07-25T10:00:00Z"),
    fromCache: false,
    vacancyList: null,
    discoveredContactEmail: null,
    discoveredContactPhone: null,
    discoveredWebsite: null,
  })),
}));

vi.mock("../../lib/vacancyCheckHelper", () => ({
  runVacancyCheck: runVacancyCheckMock,
}));

const { startCheckAllMock } = vi.hoisted(() => ({
  startCheckAllMock: vi.fn(() => ({ started: true })),
}));

vi.mock("../../lib/vacancyCheckAllRunner", () => ({
  startCheckAllVacancies: startCheckAllMock,
  getCheckAllStatus: vi.fn(() => ({ isRunning: false })),
}));

const { sessionUser } = vi.hoisted(() => ({
  sessionUser: { current: { id: "cand-1", email: "cand@test.com", role: "candidate" } as any },
}));

vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return {
    ...actual,
    getSession: vi.fn(async () => ({ user: sessionUser.current })),
    clearSession: vi.fn(),
    deleteSession: vi.fn(),
    createSession: vi.fn().mockResolvedValue("sess"),
  };
});

const sponsorLicencesRouter = (await import("../../routes/sponsorLicences")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(sponsorLicencesRouter);
  return app;
}

const AUTH = ["Authorization", "Bearer sess"] as const;

describe("POST /sponsor-licences/check-all-vacancies (admin gate)", () => {
  beforeEach(() => {
    dbResults.length = 0;
    startCheckAllMock.mockClear();
  });

  it("returns 403 for candidates", async () => {
    sessionUser.current = { id: "cand-1", role: "candidate" };
    const res = await request(buildApp())
      .post("/sponsor-licences/check-all-vacancies")
      .set(...AUTH)
      .send({});
    expect(res.status).toBe(403);
    expect(startCheckAllMock).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(buildApp()).post("/sponsor-licences/check-all-vacancies").send({});
    expect(res.status).toBe(401);
  });

  it("allows admins to start the scan", async () => {
    sessionUser.current = { id: "admin-1", role: "admin" };
    const res = await request(buildApp())
      .post("/sponsor-licences/check-all-vacancies")
      .set(...AUTH)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.started).toBe(true);
    expect(startCheckAllMock).toHaveBeenCalledOnce();
  });
});

describe("POST /sponsor-licences/check-batch", () => {
  beforeEach(() => {
    dbResults.length = 0;
    runVacancyCheckMock.mockClear();
    sessionUser.current = { id: `user-${Math.random().toString(36).slice(2)}`, role: "candidate" };
  });

  it("returns 400 for a missing/empty ids array", async () => {
    const app = buildApp();
    for (const body of [{}, { ids: [] }, { ids: ["x", -1] }]) {
      const res = await request(app).post("/sponsor-licences/check-batch").set(...AUTH).send(body);
      expect(res.status).toBe(400);
    }
  });

  it("returns 400 when more than 20 ids are sent", async () => {
    const res = await request(buildApp())
      .post("/sponsor-licences/check-batch")
      .set(...AUTH)
      .send({ ids: Array.from({ length: 21 }, (_, i) => i + 1) });
    expect(res.status).toBe(400);
  });

  it("checks a batch and returns per-id summaries", async () => {
    dbResults.push([
      { id: 1, organisationName: "Acme Care" },
      { id: 2, organisationName: "Beta Health" },
      { id: 3, organisationName: "Acme Care" }, // duplicate org — single check shared
    ]);
    const res = await request(buildApp())
      .post("/sponsor-licences/check-batch")
      .set(...AUTH)
      .send({ ids: [1, 2, 3] });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(3);
    expect(res.body.checkedOrganisations).toBe(2);
    expect(runVacancyCheckMock).toHaveBeenCalledTimes(2);
    const first = res.body.results[0];
    expect(first.vacanciesFound).toBe(true);
    expect(first.vacancyCount).toBe(3);
    expect(first.fromCache).toBe(false);
    expect(first.checkedAt).toBeTruthy();
    expect(first.error).toBeNull();
  });

  it("enforces the per-user cooldown with 429 and a retry hint", async () => {
    const app = buildApp();
    dbResults.push([{ id: 1, organisationName: "Acme Care" }]);
    const ok = await request(app).post("/sponsor-licences/check-batch").set(...AUTH).send({ ids: [1] });
    expect(ok.status).toBe(200);

    const blocked = await request(app).post("/sponsor-licences/check-batch").set(...AUTH).send({ ids: [1] });
    expect(blocked.status).toBe(429);
    expect(blocked.body.retryAfterSeconds).toBeGreaterThan(0);
    expect(blocked.body.error).toMatch(/wait/i);
  });

  it("reports per-company errors without failing the whole batch", async () => {
    dbResults.push([
      { id: 1, organisationName: "Good Org" },
      { id: 2, organisationName: "Bad Org" },
    ]);
    runVacancyCheckMock.mockImplementation(async (name: string) => {
      if (name === "Bad Org") throw new Error("AI timeout");
      return {
        vacanciesFound: false, vacancyCount: 0, sourceUrl: null, summary: "None",
        checkedAt: new Date(), fromCache: true, vacancyList: null,
        discoveredContactEmail: null, discoveredContactPhone: null, discoveredWebsite: null,
      };
    });
    const res = await request(buildApp())
      .post("/sponsor-licences/check-batch")
      .set(...AUTH)
      .send({ ids: [1, 2] });
    expect(res.status).toBe(200);
    expect(res.body.errors).toBe(1);
    expect(res.body.cacheHits).toBe(1);
    const bad = res.body.results.find((r: any) => r.organisationName === "Bad Org");
    expect(bad.error).toContain("AI timeout");
  });
});

describe("GET /sponsor-licences/:id/vacancies", () => {
  beforeEach(() => {
    dbResults.length = 0;
    sessionUser.current = { id: "cand-1", role: "candidate" };
  });

  it("returns only fresh-live actionable vacancies with Opportunities-compatible state and compact non-live evidence", async () => {
    const now = new Date();
    dbResults.push(
      [{ organisationName: "Acme Care" }],
      [
        {
          id: 7,
          organisationName: "Acme Care",
          title: "Cardiology Nurse",
          location: "Manchester",
          salary: null,
          url: "https://employer.example/live",
          description: "Visa sponsorship is available. Enhanced DBS and safeguarding level 2 required.",
          postedDate: null,
          targetRegions: ["North West"],
          sourceType: "job_board",
          boardName: "NHS Jobs",
          requiredDbsClearanceLevel: null,
          requiredSafeguardingLevel: null,
          liveness: "live",
          lastVerifiedAt: now,
          livenessReason: null,
          companyEvidenceLegacyUntil: new Date(now.getTime() + 86400000),
        },
        {
          id: 8,
          organisationName: "Acme Care",
          title: "Expired Nurse",
          location: "Manchester",
          salary: null,
          url: "https://employer.example/expired",
          description: null,
          targetRegions: [],
          sourceType: "job_board",
          boardName: "NHS Jobs",
          requiredDbsClearanceLevel: null,
          requiredSafeguardingLevel: null,
          liveness: "dead",
          lastVerifiedAt: now,
          livenessReason: "Advert expired",
        },
        {
          id: 9,
          organisationName: "Acme Care",
          title: "Company-site Nurse",
          location: "Manchester",
          salary: null,
          url: "https://employer.example/jobs/company-site-nurse",
          description: "Nurse vacancy",
          targetRegions: ["North West"],
          sourceType: "company_site",
          boardName: null,
          companyVacancyEvidence: {
            kind: "known_ats_posting",
            provider: "Ashby",
            listingUrl: "https://jobs.ashbyhq.com/acme",
          },
          requiredDbsClearanceLevel: null,
          requiredSafeguardingLevel: null,
          liveness: "live",
          lastVerifiedAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
          livenessReason: null,
          companyEvidenceLegacyUntil: new Date(now.getTime() + 86400000),
        },
        {
          id: 10,
          organisationName: "Acme Care",
          title: "Stale job-board Nurse",
          location: "Manchester",
          salary: null,
          url: "https://jobs.example/stale",
          description: "Nurse vacancy",
          targetRegions: ["North West"],
          sourceType: "job_board",
          boardName: "NHS Jobs",
          requiredDbsClearanceLevel: null,
          requiredSafeguardingLevel: null,
          liveness: "live",
          lastVerifiedAt: new Date(now.getTime() - 7 * 60 * 60 * 1000),
          livenessReason: null,
        },
      ],
      [
        { vacancyId: 7, score: 91, isEligible: true, missingRequirements: [], explanation: "Strong fit" },
        { vacancyId: 9, score: 80, isEligible: true, missingRequirements: [], explanation: "Good fit" },
        { vacancyId: 10, score: 70, isEligible: true, missingRequirements: [], explanation: "Relevant fit" },
      ],
      [{ checkedAt: now }],
      [{ dbsClearanceLevel: "enhanced", safeguardingTrainingLevel: "level_2" }],
      [{ roleId: 2_000_007, status: "applied" }],
      [{ vacancyRef: "sponsor-vacancy:7", roleId: null, vacancyTitle: "Cardiology Nurse" }],
    );

    const res = await request(buildApp()).get("/sponsor-licences/1/vacancies").set(...AUTH);

    expect(res.status).toBe(200);
    expect(res.body.vacancies).toHaveLength(3);
    expect(res.body.vacancies.find((vacancy: { id: number }) => vacancy.id === 7)).toMatchObject({
      id: 7,
      roleId: 2_000_007,
      sponsorshipStatus: "confirmed",
      requiredRegistration: "NMC registration pathway",
      requiredDbsClearanceLevel: "enhanced",
      requiredSafeguardingLevel: "level_2",
      safeguarding: { dbsStatus: "met", safeguardingStatus: "met" },
      targetRegions: ["North West"],
      sourceType: "job_board",
      boardName: "NHS Jobs",
      applied: true,
      cvSent: true,
      linkStatus: "live",
    });
    expect(res.body.vacancies.find((vacancy: { id: number }) => vacancy.id === 9)).toMatchObject({
      id: 9,
      sourceType: "company_site",
      linkStatus: "live",
    });
    expect(res.body.vacancies.find((vacancy: { id: number }) => vacancy.id === 10)).toMatchObject({
      id: 10,
      sourceType: "job_board",
      linkStatus: "live",
    });
    expect(res.body.nonLiveEvidence).toEqual({
      count: 1,
      reasons: ["Advert expired"],
    });
    expect(JSON.stringify(res.body)).not.toContain("https://employer.example/expired");
  });
});
