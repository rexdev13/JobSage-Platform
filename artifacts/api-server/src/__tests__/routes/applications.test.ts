import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const { appResults } = vi.hoisted(() => ({ appResults: [] as any[] }));

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
        return Promise.resolve(appResults.shift() ?? []).then(resolve, reject);
      },
      catch() { return chain; },
      returning() { return Promise.resolve(appResults.shift() ?? []); },
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
    applicationsTable: {},
    speculativeApplicationsTable: {},
    jobListingsTable: {},
    documentsTable: {},
    rolesTable: {},
    candidateMessagesTable: {},
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

vi.mock("../../lib/systemMessages", () => ({
  createApplicationReceivedMessage: vi.fn().mockResolvedValue(undefined),
}));

// DNS lookups in the SSRF guard: hostnames containing "private" resolve to an
// RFC1918 address; everything else resolves to a public IP.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => {
    if (host.includes("private")) return [{ address: "10.0.0.5", family: 4 }];
    return [{ address: "93.184.216.34", family: 4 }];
  }),
}));

const applicationsRouter = (await import("../../routes/applications")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(applicationsRouter);
  return app;
}

const SESS = "cand-session";

describe("GET /applications", () => {
  beforeEach(() => { appResults.length = 0; });

  it("returns 401 when not authenticated (no auth header)", async () => {
    const app = buildApp();
    const res = await request(app).get("/applications");
    expect(res.status).toBe(401);
  });

  it("returns empty application list with stats when none exist", async () => {
    appResults.push(
      [],
      [],
    );
    const app = buildApp();
    const res = await request(app)
      .get("/applications")
      .set("Authorization", `Bearer ${SESS}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.applications)).toBe(true);
    expect(res.body.applications).toHaveLength(0);
    expect(res.body.stats).toBeDefined();
    expect(res.body.stats.total).toBe(0);
  });
});

describe("POST /applications", () => {
  beforeEach(() => { appResults.length = 0; });

  it("returns 400 when roleId is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/applications")
      .set("Authorization", `Bearer ${SESS}`)
      .send({ coverLetter: "Hello" });
    expect(res.status).toBe(400);
  });

  it("creates new application and returns 200 when no duplicate exists", async () => {
    appResults.push(
      [],
      [{ id: 1, userId: "cand-1", roleId: 42, status: "applied", appliedAt: new Date(), applicationType: "platform", cvDocumentId: null }],
      [],
      [],
    );
    const app = buildApp();
    const res = await request(app)
      .post("/applications")
      .set("Authorization", `Bearer ${SESS}`)
      .send({ roleId: 42 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });

  it("returns 200 when application already exists for that role (idempotent)", async () => {
    appResults.push(
      [{ id: 5, userId: "cand-1", roleId: 42, status: "applied", appliedAt: new Date(), applicationType: "platform", cvDocumentId: null }],
    );
    const app = buildApp();
    const res = await request(app)
      .post("/applications")
      .set("Authorization", `Bearer ${SESS}`)
      .send({ roleId: 42 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(5);
  });
});

describe("PATCH /applications/:id/status", () => {
  beforeEach(() => { appResults.length = 0; });

  it("returns 401 when not authenticated", async () => {
    const { getSession } = await import("../../lib/auth");
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const app = buildApp();
    const res = await request(app)
      .patch("/applications/1/status")
      .set("Authorization", "Bearer no-auth");
    expect(res.status).toBe(401);
  });
});
