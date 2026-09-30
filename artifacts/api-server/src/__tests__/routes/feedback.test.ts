import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const {
  dbResults,
  insertedValues,
  updatedValues,
  mockGetSession,
} = vi.hoisted(() => ({
  dbResults: [] as any[],
  insertedValues: [] as any[],
  updatedValues: [] as any[],
  mockGetSession: vi.fn(),
}));

vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema");

  function makeSelectChain(): any {
    const chain: any = {
      from() { return chain; },
      where() { return chain; },
      groupBy() { return chain; },
      orderBy() { return chain; },
      limit() { return chain; },
      offset() { return chain; },
      then(resolve: any, reject?: any) {
        return Promise.resolve(dbResults.shift() ?? []).then(resolve, reject);
      },
    };
    return chain;
  }

  function makeInsertChain(): any {
    const chain: any = {
      values(value: any) {
        insertedValues.push(value);
        return chain;
      },
      returning() {
        return Promise.resolve(dbResults.shift() ?? []);
      },
    };
    return chain;
  }

  function makeUpdateChain(): any {
    const chain: any = {
      set(value: any) {
        updatedValues.push(value);
        return chain;
      },
      where() { return chain; },
      returning() {
        return Promise.resolve(dbResults.shift() ?? []);
      },
    };
    return chain;
  }

  return {
    ...schema,
    db: {
      select: vi.fn(() => makeSelectChain()),
      insert: vi.fn(() => makeInsertChain()),
      update: vi.fn(() => makeUpdateChain()),
    },
  };
});

vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return {
    ...actual,
    getSession: mockGetSession,
    clearSession: vi.fn(),
  };
});

vi.mock("../../lib/audit", () => ({
  writeAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

const feedbackRouter = (await import("../../routes/feedback")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

const candidate = {
  id: "candidate-1",
  email: "candidate@example.com",
  role: "candidate",
  firstName: "Pat",
  lastName: "Lee",
  profileImageUrl: null,
  emailVerified: true,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(feedbackRouter);
  return app;
}

function feedbackRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 17,
    category: "issue",
    message: "The profile form did not save.",
    email: "candidate@example.com",
    pageUrl: "https://jobsage.co.uk/profile",
    screenResolution: "1440x900",
    userId: candidate.id,
    userAgent: "Test Browser",
    status: "new",
    adminNotes: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date("2026-09-30T10:00:00.000Z"),
    updatedAt: new Date("2026-09-30T10:00:00.000Z"),
    ...overrides,
  };
}

function authAs(user: typeof candidate = candidate) {
  mockGetSession.mockResolvedValue({ user });
  return { Authorization: "Bearer feedback-test-session" };
}

describe("product feedback routes", () => {
  beforeEach(() => {
    dbResults.length = 0;
    insertedValues.length = 0;
    updatedValues.length = 0;
    mockGetSession.mockResolvedValue(null);
  });

  it("accepts guest feedback with an optional email and captures the user agent", async () => {
    dbResults.push([{ id: 17 }]);
    const response = await request(buildApp())
      .post("/feedback")
      .set("user-agent", "Guest Test Browser")
      .send({
        category: "idea",
        message: "Add a way to save useful vacancies.",
        email: "guest@example.com",
        pageUrl: "https://jobsage.co.uk/opportunities?next=secret#role",
        screenResolution: "1366x768",
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ success: true, id: 17 });
    expect(insertedValues[0]).toMatchObject({
      category: "idea",
      email: "guest@example.com",
      pageUrl: "https://jobsage.co.uk/opportunities",
      userId: null,
      userAgent: "Guest Test Browser",
    });
  });

  it("uses server-captured identity for authenticated feedback", async () => {
    dbResults.push([{ id: 18 }]);
    const response = await request(buildApp())
      .post("/feedback")
      .set(authAs())
      .send({
        category: "general",
        message: "The new dashboard is easier to use.",
        email: "untrusted@example.com",
        pageUrl: "https://jobsage.co.uk/",
        screenResolution: "1920x1080",
      });

    expect(response.status).toBe(201);
    expect(insertedValues[0]).toMatchObject({
      userId: candidate.id,
      email: candidate.email,
    });
  });

  it("rejects blank messages without writing", async () => {
    const response = await request(buildApp())
      .post("/feedback")
      .send({
        category: "issue",
        message: "   ",
        pageUrl: "https://jobsage.co.uk/",
        screenResolution: "1280x800",
      });

    expect(response.status).toBe(400);
    expect(insertedValues).toHaveLength(0);
  });

  it("rejects non-web and strips query strings from captured URLs", async () => {
    const invalid = await request(buildApp())
      .post("/feedback")
      .send({
        category: "issue",
        message: "This URL should not be accepted.",
        pageUrl: "javascript:alert(1)",
        screenResolution: "1280x800",
      });
    expect(invalid.status).toBe(400);
    expect(insertedValues).toHaveLength(0);
  });

  it("restricts inbox access to admins and super admins", async () => {
    const guestResponse = await request(buildApp()).get("/admin/super/feedback");
    expect(guestResponse.status).toBe(401);

    mockGetSession.mockResolvedValue({
      user: { ...candidate, role: "employer", id: "employer-1" },
    });
    const employerResponse = await request(buildApp())
      .get("/admin/super/feedback")
      .set("Authorization", "Bearer feedback-test-session");
    expect(employerResponse.status).toBe(403);
  });

  it("returns unresolved-filtered items and summary counts to admins", async () => {
    mockGetSession.mockResolvedValue({ user: { ...candidate, role: "admin", id: "admin-1" } });
    dbResults.push(
      [
        { category: "issue", status: "new", total: "2" },
        { category: "idea", status: "resolved", total: "1" },
      ],
      [feedbackRow()],
    );

    const response = await request(buildApp())
      .get("/admin/super/feedback?status=unresolved")
      .set("Authorization", "Bearer feedback-test-session");

    expect(response.status).toBe(200);
    expect(response.body.summary).toEqual({
      total: 3,
      issues: 2,
      ideas: 1,
      general: 0,
      unresolved: 2,
    });
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0].message).toBe("The profile form did not save.");
  });

  it("updates status and admin notes", async () => {
    mockGetSession.mockResolvedValue({ user: { ...candidate, role: "super_admin", id: "admin-1" } });
    dbResults.push([
      feedbackRow({
        status: "in_review",
        adminNotes: "Reproduced and assigned to the product team.",
        reviewedBy: "admin-1",
        reviewedAt: new Date("2026-09-30T11:00:00.000Z"),
      }),
    ]);

    const response = await request(buildApp())
      .patch("/admin/super/feedback/17")
      .set("Authorization", "Bearer feedback-test-session")
      .send({ status: "in_review", adminNotes: "Reproduced and assigned to the product team." });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("in_review");
    expect(response.body.adminNotes).toBe("Reproduced and assigned to the product team.");
    expect(updatedValues[0]).toMatchObject({
      status: "in_review",
      adminNotes: "Reproduced and assigned to the product team.",
      reviewedBy: "admin-1",
    });
  });
});