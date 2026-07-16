import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const { adminResults } = vi.hoisted(() => ({ adminResults: [] as any[] }));

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
        return Promise.resolve(adminResults.shift() ?? []).then(resolve, reject);
      },
      catch() { return chain; },
      returning() { return Promise.resolve(adminResults.shift() ?? []); },
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
    usersTable: {},
    auditEventsTable: {},
  };
});

const mockGetSession = vi.fn().mockResolvedValue({
  user: { id: "admin-user", email: "admin@test.com", role: "admin", firstName: null, lastName: null, profileImageUrl: null },
});

vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return {
    ...actual,
    createSession: vi.fn().mockResolvedValue("admin-session"),
    getSession: mockGetSession,
    clearSession: vi.fn(),
    deleteSession: vi.fn(),
  };
});

vi.mock("../../lib/email", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/audit", () => ({
  writeAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

const adminRouter = (await import("../../routes/adminUsers")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

function buildAdminApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(adminRouter);
  return app;
}

const ADMIN_SESSION = "admin-valid-session";
const adminSession = { user: { id: "admin-user", email: "admin@test.com", role: "admin", firstName: null, lastName: null, profileImageUrl: null } };

describe("GET /admin/users/search", () => {
  beforeEach(() => {
    adminResults.length = 0;
    mockGetSession.mockResolvedValue(adminSession);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const app = buildAdminApp();
    const res = await request(app)
      .get("/admin/users/search?email=test@example.com")
      .set("Authorization", "Bearer any-session");
    expect(res.status).toBe(401);
  });

  it("returns 403 when role is not admin", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", email: "cand@test.com", role: "candidate", firstName: null, lastName: null, profileImageUrl: null } });
    const app = buildAdminApp();
    const res = await request(app)
      .get("/admin/users/search?email=test@example.com")
      .set("Authorization", "Bearer candidate-session");
    expect(res.status).toBe(403);
  });

  it("returns 400 when email is missing", async () => {
    const app = buildAdminApp();
    const res = await request(app)
      .get("/admin/users/search")
      .set("Authorization", `Bearer ${ADMIN_SESSION}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("email");
  });

  it("returns 404 when user not found", async () => {
    adminResults.push([]);
    const app = buildAdminApp();
    const res = await request(app)
      .get("/admin/users/search?email=notfound@example.com")
      .set("Authorization", `Bearer ${ADMIN_SESSION}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toContain("No account found");
  });

  it("returns user data when found", async () => {
    adminResults.push([
      { id: "u-found", email: "found@example.com", firstName: "Jane", lastName: "Doe", role: "candidate", emailVerified: true, hasPassword: "$hashed$", emailVerifyTokenExpires: null, passwordResetTokenExpires: null, createdAt: new Date(), updatedAt: new Date() },
    ]);
    const app = buildAdminApp();
    const res = await request(app)
      .get("/admin/users/search?email=found@example.com")
      .set("Authorization", `Bearer ${ADMIN_SESSION}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("found@example.com");
    expect(res.body.hasPassword).toBe(true);
  });
});

describe("POST /admin/users/:id/mark-verified", () => {
  beforeEach(() => {
    adminResults.length = 0;
    mockGetSession.mockResolvedValue(adminSession);
  });

  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const app = buildAdminApp();
    const res = await request(app)
      .post("/admin/users/u1/mark-verified")
      .set("Authorization", "Bearer any-session");
    expect(res.status).toBe(401);
  });

  it("returns 403 when role is not admin", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", email: "cand@test.com", role: "candidate", firstName: null, lastName: null, profileImageUrl: null } });
    const app = buildAdminApp();
    const res = await request(app)
      .post("/admin/users/u1/mark-verified")
      .set("Authorization", "Bearer cand-session");
    expect(res.status).toBe(403);
  });

  it("returns 404 when user not found", async () => {
    adminResults.push([]);
    const app = buildAdminApp();
    const res = await request(app)
      .post("/admin/users/nonexistent/mark-verified")
      .set("Authorization", `Bearer ${ADMIN_SESSION}`);
    expect(res.status).toBe(404);
  });

  it("returns 200 and writes audit event when user found", async () => {
    const { writeAuditEvent } = await import("../../lib/audit");
    adminResults.push(
      [{ id: "u1", email: "test@example.com", emailVerified: false }],
      [{ id: "u1", emailVerified: true }],
    );
    const app = buildAdminApp();
    const res = await request(app)
      .post("/admin/users/u1/mark-verified")
      .set("Authorization", `Bearer ${ADMIN_SESSION}`);
    expect(res.status).toBe(200);
    expect(writeAuditEvent).toHaveBeenCalled();
  });
});
