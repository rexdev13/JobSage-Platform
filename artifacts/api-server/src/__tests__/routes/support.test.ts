import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const {
  dbResults,
  txResults,
  insertedValues,
  txInsertedValues,
  updatedValues,
  txUpdatedValues,
  mockGetSession,
  sendSupportTicketNotificationMock,
  sendSupportTicketReplyMock,
  requestLogErrorMock,
} = vi.hoisted(() => ({
  dbResults: [] as any[],
  txResults: [] as any[],
  insertedValues: [] as any[],
  txInsertedValues: [] as any[],
  updatedValues: [] as any[],
  txUpdatedValues: [] as any[],
  mockGetSession: vi.fn(),
  sendSupportTicketNotificationMock: vi.fn(),
  sendSupportTicketReplyMock: vi.fn(),
  requestLogErrorMock: vi.fn(),
}));

vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema");

  function makeSelectChain(results: any[]): any {
    const chain: any = {
      from() { return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return chain; },
      offset() { return chain; },
      for() { return chain; },
      then(resolve: any, reject?: any) {
        return Promise.resolve(results.shift() ?? []).then(resolve, reject);
      },
    };
    return chain;
  }

  function makeInsertChain(log: any[], rows: any[] = []): any {
    const chain: any = {
      values(value: any) {
        log.push(value);
        return chain;
      },
      returning() {
        return Promise.resolve(rows);
      },
      then(resolve: any, reject?: any) {
        return Promise.resolve(undefined).then(resolve, reject);
      },
    };
    return chain;
  }

  function makeUpdateChain(log: any[], results: any[]): any {
    const chain: any = {
      set(value: any) {
        log.push(value);
        return chain;
      },
      where() { return chain; },
      returning() {
        return Promise.resolve(results.shift() ?? []);
      },
    };
    return chain;
  }

  const tx = {
    select: vi.fn(() => makeSelectChain(txResults)),
    insert: vi.fn((table: unknown) =>
      makeInsertChain(
        txInsertedValues,
        table === schema.candidateMessagesTable ? [{ id: 901 }] : [],
      ),
    ),
    update: vi.fn(() => makeUpdateChain(txUpdatedValues, txResults)),
  };

  return {
    ...schema,
    db: {
      select: vi.fn(() => makeSelectChain(dbResults)),
      insert: vi.fn(() => makeInsertChain(insertedValues)),
      update: vi.fn(() => makeUpdateChain(updatedValues, dbResults)),
      transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
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
  sendSupportTicketReply: sendSupportTicketReplyMock,
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
    userId: null,
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

const replyInput = {
  replyText: "We have sent you a replacement link. Please check your inbox.",
  status: "attended",
  expectedUpdatedAt: "2026-10-01T10:00:00.000Z",
};

describe("support ticket routes", () => {
  beforeEach(() => {
    dbResults.length = 0;
    txResults.length = 0;
    insertedValues.length = 0;
    txInsertedValues.length = 0;
    updatedValues.length = 0;
    txUpdatedValues.length = 0;
    mockGetSession.mockResolvedValue(null);
    sendSupportTicketNotificationMock.mockReset().mockResolvedValue({ success: true });
    sendSupportTicketReplyMock.mockReset().mockResolvedValue({ success: true });
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

  it("allows admins and super admins to list and update tickets", async () => {
    dbResults.push([supportTicketRow()]);
    const listed = await request(buildApp())
      .get("/admin/super/support-tickets?status=needs_attention&category=Technical%20Support&sort=oldest")
      .set(authAs("admin"));
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);

    dbResults.push([
      supportTicketRow({
        status: "in_review",
        adminNotes: "Sent a replacement link.",
        reviewedBy: "super_admin-1",
        reviewedAt: new Date("2026-10-01T11:00:00.000Z"),
      }),
    ]);
    const updated = await request(buildApp())
      .patch("/admin/super/support-tickets/41")
      .set(authAs("super_admin"))
      .send({ status: "in_review", adminNotes: "Sent a replacement link." });

    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe("in_review");
    expect(updatedValues[0]).toMatchObject({
      status: "in_review",
      adminNotes: "Sent a replacement link.",
      reviewedBy: "super_admin-1",
    });
  });

  it("returns the ticket and full reply history to an admin", async () => {
    const reply = {
      id: 1,
      ticketId: 41,
      adminUserId: "admin-1",
      adminDisplayName: "Alex Admin",
      replyText: "We have sent a replacement link.",
      deliveryChannel: "email",
      deliveryStatus: "sent",
      candidateMessageId: null,
      createdAt: new Date("2026-10-01T11:00:00.000Z"),
    };
    dbResults.push([supportTicketRow()], [reply]);

    const response = await request(buildApp())
      .get("/admin/super/support-tickets/41")
      .set(authAs("admin"));

    expect(response.status).toBe(200);
    expect(response.body.ticket.ticketId).toBe("JS-ABCDEF1234");
    expect(response.body.replies[0]).toMatchObject({
      adminDisplayName: "Alex Admin",
      replyText: "We have sent a replacement link.",
      deliveryChannel: "email",
    });
  });

  it("creates an account-holder inbox message and durable reply record transactionally", async () => {
    const ticket = supportTicketRow({ userId: candidate.id });
    const updatedTicket = { ...ticket, status: "resolved", reviewedBy: "admin-1", reviewedAt: new Date() };
    const reply = {
      id: 3,
      ticketId: 41,
      adminUserId: "admin-1",
      adminDisplayName: "admin-1",
      replyText: replyInput.replyText,
      deliveryChannel: "inbox",
      deliveryStatus: "sent",
      candidateMessageId: 901,
      createdAt: new Date("2026-10-01T11:00:00.000Z"),
    };
    txResults.push([ticket], [updatedTicket], [reply]);

    const response = await request(buildApp())
      .post("/admin/super/support-tickets/41/replies")
      .set(authAs("admin"))
      .send({ ...replyInput, status: "resolved" });

    expect(response.status).toBe(200);
    expect(response.body.ticket.status).toBe("resolved");
    expect(response.body.replies).toHaveLength(1);
    expect(txInsertedValues[0]).toMatchObject({
      recipientUserId: candidate.id,
      companyName: "JOBSAGE Support",
      messageType: "support",
      subject: "Reply to your support inquiry: Password reset link",
      supportTicketId: 41,
      messageText: replyInput.replyText,
    });
    expect(txInsertedValues[1]).toMatchObject({
      ticketId: 41,
      adminUserId: "admin-1",
      deliveryChannel: "inbox",
      candidateMessageId: 901,
    });
    expect(txUpdatedValues[0]).toMatchObject({ status: "resolved", reviewedBy: "admin-1" });
    expect(sendSupportTicketReplyMock).not.toHaveBeenCalled();
  });

  it("emails guest replies and records their delivery channel", async () => {
    const ticket = supportTicketRow();
    const updatedTicket = { ...ticket, status: "attended", reviewedBy: "admin-1", reviewedAt: new Date() };
    const reply = {
      id: 4,
      ticketId: 41,
      adminUserId: "admin-1",
      adminDisplayName: "admin-1",
      replyText: replyInput.replyText,
      deliveryChannel: "email",
      deliveryStatus: "sent",
      candidateMessageId: null,
      createdAt: new Date("2026-10-01T11:00:00.000Z"),
    };
    txResults.push([ticket], [updatedTicket], [reply]);

    const response = await request(buildApp())
      .post("/admin/super/support-tickets/41/replies")
      .set(authAs("admin"))
      .send(replyInput);

    expect(response.status).toBe(200);
    expect(response.body.ticket.status).toBe("attended");
    expect(response.body.replies[0].deliveryChannel).toBe("email");
    expect(sendSupportTicketReplyMock).toHaveBeenCalledWith({
      to: ticket.email,
      ticketId: ticket.ticketId,
      subject: ticket.subject,
      replyText: replyInput.replyText,
    });
    expect(txInsertedValues[0]).toMatchObject({
      ticketId: 41,
      adminUserId: "admin-1",
      deliveryChannel: "email",
      candidateMessageId: null,
    });
  });

  it("durably records failed guest email delivery without marking the ticket attended or resolved", async () => {
    sendSupportTicketReplyMock.mockResolvedValue({ success: false, error: "Provider unavailable" });
    txResults.push([supportTicketRow()]);

    const response = await request(buildApp())
      .post("/admin/super/support-tickets/41/replies")
      .set(authAs("admin"))
      .send({ ...replyInput, status: "resolved" });

    expect(response.status).toBe(502);
    expect(response.body.error).toContain("not marked attended or resolved");
    expect(txInsertedValues).toHaveLength(1);
    expect(txInsertedValues[0]).toMatchObject({
      ticketId: 41,
      deliveryChannel: "email",
      deliveryStatus: "failed",
      candidateMessageId: null,
    });
    expect(txUpdatedValues).toHaveLength(0);
    expect(requestLogErrorMock).toHaveBeenCalled();
  });

  it("rejects a stale reply instead of duplicating a concurrent admin response", async () => {
    txResults.push([
      supportTicketRow({ updatedAt: new Date("2026-10-01T10:05:00.000Z") }),
    ]);

    const response = await request(buildApp())
      .post("/admin/super/support-tickets/41/replies")
      .set(authAs("admin"))
      .send(replyInput);

    expect(response.status).toBe(409);
    expect(txInsertedValues).toHaveLength(0);
    expect(txUpdatedValues).toHaveLength(0);
    expect(sendSupportTicketReplyMock).not.toHaveBeenCalled();
  });
});
