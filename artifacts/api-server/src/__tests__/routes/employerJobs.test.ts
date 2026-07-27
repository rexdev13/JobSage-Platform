import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

// ── hoisted DB results queue ──────────────────────────────────────────────────
const { dbResults } = vi.hoisted(() => ({ dbResults: [] as any[] }));

const EMPLOYER_PROFILE = {
  id: 10,
  userId: "emp-1",
  companyName: "NHS Test Trust",
  industry: "nhs_trust",
  region: "London",
  contactEmail: null,
  contactPhone: null,
  contactWebsite: null,
  sponsorLicenceNumber: null,
};

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from() { return chain; },
      innerJoin() { return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return chain; },
      values() { return chain; },
      set() { return chain; },
      onConflictDoNothing() { return chain; },
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
      insert: () => makeChain(),
      update: () => makeChain(),
      delete: () => makeChain(),
      execute: vi.fn().mockResolvedValue({ rows: [] }),
    },
    employerProfilesTable: {},
    jobListingsTable: {},
    applicationsTable: {},
    documentsTable: {},
    auditEventsTable: {},
  };
});

vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return {
    ...actual,
    getSession: vi.fn().mockResolvedValue({
      user: { id: "emp-1", email: "employer@test.com", role: "employer", firstName: null, lastName: null, profileImageUrl: null },
    }),
    clearSession: vi.fn(),
    deleteSession: vi.fn(),
    createSession: vi.fn().mockResolvedValue("sess"),
  };
});

vi.mock("../../middlewares/consentMiddleware", () => ({
  requireConsent: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("../../lib/objectStorage", () => ({
  getSignedDownloadUrl: vi.fn().mockResolvedValue("https://example.com/signed"),
  deleteObject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/linkVerification", () => ({
  queueLinkVerification: vi.fn(),
  queueLinkVerificationBatch: vi.fn(),
}));

vi.mock("../../lib/ai", () => ({
  generateText: vi.fn().mockResolvedValue("Generated description"),
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

const AUTH = "Bearer emp-session";

// ── POST /employer/jobs — create job listing with applyUrl ────────────────────
describe("POST /employer/jobs — applyUrl field", () => {
  beforeEach(() => { dbResults.length = 0; });

  const BASE_PAYLOAD = {
    title: "Consultant Cardiologist",
    location: "London",
    regulator: "GMC",
    requiredRegistration: "Full GMC Registration",
    sponsorshipOffered: true,
  };

  it("creates a job listing with a valid applyUrl", async () => {
    const created = {
      id: 1,
      ...BASE_PAYLOAD,
      applyUrl: "https://jobs.nhstrust.nhs.uk/vacancy/123",
      status: "draft",
      employerProfileId: 10,
    };
    dbResults.push([EMPLOYER_PROFILE]); // select employer profile
    dbResults.push([created]);          // insert returning

    const app = buildApp();
    const res = await request(app)
      .post("/employer/jobs")
      .set("Authorization", AUTH)
      .send({ ...BASE_PAYLOAD, applyUrl: "https://jobs.nhstrust.nhs.uk/vacancy/123" });

    expect(res.status).toBe(201);
    expect(res.body.applyUrl).toBe("https://jobs.nhstrust.nhs.uk/vacancy/123");
  });

  it("creates a job listing without applyUrl (null)", async () => {
    const created = {
      id: 2,
      ...BASE_PAYLOAD,
      applyUrl: null,
      status: "draft",
      employerProfileId: 10,
    };
    dbResults.push([EMPLOYER_PROFILE]);
    dbResults.push([created]);

    const app = buildApp();
    const res = await request(app)
      .post("/employer/jobs")
      .set("Authorization", AUTH)
      .send(BASE_PAYLOAD);

    expect(res.status).toBe(201);
    expect(res.body.applyUrl).toBeNull();
  });

  it("rejects an invalid applyUrl (non-http)", async () => {
    dbResults.push([EMPLOYER_PROFILE]);

    const app = buildApp();
    const res = await request(app)
      .post("/employer/jobs")
      .set("Authorization", AUTH)
      .send({ ...BASE_PAYLOAD, applyUrl: "ftp://invalid.com/jobs" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid http/i);
  });

  it("rejects a javascript: protocol applyUrl", async () => {
    dbResults.push([EMPLOYER_PROFILE]);

    const app = buildApp();
    const res = await request(app)
      .post("/employer/jobs")
      .set("Authorization", AUTH)
      .send({ ...BASE_PAYLOAD, applyUrl: "javascript:alert(1)" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid http/i);
  });

  it("accepts an http (non-https) applyUrl", async () => {
    const created = { id: 3, ...BASE_PAYLOAD, applyUrl: "http://jobs.nhstrust.nhs.uk/123", status: "draft", employerProfileId: 10 };
    dbResults.push([EMPLOYER_PROFILE]);
    dbResults.push([created]);

    const app = buildApp();
    const res = await request(app)
      .post("/employer/jobs")
      .set("Authorization", AUTH)
      .send({ ...BASE_PAYLOAD, applyUrl: "http://jobs.nhstrust.nhs.uk/123" });

    expect(res.status).toBe(201);
    expect(res.body.applyUrl).toBe("http://jobs.nhstrust.nhs.uk/123");
  });
});

// ── PUT /employer/jobs/:id — update applyUrl ──────────────────────────────────
describe("PUT /employer/jobs/:id — applyUrl field", () => {
  beforeEach(() => { dbResults.length = 0; });

  it("updates applyUrl to a valid URL", async () => {
    const existingJob = { id: 1, status: "draft" };
    const updated = { id: 1, applyUrl: "https://jobs.nhs.uk/new-vacancy/456", status: "draft" };
    dbResults.push([EMPLOYER_PROFILE]);
    dbResults.push([existingJob]);
    dbResults.push([updated]);

    const app = buildApp();
    const res = await request(app)
      .put("/employer/jobs/1")
      .set("Authorization", AUTH)
      .send({ applyUrl: "https://jobs.nhs.uk/new-vacancy/456" });

    expect(res.status).toBe(200);
    expect(res.body.applyUrl).toBe("https://jobs.nhs.uk/new-vacancy/456");
  });

  it("clears applyUrl when set to null", async () => {
    const existingJob = { id: 1, status: "draft" };
    const updated = { id: 1, applyUrl: null, status: "draft" };
    dbResults.push([EMPLOYER_PROFILE]);
    dbResults.push([existingJob]);
    dbResults.push([updated]);

    const app = buildApp();
    const res = await request(app)
      .put("/employer/jobs/1")
      .set("Authorization", AUTH)
      .send({ applyUrl: null });

    expect(res.status).toBe(200);
    expect(res.body.applyUrl).toBeNull();
  });

  it("rejects an invalid applyUrl on update", async () => {
    dbResults.push([EMPLOYER_PROFILE]);
    dbResults.push([{ id: 1, status: "draft" }]);

    const app = buildApp();
    const res = await request(app)
      .put("/employer/jobs/1")
      .set("Authorization", AUTH)
      .send({ applyUrl: "not-a-url" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/valid http/i);
  });
});
