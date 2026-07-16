import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const { empResults } = vi.hoisted(() => ({ empResults: [] as any[] }));

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from() { return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return chain; },
      offset() { return chain; },
      values() { return chain; },
      set() { return chain; },
      onConflictDoUpdate() { return chain; },
      then(resolve: any, reject?: any) {
        return Promise.resolve(empResults.shift() ?? []).then(resolve, reject);
      },
      catch() { return chain; },
      returning() { return Promise.resolve(empResults.shift() ?? []); },
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
    employerProfilesTable: {},
    jobListingsTable: {},
    applicationsTable: {},
    profilesTable: {},
    usersTable: {},
    auditEventsTable: {},
    sessionsTable: {},
  };
});

const mockGetSession = vi.fn().mockResolvedValue({
  user: { id: "employer-1", email: "employer@test.com", role: "employer", firstName: "Corp", lastName: "Ltd", profileImageUrl: null },
});

vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return {
    ...actual,
    createSession: vi.fn().mockResolvedValue("emp-session"),
    getSession: mockGetSession,
    clearSession: vi.fn(),
    deleteSession: vi.fn(),
  };
});

vi.mock("../../lib/audit", () => ({
  writeAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

const employerRouter = (await import("../../routes/employer")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(employerRouter);
  return app;
}

const EMP_AUTH = "Bearer employer-session-token";
const CAND_AUTH = "Bearer candidate-session-token";
const employerSession = {
  user: { id: "employer-1", email: "employer@test.com", role: "employer", firstName: "Corp", lastName: "Ltd", profileImageUrl: null },
};
const candidateSession = {
  user: { id: "cand-1", email: "cand@test.com", role: "candidate", firstName: "Jane", lastName: "Doe", profileImageUrl: null },
};

// ─── RBAC enforcement ──────────────────────────────────────────────
describe("Employer routes RBAC", () => {
  beforeEach(() => {
    empResults.length = 0;
  });

  it("GET /employer/jobs returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const resp = await request(buildApp()).get("/employer/jobs");
    expect(resp.status).toBe(401);
  });

  it("GET /employer/jobs returns 403 when candidate role", async () => {
    mockGetSession.mockResolvedValue(candidateSession);
    const resp = await request(buildApp())
      .get("/employer/jobs")
      .set("Authorization", CAND_AUTH);
    expect(resp.status).toBe(403);
  });

  it("GET /employer/profile returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const resp = await request(buildApp()).get("/employer/profile");
    expect(resp.status).toBe(401);
  });

  it("GET /employer/profile returns 403 when candidate role", async () => {
    mockGetSession.mockResolvedValue(candidateSession);
    const resp = await request(buildApp())
      .get("/employer/profile")
      .set("Authorization", CAND_AUTH);
    expect(resp.status).toBe(403);
  });

  it("GET /employer/candidates returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const resp = await request(buildApp()).get("/employer/candidates");
    expect(resp.status).toBe(401);
  });

  it("GET /employer/candidates returns 403 when candidate role", async () => {
    mockGetSession.mockResolvedValue(candidateSession);
    const resp = await request(buildApp())
      .get("/employer/candidates")
      .set("Authorization", CAND_AUTH);
    expect(resp.status).toBe(403);
  });

  it("GET /employer/talent-search returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const resp = await request(buildApp()).get("/employer/talent-search");
    expect(resp.status).toBe(401);
  });

  it("GET /employer/talent-search returns 403 when candidate role", async () => {
    mockGetSession.mockResolvedValue(candidateSession);
    const resp = await request(buildApp())
      .get("/employer/talent-search")
      .set("Authorization", CAND_AUTH);
    expect(resp.status).toBe(403);
  });
});

// ─── GET /employer/jobs ────────────────────────────────────────────
describe("GET /employer/jobs", () => {
  beforeEach(() => {
    empResults.length = 0;
    mockGetSession.mockResolvedValue(employerSession);
  });

  it("returns 200 with empty jobs list when no employer profile", async () => {
    // empProfile not found → { jobs: [] }
    empResults.push([]);
    const resp = await request(buildApp())
      .get("/employer/jobs")
      .set("Authorization", EMP_AUTH);
    expect(resp.status).toBe(200);
    expect(resp.body).toHaveProperty("jobs");
    expect(Array.isArray(resp.body.jobs)).toBe(true);
    expect(resp.body.jobs).toHaveLength(0);
  });

  it("returns 200 with jobs list when employer profile exists", async () => {
    const empProfile = { id: 5, userId: "employer-1", companyName: "HealthCorp" };
    const jobRow = {
      id: 1, employerProfileId: 5, title: "Staff Nurse", location: "London",
      specialty: "ICU", jobType: "full_time", salary: "£40k", status: "published",
      sponsorshipOffered: true,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    // empProfile → jobs list → per-job applicants count (empty)
    empResults.push([empProfile]);
    empResults.push([jobRow]);
    empResults.push([]);          // applicants for job 1
    const resp = await request(buildApp())
      .get("/employer/jobs")
      .set("Authorization", EMP_AUTH);
    expect(resp.status).toBe(200);
    expect(resp.body).toHaveProperty("jobs");
    expect(resp.body.jobs[0]).toHaveProperty("title", "Staff Nurse");
  });
});

// ─── GET /employer/jobs/:id/applicants ────────────────────────────
describe("GET /employer/jobs/:id/applicants", () => {
  beforeEach(() => {
    empResults.length = 0;
    mockGetSession.mockResolvedValue(employerSession);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const resp = await request(buildApp()).get("/employer/jobs/1/applicants");
    expect(resp.status).toBe(401);
  });

  it("returns 403 when candidate role", async () => {
    mockGetSession.mockResolvedValue(candidateSession);
    const resp = await request(buildApp())
      .get("/employer/jobs/1/applicants")
      .set("Authorization", CAND_AUTH);
    expect(resp.status).toBe(403);
  });

  it("returns 404 when employer profile does not exist", async () => {
    empResults.push([]);  // empProfile not found
    const resp = await request(buildApp())
      .get("/employer/jobs/1/applicants")
      .set("Authorization", EMP_AUTH);
    expect(resp.status).toBe(404);
  });

  it("returns 200 with applicants list when job exists", async () => {
    const empProfile = { id: 5, userId: "employer-1" };
    const job = { id: 1, employerProfileId: 5, title: "Staff Nurse", sponsorshipOffered: true };
    empResults.push([empProfile]);
    empResults.push([job]);
    empResults.push([]);  // empty applicants
    const resp = await request(buildApp())
      .get("/employer/jobs/1/applicants")
      .set("Authorization", EMP_AUTH);
    expect(resp.status).toBe(200);
    expect(resp.body).toHaveProperty("applicants");
    expect(Array.isArray(resp.body.applicants)).toBe(true);
  });
});

// ─── PUT /employer/jobs/:jobId/applicants/:appId/stage ────────────
describe("PUT stage update RBAC", () => {
  beforeEach(() => {
    empResults.length = 0;
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const resp = await request(buildApp())
      .put("/employer/jobs/1/applicants/2/stage")
      .send({ stage: "shortlisted" });
    expect(resp.status).toBe(401);
  });

  it("returns 403 when candidate role", async () => {
    mockGetSession.mockResolvedValue(candidateSession);
    const resp = await request(buildApp())
      .put("/employer/jobs/1/applicants/2/stage")
      .set("Authorization", CAND_AUTH)
      .send({ stage: "shortlisted" });
    expect(resp.status).toBe(403);
  });
});
