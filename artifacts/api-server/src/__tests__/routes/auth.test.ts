import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const { authResults, setMock, deleteSessionMock, clearSessionMock } = vi.hoisted(() => ({
  authResults: [] as any[],
  setMock: vi.fn(),
  deleteSessionMock: vi.fn().mockResolvedValue(undefined),
  clearSessionMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from() { return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return chain; },
      values() { return chain; },
      set(value: unknown) { setMock(value); return chain; },
      then(resolve: any, reject?: any) {
        return Promise.resolve(authResults.shift() ?? []).then(resolve, reject);
      },
      catch() { return chain; },
      returning() { return Promise.resolve(authResults.shift() ?? []); },
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
    sessionsTable: {},
    auditEventsTable: {},
    socialLeadsTable: { email: "email", status: "status", convertedUserId: "converted_user_id" },
  };
});

vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return {
    ...actual,
    createSession: vi.fn().mockResolvedValue("test-session-id"),
    deleteSession: deleteSessionMock,
    getSession: vi.fn().mockResolvedValue(null),
    clearSession: clearSessionMock,
  };
});

vi.mock("../../lib/email", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/audit", () => ({
  writeAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/jobsageEmailGen", () => ({
  generateJobsageEmail: vi.fn().mockReturnValue("john.smith.x1y2@jobsage.co.uk"),
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$hashed$password"),
    compare: vi.fn().mockResolvedValue(false),
  },
  hash: vi.fn().mockResolvedValue("$hashed$password"),
  compare: vi.fn().mockResolvedValue(false),
}));

const authRouter = (await import("../../routes/auth")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(authRouter);
  return app;
}

