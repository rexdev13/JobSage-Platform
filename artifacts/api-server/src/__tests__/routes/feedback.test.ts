import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const {
  dbResults,
  insertedValues,
  updatedValues,
  mockGetSession,
  mockSendProductFeedbackReply,
} = vi.hoisted(() => ({
  dbResults: [] as any[],
  insertedValues: [] as any[],
  updatedValues: [] as any[],
  mockGetSession: vi.fn(),
  mockSendProductFeedbackReply: vi.fn(),
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
        for() { return chain; },
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
      then(resolve: any, reject?: any) {
        return Promise.resolve(dbResults.shift() ?? []).then(resolve, reject);
      },
    };
    return chain;
  }

  function makeTransaction() {
    return {
      select: vi.fn(() => makeSelectChain()),
      insert: vi.fn(() => makeInsertChain()),
      update: vi.fn(() => makeUpdateChain()),
    };
  }

  return {
    ...schema,
    db: {
      select: vi.fn(() => makeSelectChain()),
      insert: vi.fn(() => makeInsertChain()),
      update: vi.fn(() => makeUpdateChain()),
      transaction: vi.fn(async (callback: (tx: ReturnType<typeof makeTransaction>) => unknown) => callback(makeTransaction())),
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

vi.mock("../../lib/email", () => ({
  sendProductFeedbackReply: mockSendProductFeedbackReply,
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

function feedbackReplyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 91,
    feedbackId: 17,
    adminUserId: "admin-1",
    adminDisplayName: "Admin User",
    replyText: "We have fixed this issue.",
    deliveryChannel: "inbox",
    deliveryStatus: "sent",
    candidateMessageId: 83,
    createdAt: new Date("2026-09-30T11:00:00.000Z"),
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
    mockSendProductFeedbackReply.mockReset();
    mockSendProductFeedbackReply.mockResolvedValue({ success: true });
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
      [feedbackReplyRow()],
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
    expect(response.body.items[0].replies).toHaveLength(1);
    expect(response.body.items[0].replies[0].replyText).toBe("We have fixed this issue.");
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

  it("sends a reply to a signed-in feedback submitter's JOBSAGE inbox and records it", async () => {
    mockGetSession.mockResolvedValue({
      user: { ...candidate, role: "admin", id: "admin-1" },
    });
    dbResults.push(
      [feedbackRow()],
      [{ id: 83 }],
      [feedbackReplyRow()],
      [],
    );

    const response = await request(buildApp())
      .post("/admin/super/feedback/17/replies")
      .set("Authorization", "Bearer feedback-test-session")
      .send({
        replyText: "We have fixed this issue.",
        expectedUpdatedAt: "2026-09-30T10:00:00.000Z",
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 91,
      feedbackId: 17,
      deliveryChannel: "inbox",
      deliveryStatus: "sent",
      candidateMessageId: 83,
    });
    expect(insertedValues[0]).toMatchObject({
      recipientUserId: candidate.id,
      companyName: "JOBSAGE Support",
      messageType: "support",
      subject: "Reply to your JOBSAGE feedback",
    });
    expect(insertedValues[1]).toMatchObject({
      feedbackId: 17,
      adminUserId: "admin-1",
      replyText: "We have fixed this issue.",
      deliveryChannel: "inbox",
      candidateMessageId: 83,
    });
    expect(mockSendProductFeedbackReply).not.toHaveBeenCalled();
  });

  it("emails guest feedback replies and records the delivery channel", async () => {
    mockGetSession.mockResolvedValue({
      user: { ...candidate, role: "super_admin", id: "admin-1" },
    });
    dbResults.push(
      [feedbackRow({ userId: null, email: "guest@example.com" })],
      [feedbackReplyRow({
        deliveryChannel: "email",
        candidateMessageId: null,
      })],
      [],
    );

    const response = await request(buildApp())
      .post("/admin/super/feedback/17/replies")
      .set("Authorization", "Bearer feedback-test-session")
      .send({
        replyText: "Thanks for the suggestion.",
        expectedUpdatedAt: "2026-09-30T10:00:00.000Z",
      });

    expect(response.status).toBe(200);
    expect(response.body.deliveryChannel).toBe("email");
    expect(mockSendProductFeedbackReply).toHaveBeenCalledWith({
      to: "guest@example.com",
      feedbackId: 17,
      replyText: "Thanks for the suggestion.",
    });
    expect(insertedValues[0]).toMatchObject({
      feedbackId: 17,
      deliveryChannel: "email",
      deliveryStatus: "sent",
      candidateMessageId: null,
    });
  });

  it("refuses to send when a guest has no valid reply address", async () => {
    mockGetSession.mockResolvedValue({
      user: { ...candidate, role: "admin", id: "admin-1" },
    });
    dbResults.push([feedbackRow({ userId: null, email: null })]);

    const response = await request(buildApp())
      .post("/admin/super/feedback/17/replies")
      .set("Authorization", "Bearer feedback-test-session")
      .send({
        replyText: "Thanks for the feedback.",
        expectedUpdatedAt: "2026-09-30T10:00:00.000Z",
      });

    expect(response.status).toBe(422);
    expect(insertedValues).toHaveLength(0);
    expect(mockSendProductFeedbackReply).not.toHaveBeenCalled();
  });
});