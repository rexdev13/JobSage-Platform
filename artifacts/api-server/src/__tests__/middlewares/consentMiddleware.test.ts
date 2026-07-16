import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const { consentResults } = vi.hoisted(() => ({ consentResults: [] as any[] }));

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from() { return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return chain; },
      then(resolve: any, reject?: any) {
        return Promise.resolve(consentResults.shift() ?? []).then(resolve, reject);
      },
      catch() { return chain; },
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
    consentLogsTable: {},
    usersTable: {},
    sessionsTable: {},
  };
});

const mockGetSession = vi.fn().mockResolvedValue({
  user: { id: "user-1", email: "u@test.com", role: "candidate", firstName: null, lastName: null, profileImageUrl: null },
});

vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return {
    ...actual,
    createSession: vi.fn(),
    getSession: mockGetSession,
    clearSession: vi.fn(),
    deleteSession: vi.fn(),
  };
});

const { requireConsent } = await import("../../middlewares/consentMiddleware");
const { authMiddleware } = await import("../../middlewares/authMiddleware");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.get("/protected", requireConsent, (_req: Request, res: Response) => {
    res.json({ ok: true });
  });
  return app;
}

const AUTH_HEADER = "Bearer user-session-token";
const userSession = {
  user: { id: "user-1", email: "u@test.com", role: "candidate", firstName: null, lastName: null, profileImageUrl: null },
};
const consentRow = { id: 1, userId: "user-1", consentedAt: new Date() };

describe("requireConsent middleware", () => {
  beforeEach(() => {
    consentResults.length = 0;
    mockGetSession.mockResolvedValue(userSession);
  });

  it("returns 401 when not authenticated (no auth header)", async () => {
    mockGetSession.mockResolvedValue(null);
    const resp = await request(buildApp()).get("/protected");
    expect(resp.status).toBe(401);
  });

  it("returns 403 with consent error when no consent on record", async () => {
    consentResults.push([]);
    const resp = await request(buildApp())
      .get("/protected")
      .set("Authorization", AUTH_HEADER);
    expect(resp.status).toBe(403);
    expect(resp.body.error).toMatch(/consent/i);
  });

  it("passes through (200) when consent is present", async () => {
    consentResults.push([consentRow]);
    const resp = await request(buildApp())
      .get("/protected")
      .set("Authorization", AUTH_HEADER);
    expect(resp.status).toBe(200);
    expect(resp.body).toEqual({ ok: true });
  });

  it("uses the most-recent consent record — multiple rows still allow access", async () => {
    const oldConsent = { id: 1, userId: "user-1", consentedAt: new Date("2024-01-01") };
    const newConsent = { id: 2, userId: "user-1", consentedAt: new Date("2025-06-01") };
    consentResults.push([newConsent, oldConsent]);
    const resp = await request(buildApp())
      .get("/protected")
      .set("Authorization", AUTH_HEADER);
    expect(resp.status).toBe(200);
  });
});
