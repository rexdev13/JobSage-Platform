import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const { dbResults, deleteMock, sendPasswordResetEmailMock, writeAuditEventMock } = vi.hoisted(() => ({
  dbResults: [] as unknown[],
  deleteMock: vi.fn(),
  sendPasswordResetEmailMock: vi.fn(),
  writeAuditEventMock: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      offset: () => chain,
      values: () => chain,
      set: () => chain,
      returning: () => Promise.resolve(dbResults.shift() ?? []),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(dbResults.shift() ?? []).then(resolve, reject),
    };
    return chain;
  }

  return {
    db: {
      select: () => makeChain(),
      insert: () => makeChain(),
      update: () => makeChain(),
      delete: () => {
        deleteMock();
        return makeChain();
      },
    },
    usersTable: {},
    auditEventsTable: {},
    profilesTable: {},
    documentsTable: {},
    applicationsTable: {},
    consentLogsTable: {},
    sponsorLicencesTable: {},
    sponsorLicenceSyncLogTable: {},
    decisionRecordsTable: {},
    employerProfilesTable: {},
    jobListingsTable: {},
    rolesTable: {},
  };
});

const mockGetSession = vi.fn();
vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return {
    ...actual,
    getSession: mockGetSession,
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    updateSession: vi.fn(),
  };
});

vi.mock("../../lib/email", () => ({
  sendPasswordResetEmail: sendPasswordResetEmailMock,
}));

vi.mock("../../lib/audit", () => ({
  writeAuditEvent: writeAuditEventMock,
}));

vi.mock("../../lib/jobsageEmailGen", () => ({
  generateJobsageEmail: () => "marketing.account@example.jobsage",
}));

vi.mock("../../lib/objectStorage", () => ({
  ObjectStorageService: class {},
  ObjectNotFoundError: class extends Error {},
}));

const superAdminRouter = (await import("../../routes/superAdmin")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(superAdminRouter);
  return app;
}

const superAdminSession = {
  user: { id: "super-admin", email: "super@example.com", role: "super_admin", firstName: null, lastName: null },
};

describe("Super admin marketing account management", () => {
  beforeEach(() => {
    dbResults.length = 0;
    deleteMock.mockReset();
    sendPasswordResetEmailMock.mockReset().mockResolvedValue(undefined);
    writeAuditEventMock.mockReset().mockResolvedValue(undefined);
    mockGetSession.mockResolvedValue(superAdminSession);
  });

  it("creates a marketing-only account and sends a setup invitation", async () => {
    dbResults.push([], [{
      id: "marketing-1",
      email: "marketing@example.com",
      firstName: "Maya",
      lastName: "Green",
      role: "marketing",
      emailVerified: false,
    }]);

    const res = await request(buildApp())
      .post("/admin/super/marketing-accounts")
      .set("Authorization", "Bearer super-session")
      .send({ email: "Marketing@Example.com", firstName: "Maya", lastName: "Green" });

    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("marketing");
    expect(res.body.user.email).toBe("marketing@example.com");
    expect(sendPasswordResetEmailMock).toHaveBeenCalledWith(
      "marketing@example.com",
      expect.any(String),
      expect.any(String),
    );
    expect(writeAuditEventMock).toHaveBeenCalledWith(
      "super-admin",
      "super_admin_create_marketing_account",
      "marketing-1",
      expect.objectContaining({ email: "marketing@example.com" }),
    );
  });

  it("denies a non-super-admin", async () => {
    mockGetSession.mockResolvedValue({
      user: { id: "admin-1", email: "admin@example.com", role: "admin", firstName: null, lastName: null },
    });

    const res = await request(buildApp())
      .post("/admin/super/marketing-accounts")
      .set("Authorization", "Bearer admin-session")
      .send({ email: "marketing@example.com", firstName: "Maya", lastName: "Green" });

    expect(res.status).toBe(403);
  });

  it("rejects invalid account details", async () => {
    const res = await request(buildApp())
      .post("/admin/super/marketing-accounts")
      .set("Authorization", "Bearer super-session")
      .send({ email: "not-an-email", firstName: "", lastName: "Green" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("email");
  });

  it("rejects a duplicate email address", async () => {
    dbResults.push([{ id: "existing-user" }]);

    const res = await request(buildApp())
      .post("/admin/super/marketing-accounts")
      .set("Authorization", "Bearer super-session")
      .send({ email: "marketing@example.com", firstName: "Maya", lastName: "Green" });

    expect(res.status).toBe(409);
  });

  it("rolls back the new account when invitation delivery fails", async () => {
    sendPasswordResetEmailMock.mockRejectedValueOnce(new Error("Email provider unavailable"));
    dbResults.push([], [{
      id: "marketing-1",
      email: "marketing@example.com",
      firstName: "Maya",
      lastName: "Green",
      role: "marketing",
      emailVerified: false,
    }]);

    const res = await request(buildApp())
      .post("/admin/super/marketing-accounts")
      .set("Authorization", "Bearer super-session")
      .send({ email: "marketing@example.com", firstName: "Maya", lastName: "Green" });

    expect(res.status).toBe(503);
    expect(deleteMock).toHaveBeenCalledTimes(1);
  });

  it("lists a marketing account when the directory is filtered by marketing role", async () => {
    dbResults.push(
      [{
        id: "marketing-1",
        email: "marketing@example.com",
        firstName: "Maya",
        lastName: "Green",
        role: "marketing",
        emailVerified: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        suspendedAt: null,
        lastLogin: null,
        documentCount: 0,
        applicationCount: 0,
        profileCompletion: 0,
        eligibilityStatus: null,
        hasConsented: false,
        consentedAt: null,
      }],
      [{ cnt: 1 }],
    );

    const res = await request(buildApp())
      .get("/admin/super/users?role=marketing")
      .set("Authorization", "Bearer super-session");

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.users[0].role).toBe("marketing");
  });
});