describe("POST /auth/register", () => {
  it.each([undefined, false, "true", 18])("requires an explicit 18+ boolean confirmation (%j)", async ageConfirmed => {
    const res = await request(buildApp()).post("/auth/register")
      .send({ email: "adult@example.com", password: "securepass1", ageConfirmed });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("age_confirmation_required");
  });
  beforeEach(() => { authResults.length = 0; vi.clearAllMocks(); });

  it("returns 400 when email is missing", async () => {
    const app = buildApp();
    const res = await request(app).post("/auth/register").send({ password: "password123", ageConfirmed: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("email");
  });

  it("returns 400 when email is invalid", async () => {
    const app = buildApp();
    const res = await request(app).post("/auth/register").send({ email: "not-an-email", password: "password123", ageConfirmed: true });
    expect(res.status).toBe(400);
  });

  it("returns 400 when password is too short", async () => {
    const app = buildApp();
    const res = await request(app).post("/auth/register").send({ email: "test@example.com", password: "short", ageConfirmed: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("8 characters");
  });

  it("returns 409 when email already exists", async () => {
    authResults.push([{ id: "existing-user", emailVerified: true }]);
    const app = buildApp();
    const res = await request(app).post("/auth/register").send({ email: "existing@example.com", password: "password123", ageConfirmed: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("already exists");
  });

  it("returns 201 on valid registration", async () => {
    authResults.push(
      [],
      [{ id: "u1", email: "new@example.com", firstName: "John", lastName: "Smith", role: null, profileImageUrl: null, emailVerified: false, jobsageEmail: "john@jobsage.co.uk" }],
    );
    const app = buildApp();
    const res = await request(app)
      .post("/auth/register")
      .send({ email: "new@example.com", password: "securepass1", firstName: "John", lastName: "Smith", ageConfirmed: true });
    expect(res.status).toBe(201);
    expect(res.body.message).toContain("check your email");
    expect(setMock).toHaveBeenCalledWith({
      status: "registered",
      convertedUserId: "u1",
    });
  });
});

describe("POST /auth/login", () => {
  beforeEach(() => { authResults.length = 0; vi.clearAllMocks(); });

  it("returns 400 when fields are missing", async () => {
    const app = buildApp();
    const res = await request(app).post("/auth/login").send({ email: "test@example.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("required");
  });

  it("returns 401 when user not found", async () => {
    authResults.push([]);
    const app = buildApp();
    const res = await request(app).post("/auth/login").send({ email: "nobody@example.com", password: "password123" });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Invalid email or password");
  });

  it("returns 401 when password does not match", async () => {
    authResults.push([{ id: "u1", email: "test@example.com", passwordHash: "$hashed$", emailVerified: true, suspendedAt: null, role: "candidate" }]);
    const bcrypt = await import("bcryptjs");
    (bcrypt.default.compare as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const app = buildApp();
    const res = await request(app).post("/auth/login").send({ email: "test@example.com", password: "wrongpassword" });
    expect(res.status).toBe(401);
  });

  it("returns 403 when email not verified", async () => {
    authResults.push([{ id: "u1", email: "test@example.com", passwordHash: "$hashed$", emailVerified: false, suspendedAt: null, firstName: null, lastName: null, profileImageUrl: null, role: "candidate" }]);
    const bcrypt = await import("bcryptjs");
    (bcrypt.default.compare as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    const app = buildApp();
    const res = await request(app).post("/auth/login").send({ email: "test@example.com", password: "password123" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("email_not_verified");
  });

  it("returns 403 when account is suspended", async () => {
    authResults.push([{ id: "u1", email: "test@example.com", passwordHash: "$hashed$", emailVerified: true, suspendedAt: new Date(), firstName: null, lastName: null, profileImageUrl: null, role: "candidate" }]);
    const bcrypt = await import("bcryptjs");
    (bcrypt.default.compare as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    const app = buildApp();
    const res = await request(app).post("/auth/login").send({ email: "test@example.com", password: "password123" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("account_suspended");
  });

  it("returns 200 with user on successful login", async () => {
    authResults.push(
      [{ id: "u1", email: "test@example.com", passwordHash: "$hashed$", emailVerified: true, suspendedAt: null, firstName: "John", lastName: "Smith", profileImageUrl: null, role: "candidate", jobsageEmail: "john@jobsage.co.uk" }],
      [{ jobsageEmail: "john@jobsage.co.uk" }],
    );
    const bcrypt = await import("bcryptjs");
    (bcrypt.default.compare as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    const app = buildApp();
    const res = await request(app).post("/auth/login").send({ email: "test@example.com", password: "password123" });
    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.email).toBe("test@example.com");
  });
});

describe("GET /auth/verify-email", () => {
  beforeEach(() => { authResults.length = 0; vi.clearAllMocks(); });

  it("rejects expired verification links without issuing a session", async () => {
    authResults.push([{
      id: "u1",
      email: "test@example.com",
      emailVerifyTokenExpires: new Date(Date.now() - 1000),
    }]);
    const auth = await import("../../lib/auth");
    const res = await request(buildApp()).get("/auth/verify-email?token=expired-token");

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/login\?error=token_expired$/);
    expect(setMock).not.toHaveBeenCalled();
    expect(auth.createSession).not.toHaveBeenCalled();
  });

  it("clears a verified token and rejects replay", async () => {
    const app = buildApp();
    authResults.push([{
      id: "u1",
      email: "test@example.com",
      firstName: "Test",
      lastName: "User",
      profileImageUrl: null,
      role: "candidate",
      emailVerifyTokenExpires: new Date(Date.now() + 3600000),
    }]);
    const first = await request(app).get("/auth/verify-email?token=single-use-token");

    expect(first.status).toBe(302);
    expect(first.headers.location).toMatch(/\/$/);
    expect(first.headers["set-cookie"]).toBeDefined();
    expect(setMock).toHaveBeenCalledWith({
      emailVerified: true,
      emailVerifyToken: null,
      emailVerifyTokenExpires: null,
    });

    authResults.push([]);
    const replay = await request(app).get("/auth/verify-email?token=single-use-token");
    expect(replay.status).toBe(302);
    expect(replay.headers.location).toMatch(/\/login\?error=token_expired$/);
    expect(setMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /auth/forgot-password", () => {
  beforeEach(() => { authResults.length = 0; vi.clearAllMocks(); });

  it("returns 400 when email is missing", async () => {
    const app = buildApp();
    const res = await request(app).post("/auth/forgot-password").send({});
    expect(res.status).toBe(400);
  });

  it("returns safe 200 when email not found", async () => {
    authResults.push([]);
    const app = buildApp();
    const res = await request(app).post("/auth/forgot-password").send({ email: "nobody@example.com" });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain("If an account");
  });

  it("returns 200 and sends reset email when user exists", async () => {
    authResults.push([{ id: "u1", emailVerified: true }]);
    const app = buildApp();
    const res = await request(app).post("/auth/forgot-password").send({ email: "user@example.com" });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain("If an account");
  });
});

describe("POST /auth/reset-password", () => {
  beforeEach(() => { authResults.length = 0; vi.clearAllMocks(); });

  it("returns 400 when token or password missing", async () => {
    const app = buildApp();
    const res = await request(app).post("/auth/reset-password").send({ token: "abc" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when password too short", async () => {
    const app = buildApp();
    const res = await request(app).post("/auth/reset-password").send({ token: "abc", password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("8 characters");
  });

  it("returns 400 when token is invalid", async () => {
    authResults.push([]);
    const app = buildApp();
    const res = await request(app).post("/auth/reset-password").send({ token: "bad-token", password: "newpassword123" });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("invalid or has expired");
  });

  it("returns 200 on successful reset", async () => {
    authResults.push([{ id: "u1", email: "test@example.com", passwordResetTokenExpires: new Date(Date.now() + 3600000) }]);
    const app = buildApp();
    const res = await request(app).post("/auth/reset-password").send({ token: "valid-token", password: "newpassword123" });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain("Password updated");
  });

  it("rejects expired reset links without changing the account", async () => {
    authResults.push([{
      id: "u1",
      passwordResetTokenExpires: new Date(Date.now() - 1000),
    }]);
    const bcrypt = await import("bcryptjs");
    const res = await request(buildApp())
      .post("/auth/reset-password")
      .send({ token: "expired-token", password: "newpassword123" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("has expired");
    expect(setMock).not.toHaveBeenCalled();
    expect(bcrypt.default.hash).not.toHaveBeenCalled();
  });

  it("clears a reset token after use so a replay is rejected", async () => {
    const app = buildApp();
    authResults.push([{
      id: "u1",
      passwordResetTokenExpires: new Date(Date.now() + 3600000),
    }]);
    const first = await request(app)
      .post("/auth/reset-password")
      .send({ token: "single-use-token", password: "newpassword123" });

    expect(first.status).toBe(200);
    expect(setMock).toHaveBeenCalledWith(expect.objectContaining({
      passwordResetToken: null,
      passwordResetTokenExpires: null,
    }));

    authResults.push([]);
    const replay = await request(app)
      .post("/auth/reset-password")
      .send({ token: "single-use-token", password: "newpassword123" });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toContain("invalid or has expired");
    expect(setMock).toHaveBeenCalledTimes(1);
  });
});

describe("POST /auth/resend-verification", () => {
  beforeEach(() => { authResults.length = 0; vi.clearAllMocks(); });

  it("returns 400 when email missing", async () => {
    const app = buildApp();
    const res = await request(app).post("/auth/resend-verification").send({});
    expect(res.status).toBe(400);
  });

  it("returns safe 200 when user not found", async () => {
    authResults.push([]);
    const app = buildApp();
    const res = await request(app).post("/auth/resend-verification").send({ email: `nouser-${Date.now()}@example.com` });
    expect(res.status).toBe(200);
    expect(res.body.message).toContain("If an unverified account");
  });

  it("returns 429 when called too quickly", async () => {
    const email = `ratelimit-${Date.now()}@example.com`;
    authResults.push([{ id: "u1", emailVerified: false }], [{ id: "u1", emailVerified: false }]);
    const app = buildApp();
    await request(app).post("/auth/resend-verification").send({ email });
    const res = await request(app).post("/auth/resend-verification").send({ email });
    expect(res.status).toBe(429);
    expect(res.body.error).toContain("Please wait");
    expect(res.body.retryAfter).toBeGreaterThan(0);
  });

  it("returns 200 when account is already verified", async () => {
    authResults.push([{ id: "u1", emailVerified: true }]);
    const email = `verified-${Date.now()}@example.com`;
    const app = buildApp();
    const res = await request(app).post("/auth/resend-verification").send({ email });
    expect(res.status).toBe(200);
  });
});

describe("GET /auth/user", () => {
  it("returns null user when not authenticated", async () => {
    const app = buildApp();
    const res = await request(app).get("/auth/user");
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });
});

describe("POST /auth/logout", () => {
  it("revokes only the bearer session without clearing a concurrent browser cookie", async () => {
    deleteSessionMock.mockClear(); clearSessionMock.mockClear();
    const { SESSION_COOKIE } = await import("../../lib/auth");
    const res = await request(buildApp()).post("/auth/logout")
      .set("Authorization", "Bearer native-session-fixture")
      .set("Cookie", `${SESSION_COOKIE}=new-browser-session-fixture`);
    expect(res.status).toBe(200);
    expect(deleteSessionMock).toHaveBeenCalledWith("native-session-fixture");
    expect(clearSessionMock).not.toHaveBeenCalled();
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
  it("retains ordinary cookie logout behavior", async () => {
    deleteSessionMock.mockClear(); clearSessionMock.mockClear();
    const { SESSION_COOKIE } = await import("../../lib/auth");
    const res = await request(buildApp()).post("/auth/logout").set("Cookie", `${SESSION_COOKIE}=browser-session-fixture`);
    expect(res.status).toBe(200);
    expect(clearSessionMock).toHaveBeenCalledWith(expect.anything(), "browser-session-fixture");
    expect(deleteSessionMock).not.toHaveBeenCalled();
  });
  it("returns success", async () => {
    const app = buildApp();
    const res = await request(app).post("/auth/logout");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
