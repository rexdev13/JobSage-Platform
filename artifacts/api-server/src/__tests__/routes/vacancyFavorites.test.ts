import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const { favResults } = vi.hoisted(() => ({ favResults: [] as any[] }));

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from() { return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return chain; },
      values() { return chain; },
      set() { return chain; },
      onConflictDoNothing() { return chain; },
      then(resolve: any, reject?: any) {
        return Promise.resolve(favResults.shift() ?? []).then(resolve, reject);
      },
      catch() { return chain; },
      returning() { return Promise.resolve(favResults.shift() ?? []); },
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
    vacancyFavoritesTable: {},
    rolesTable: {},
    jobListingsTable: {},
    employerProfilesTable: {},
    sponsorLicenceVacanciesTable: {},
  };
});

vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return {
    ...actual,
    getSession: vi.fn().mockResolvedValue({
      user: { id: "cand-1", email: "cand@test.com", role: "candidate", firstName: "Jane", lastName: "Doe", profileImageUrl: null },
    }),
    clearSession: vi.fn(),
    deleteSession: vi.fn(),
    createSession: vi.fn().mockResolvedValue("sess"),
  };
});

const vacancyFavoritesRouter = (await import("../../routes/vacancyFavorites")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(vacancyFavoritesRouter);
  return app;
}

const SESS = "cand-session";

describe("GET /vacancy-favorites", () => {
  beforeEach(() => { favResults.length = 0; });

  it("returns 401 when not authenticated", async () => {
    const res = await request(buildApp()).get("/vacancy-favorites");
    expect(res.status).toBe(401);
  });

  it("returns empty list when no favorites", async () => {
    favResults.push([]);
    const res = await request(buildApp())
      .get("/vacancy-favorites")
      .set("Authorization", `Bearer ${SESS}`);
    expect(res.status).toBe(200);
    expect(res.body.favorites).toEqual([]);
  });

  it("enriches favorites across all three vacancy id spaces", async () => {
    const now = new Date("2026-08-01T00:00:00Z");
    favResults.push(
      // favorites rows: role 42, employer listing 1_000_005, sponsor vacancy 2_000_009
      [
        { vacancyId: 2_000_009, createdAt: now },
        { vacancyId: 1_000_005, createdAt: now },
        { vacancyId: 42, createdAt: now },
      ],
      // roles lookup
      [{ id: 42, title: "Nurse", employer: "NHS Trust", location: "Leeds", applyUrl: "https://nhs.example/apply" }],
      // job listings lookup
      [{ id: 5, title: "Engineer", location: "London", applyUrl: null, employerProfileId: 9 }],
      // sponsor vacancies lookup
      [{ id: 9, title: "Designer", organisationName: "Acme Ltd", location: "Bristol", url: "https://acme.example/job" }],
      // employer profiles lookup
      [{ id: 9, companyName: "TechCorp" }],
    );
    const res = await request(buildApp())
      .get("/vacancy-favorites")
      .set("Authorization", `Bearer ${SESS}`);
    expect(res.status).toBe(200);
    expect(res.body.favorites).toHaveLength(3);
    const byId = Object.fromEntries(res.body.favorites.map((f: any) => [f.vacancyId, f]));
    expect(byId[42]).toMatchObject({ title: "Nurse", company: "NHS Trust", location: "Leeds", applyUrl: "https://nhs.example/apply" });
    expect(byId[1_000_005]).toMatchObject({ title: "Engineer", company: "TechCorp", location: "London", applyUrl: null });
    expect(byId[2_000_009]).toMatchObject({ title: "Designer", company: "Acme Ltd", location: "Bristol", applyUrl: "https://acme.example/job" });
  });

  it("omits a pending company-site manager favorite without deleting it", async () => {
    const now = new Date("2026-08-01T00:00:00Z");
    favResults.push(
      [{ vacancyId: 2_000_009, createdAt: now }],
      [{
        id: 9,
        title: "Operations Manager",
        organisationName: "Acme Ltd",
        location: "Bristol",
        url: "https://acme.example/job",
        sourceType: "company_site",
        liveness: "live",
        lastVerifiedAt: now,
        companyVacancyEvidence: { roleEligibilityReview: { status: "pending" } },
      }],
    );
    const res = await request(buildApp())
      .get("/vacancy-favorites")
      .set("Authorization", `Bearer ${SESS}`);
    expect(res.status).toBe(200);
    expect(res.body.favorites).toEqual([]);
  });

  it("retains a closed non-manager sponsor favorite with its closed status", async () => {
    const now = new Date("2026-08-01T00:00:00Z");
    favResults.push(
      [{ vacancyId: 2_000_010, createdAt: now }],
      [{
        id: 10,
        title: "Staff Nurse",
        organisationName: "Acme Ltd",
        location: "Bristol",
        url: "https://acme.example/job",
        sourceType: "company_site",
        liveness: "dead",
        lastVerifiedAt: now,
        companyVacancyEvidence: { kind: "json_ld_job_posting" },
      }],
    );
    const res = await request(buildApp())
      .get("/vacancy-favorites")
      .set("Authorization", `Bearer ${SESS}`);
    expect(res.status).toBe(200);
    expect(res.body.favorites).toHaveLength(1);
    expect(res.body.favorites[0]).toMatchObject({
      vacancyId: 2_000_010,
      title: "Staff Nurse",
      company: "Acme Ltd",
      location: "Bristol",
      applyUrl: null,
      closed: true,
    });
  });
});

describe("POST /vacancy-favorites/:vacancyId", () => {
  beforeEach(() => { favResults.length = 0; });

  it("favorites a vacancy", async () => {
    favResults.push([]);
    const res = await request(buildApp())
      .post("/vacancy-favorites/42")
      .set("Authorization", `Bearer ${SESS}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ favorited: true, vacancyId: 42 });
  });

  it("rejects an invalid vacancy id", async () => {
    const res = await request(buildApp())
      .post("/vacancy-favorites/abc")
      .set("Authorization", `Bearer ${SESS}`);
    expect(res.status).toBe(400);
  });
});

describe("DELETE /vacancy-favorites/:vacancyId", () => {
  beforeEach(() => { favResults.length = 0; });

  it("removes a favorite", async () => {
    favResults.push([]);
    const res = await request(buildApp())
      .delete("/vacancy-favorites/2000009")
      .set("Authorization", `Bearer ${SESS}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ favorited: false, vacancyId: 2000009 });
  });
});
