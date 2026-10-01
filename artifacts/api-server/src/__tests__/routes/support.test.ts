import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const {
  dbResults,
  insertedValues,
  updatedValues,
  mockGetSession,
  sendSupportTicketNotificationMock,
  requestLogErrorMock,
} = vi.hoisted(() => ({
  dbResults: [] as any[],
  insertedValues: [] as any[],
  updatedValues: [] as any[],
  mockGetSession: vi.fn(),
  sendSupportTicketNotificationMock: vi.fn(),
  requestLogErrorMock: vi.fn(),
}));

vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema");

  function makeSelectChain(): any {
    const chain: any = {
      from() { return chain; },
      where() { return chain; },
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
      then(resolve: any, reject?: any) {
        return Promise.resolve(undefined).then(resolve, reject);
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

vi.mock("../../lib/email", () => ({
  sendSupportTicketNotification: sendSupportTicketNotificationMock,
}));

vi.mock("../../lib/audit", () => ({
  writeAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

const supportRouter = (await import("../../routes/support")).default;
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
  app.use((req, _res, next) => {
    (req as any).log = { error: requestLogErrorMock };
    next();
  });
  app.use(authMiddleware);
  app.use(supportRouter);
  return app;
}

function supportTicketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    ticketId: "JS-ABCDEF1234",
    name: "Pat Lee",
    email: "candidate@example.com",
    category: "Technical Support",
    subject: "Password reset link",
    message: "The password reset link never arrives.",
    userId: candidate.id,
    status: "new",
    adminNotes: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date("2026-10-01T10:00:00.000Z"),
    updatedAt: new Date("2026-10-01T10:00:00.000Z"),
    ...overrides,
  };
}

function authAs(role: string) {
  mockGetSession.mockResolvedValue({
    user: { ...candidate, id: `${role}-1`, role },
  });
  return { Authorization: "Bearer support-test-session" };
}

const ticketInput = {
  name: "Pat Lee",
  email: "candidate@example.com",
  category: "Technical Support",
  subject: "Password reset link",
  message: "The password reset link never arrives.",
};

describe("support ticket routes", () => {
  beforeEach(() => {
    dbResults.length = 0;
    insertedValues.length = 0;
    updatedValues.length = 0;
    mockGetSession.mockResolvedValue(null);
    sendSupportTicketNotificationMock.mockReset().mockResolvedValue({ success: true });
    requestLogErrorMock.mockReset();
  });

  it("saves a guest ticket before sending the email notification", async () => {
    const response = await request(buildApp()).post("/support/ticket").send(ticketInput);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.ticketId).toMatch(/^JS-[A-F0-9]{10}$/);
    expect(insertedValues[0]).toMatchObject({
      ...ticketInput,
      ticketId: response.body.ticketId,
      userId: null,
    });
    expect(sendSupportTicketNotificationMock).toHaveBeenCalledWith({
      ...ticketInput,
      ticketId: response.body.ticketId,
    });
  });

  it("keeps a saved ticket successful when its notification email fails", async () => {
    sendSupportTicketNotificationMock.mockResolvedValue({ success: false, error: "Provider unavailable" });

    const response = await request(buildApp()).post("/support/ticket").send(ticketInput);

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(insertedValues).toHaveLength(1);
    expect(requestLogErrorMock).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: response.body.ticketId }),
      "Support ticket was saved but its email notification could not be delivered",
    );
  });

  it("shows tickets only to super admins and lets them update status and notes", async () => {
    const forbidden = await request(buildApp())
      .get("/admin/super/support-tickets")
      .set(authAs("admin"));
    expect(forbidden.status).toBe(403);

    mockGetSession.mockResolvedValue({ user: { ...candidate, id: "super-1", role: "super_admin" } });
    dbResults.push([supportTicketRow()]);
    const listed = await request(buildApp())
      .get("/admin/super/support-tickets?status=new")
      .set("Authorization", "Bearer support-test-session");
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].ticketId).toBe("JS-ABCDEF1234");

    dbResults.push([
      supportTicketRow({
        status: "in_review",
        adminNotes: "Sent a replacement link.",
        reviewedBy: "super-1",
        reviewedAt: new Date("2026-10-01T11:00:00.000Z"),
      }),
    ]);
    const updated = await request(buildApp())
      .patch("/admin/super/support-tickets/41")
      .set("Authorization", "Bearer support-test-session")
      .send({ status: "in_review", adminNotes: "Sent a replacement link." });

    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe("in_review");
    expect(updated.body.adminNotes).toBe("Sent a replacement link.");
    expect(updatedValues[0]).toMatchObject({
      status: "in_review",
      adminNotes: "Sent a replacement link.",
      reviewedBy: "super-1",
    });
  });
});