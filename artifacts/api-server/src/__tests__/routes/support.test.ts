import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const {
  dbResults,
  txResults,
  txExecuteResults,
  insertedValues,
  txInsertedValues,
  updatedValues,
  txUpdatedValues,
  mockGetSession,
  sendSupportTicketNotificationMock,
  sendSupportTicketReplyMock,
  requestLogErrorMock,
  writeAuditEventMock,
} = vi.hoisted(() => ({
  dbResults: [] as any[],
  txResults: [] as any[],
  txExecuteResults: [] as any[],
  insertedValues: [] as any[],
  txInsertedValues: [] as any[],
  updatedValues: [] as any[],
  txUpdatedValues: [] as any[],
  mockGetSession: vi.fn(),
  sendSupportTicketNotificationMock: vi.fn(),
  sendSupportTicketReplyMock: vi.fn(),
  requestLogErrorMock: vi.fn(),
  writeAuditEventMock: vi.fn(),
}));

vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema");

  function makeSelectChain(results: any[]): any {
    const chain: any = {
      from() { return chain; },
      innerJoin() { return chain; },
      leftJoin() { return chain; },
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
    execute: vi.fn(async () => ({ rows: txExecuteResults.shift() ?? [] })),
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
  writeAuditEvent: writeAuditEventMock,
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
    isContentReport: false,
    reportedMessageId: null,
    reportedContentType: null,
    reportedContentId: null,
    reportedContextId: null,
    appealOfTicketId: null,
    status: "new",
    severity: "normal",
    assignedModeratorId: null,
    escalatedAt: null,
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
    txExecuteResults.length = 0;
    insertedValues.length = 0;
    txInsertedValues.length = 0;
    updatedValues.length = 0;
    txUpdatedValues.length = 0;
    mockGetSession.mockResolvedValue(null);
    sendSupportTicketNotificationMock.mockReset().mockResolvedValue({ success: true });
    sendSupportTicketReplyMock.mockReset().mockResolvedValue({ success: true });
    requestLogErrorMock.mockReset();
    writeAuditEventMock.mockReset().mockResolvedValue(true);
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
      isContentReport: false,
    });
    expect(sendSupportTicketNotificationMock).toHaveBeenCalledWith({
      ...ticketInput,
      ticketId: response.body.ticketId,
    });
  });

  it("binds AI reports to fresh account contact details and excludes draft text from email", async () => {
    dbResults.push([{ email: "reporter@example.test", firstName: "Reporter", lastName: "Fixture" }]);
    const response = await request(buildApp()).post("/support/ticket").set(authAs("candidate"))
      .set("X-Jobsage-AI-Report", "1").set("X-Jobsage-Report-User", "candidate-1")
      .send({ ...ticketInput, name: "Forged contact", email: "other@example.test", message: "Private answer excerpt fixture." });
    expect(response.status).toBe(201);
    expect(txInsertedValues[0]).toMatchObject({
      userId: "candidate-1", email: "reporter@example.test", name: "Reporter Fixture",
      category: "Other", subject: "AI content report",
      message: "Private answer excerpt fixture.", isContentReport: true,
      reportedContentType: "ai_content", reportedContentId: null,
    });
    expect(sendSupportTicketNotificationMock.mock.calls[0][0].message).not.toContain("Private answer excerpt");
  });

  it("logs an audit-write failure after saving a content report", async () => {
    dbResults.push([{ email: "reporter@example.test", firstName: "Reporter", lastName: "Fixture" }]);
    writeAuditEventMock.mockResolvedValue(false);
    const response = await request(buildApp()).post("/support/ticket").set(authAs("candidate"))
      .set("X-Jobsage-AI-Report", "1").set("X-Jobsage-Report-User", "candidate-1")
      .send({ ...ticketInput, message: "Private answer excerpt fixture." });

    expect(response.status).toBe(201);
    expect(writeAuditEventMock).toHaveBeenCalledWith("candidate-1", "candidate_content_report", response.body.ticketId, {
      reportType: "ai_content",
    });
    expect(requestLogErrorMock).toHaveBeenCalledWith(
      { ticketId: response.body.ticketId },
      "Content report was saved but its audit event could not be recorded",
    );
  });

  it("rejects a report after the requesting account changes", async () => {
    const response = await request(buildApp()).post("/support/ticket").set(authAs("candidate"))
      .set("X-Jobsage-AI-Report", "1").set("X-Jobsage-Report-User", "previous-account")
      .send(ticketInput);
    expect(response.status).toBe(403);
    expect(insertedValues).toHaveLength(0);
    expect(sendSupportTicketNotificationMock).not.toHaveBeenCalled();
  });
  it("saves an actor-bound message report without copying its excerpt into notification mail", async () => {
    dbResults.push([{ email: "reporter@example.test", firstName: "Reporter", lastName: "Fixture" }]);
    txResults.push([{ id: 77 }]);
    txExecuteResults.push([], [{ count: 0 }]);
    const response = await request(buildApp()).post("/support/ticket").set(authAs("candidate"))
      .set("X-Jobsage-Message-Report", "1").set("X-Jobsage-Report-User", "candidate-1")
      .send({ ...ticketInput, message: "Private message excerpt fixture.", reportedMessageId: 77 });
    expect(response.status).toBe(201);
    expect(txInsertedValues[0]).toMatchObject({
      userId: "candidate-1", subject: "Message content report", email: "reporter@example.test",
      isContentReport: true, reportedMessageId: 77, appealOfTicketId: null,
      reportedContentType: "inbox_message", reportedContentId: "77",
    });
    expect(sendSupportTicketNotificationMock.mock.calls[0][0].message).not.toContain("Private message excerpt");
  });

  it("does not accept a message report for another account's inbox message", async () => {
    dbResults.push([{ email: "reporter@example.test", firstName: "Reporter", lastName: "Fixture" }]);
    txResults.push([]);
    const response = await request(buildApp()).post("/support/ticket").set(authAs("candidate"))
      .set("X-Jobsage-Message-Report", "1").set("X-Jobsage-Report-User", "candidate-1")
      .send({ ...ticketInput, reportedMessageId: 77 });
    expect(response.status).toBe(404);
    expect(txInsertedValues).toHaveLength(0);
    expect(sendSupportTicketNotificationMock).not.toHaveBeenCalled();
  });

  it("requires a visible application context before accepting a candidate-profile report", async () => {
    const response = await request(buildApp()).post("/support/ticket").set(authAs("employer"))
      .set("X-Jobsage-Report-User", "employer-1")
      .send({
        ...ticketInput,
        reportedContentType: "candidate_profile",
        reportedContentId: "candidate-2",
      });
    expect(response.status).toBe(400);
    expect(dbResults).toHaveLength(0);
    expect(txInsertedValues).toHaveLength(0);
  });

  it("accepts a profile report only when its candidate applied to an employer job visible to the reporter", async () => {
    dbResults.push([{ email: "employer@example.test", firstName: "Employer", lastName: "Staff" }]);
    txResults.push(
      [{ userId: "candidate-2" }],
      [{
        jobId: 17,
        employerProfileId: 23,
        ownerUserId: "employer-owner",
        memberUserId: "employer-1",
        memberRole: "employer_admin",
      }],
    );
    txExecuteResults.push([], [{ count: 0 }]);
    const response = await request(buildApp()).post("/support/ticket").set(authAs("employer"))
      .set("X-Jobsage-Report-User", "employer-1")
      .send({
        ...ticketInput,
        reportedContentType: "candidate_profile",
        reportedContentId: "candidate-2",
        reportedContextId: 91,
      });
    expect(response.status).toBe(201);
    expect(txInsertedValues[0]).toMatchObject({
      userId: "employer-1",
      reportedContentType: "candidate_profile",
      reportedContentId: "candidate-2",
      reportedContextId: 91,
    });
  });

  it("rejects candidate-profile reports when the application is outside the employer relationship", async () => {
    dbResults.push([{ email: "employer@example.test", firstName: "Employer", lastName: "Staff" }]);
    txResults.push([{ userId: "candidate-2" }], []);
    const response = await request(buildApp()).post("/support/ticket").set(authAs("employer"))
      .set("X-Jobsage-Report-User", "employer-1")
      .send({
        ...ticketInput,
        reportedContentType: "candidate_profile",
        reportedContentId: "candidate-2",
        reportedContextId: 91,
      });
    expect(response.status).toBe(404);
    expect(txInsertedValues).toHaveLength(0);
    expect(sendSupportTicketNotificationMock).not.toHaveBeenCalled();
  });

  it("requires an assignment when a recruiter reports a candidate profile", async () => {
    dbResults.push([{ email: "employer@example.test", firstName: "Employer", lastName: "Staff" }]);
    txResults.push(
      [{ userId: "candidate-2" }],
      [{
        jobId: 17,
        employerProfileId: 23,
        ownerUserId: "employer-owner",
        memberUserId: "employer-1",
        memberRole: "recruiter",
      }],
      [],
    );
    const response = await request(buildApp()).post("/support/ticket").set(authAs("employer"))
      .set("X-Jobsage-Report-User", "employer-1")
      .send({
        ...ticketInput,
        reportedContentType: "candidate_profile",
        reportedContentId: "candidate-2",
        reportedContextId: 91,
      });
    expect(response.status).toBe(404);
    expect(txInsertedValues).toHaveLength(0);
  });

  it("accepts a job-listing report only when the published listing matches its context", async () => {
    dbResults.push([{ email: "employer@example.test", firstName: "Employer", lastName: "Staff" }]);
    txResults.push([{
      id: 17,
      employerProfileId: 23,
      ownerUserId: "employer-owner",
      memberUserId: "employer-1",
      memberRole: "employer_admin",
    }]);
    txExecuteResults.push([], [{ count: 0 }]);
    const response = await request(buildApp()).post("/support/ticket").set(authAs("employer"))
      .set("X-Jobsage-Report-User", "employer-1")
      .send({
        ...ticketInput,
        reportedContentType: "job_listing",
        reportedContentId: "17",
        reportedContextId: 17,
      });
    expect(response.status).toBe(201);
    expect(txInsertedValues[0]).toMatchObject({
      reportedContentType: "job_listing",
      reportedContentId: "17",
      reportedContextId: 17,
    });
  });

  it("rejects a job-listing report when the target ID and context ID differ", async () => {
    dbResults.push([{ email: "employer@example.test", firstName: "Employer", lastName: "Staff" }]);
    const response = await request(buildApp()).post("/support/ticket").set(authAs("employer"))
      .set("X-Jobsage-Report-User", "employer-1")
      .send({
        ...ticketInput,
        reportedContentType: "job_listing",
        reportedContentId: "17",
        reportedContextId: 18,
      });
    expect(response.status).toBe(404);
    expect(txResults).toHaveLength(0);
    expect(txInsertedValues).toHaveLength(0);
  });

  it("requires an attachment to be the candidate CV on the exact visible application", async () => {
    dbResults.push([{ email: "employer@example.test", firstName: "Employer", lastName: "Staff" }]);
    txResults.push(
      [{ id: 98, userId: "candidate-2" }],
      [{
        jobId: 17,
        employerProfileId: 23,
        ownerUserId: "employer-owner",
        memberUserId: "employer-1",
        memberRole: "employer_admin",
      }],
    );
    txExecuteResults.push([], [{ count: 0 }]);
    const response = await request(buildApp()).post("/support/ticket").set(authAs("employer"))
      .set("X-Jobsage-Report-User", "employer-1")
      .send({
        ...ticketInput,
        reportedContentType: "attachment",
        reportedContentId: "98",
        reportedContextId: 91,
      });
    expect(response.status).toBe(201);
    expect(txInsertedValues[0]).toMatchObject({
      reportedContentType: "attachment",
      reportedContentId: "98",
      reportedContextId: 91,
    });
  });

  it("requires employer feedback reports to target another staff member's feedback for the same application", async () => {
    dbResults.push([{ email: "employer@example.test", firstName: "Employer", lastName: "Staff" }]);
    txResults.push(
      [{ id: 5, authorUserId: "another-staff", employerProfileId: 23, applicationId: 91 }],
      [{ userId: "candidate-2" }],
      [{
        jobId: 17,
        employerProfileId: 23,
        ownerUserId: "employer-owner",
        memberUserId: "employer-1",
        memberRole: "hiring_manager",
      }],
      [{ id: 301 }],
    );
    txExecuteResults.push([], [{ count: 0 }]);
    const response = await request(buildApp()).post("/support/ticket").set(authAs("employer"))
      .set("X-Jobsage-Report-User", "employer-1")
      .send({
        ...ticketInput,
        reportedContentType: "employer_feedback",
        reportedContentId: "5",
        reportedContextId: 91,
      });
    expect(response.status).toBe(201);
    expect(txInsertedValues[0]).toMatchObject({
      reportedContentType: "employer_feedback",
      reportedContentId: "5",
      reportedContextId: 91,
    });
  });

  it("binds support-request reports to the reporter's own original ticket", async () => {
    dbResults.push([{ email: "reporter@example.test", firstName: "Reporter", lastName: "Fixture" }]);
    txResults.push([{ id: 41 }]);
    txExecuteResults.push([], [{ count: 0 }]);
    const response = await request(buildApp()).post("/support/ticket").set(authAs("candidate"))
      .set("X-Jobsage-Report-User", "candidate-1")
      .send({
        ...ticketInput,
        reportedContentType: "support_request",
        reportedContentId: "JS-ABCDEF1234",
      });
    expect(response.status).toBe(201);
    expect(txInsertedValues[0]).toMatchObject({
      reportedContentType: "support_request",
      reportedContentId: "JS-ABCDEF1234",
      reportedContextId: null,
    });
  });

  it("creates a rate-limited appeal linked to the reporter's own original report", async () => {
    dbResults.push([{ email: "reporter@example.test", firstName: "Reporter", lastName: "Fixture" }]);
    txResults.push([supportTicketRow({ userId: "candidate-1", isContentReport: true, reportedMessageId: 77 })]);
    txExecuteResults.push([], [{ count: 1 }]);

    const response = await request(buildApp()).post("/support/ticket/JS-ABCDEF1234/appeal")
      .set(authAs("candidate")).set("X-Jobsage-Report-User", "candidate-1")
      .send({ message: "Please reconsider the earlier review outcome." });

    expect(response.status).toBe(201);
    expect(txInsertedValues[0]).toMatchObject({
      userId: "candidate-1",
      isContentReport: true,
      reportedMessageId: 77,
      appealOfTicketId: 41,
      message: "The reporter requested another review of their content report.\n\nPlease reconsider the earlier review outcome.",
    });
    expect(sendSupportTicketNotificationMock.mock.calls[0][0].message).not.toContain("earlier review outcome");
  });

  it("does not disclose or appeal another account's content report", async () => {
    dbResults.push([{ email: "reporter@example.test", firstName: "Reporter", lastName: "Fixture" }]);
    txResults.push([supportTicketRow({ userId: "different-account", isContentReport: true })]);
    const response = await request(buildApp()).post("/support/ticket/JS-ABCDEF1234/appeal")
      .set(authAs("candidate")).set("X-Jobsage-Report-User", "candidate-1")
      .send({ message: "Please reconsider the earlier review outcome." });
    expect(response.status).toBe(404);
    expect(txInsertedValues).toHaveLength(0);
    expect(sendSupportTicketNotificationMock).not.toHaveBeenCalled();
  });

  it("limits appeals with the same per-account daily report quota", async () => {
    dbResults.push([{ email: "reporter@example.test", firstName: "Reporter", lastName: "Fixture" }]);
    txResults.push([supportTicketRow({ userId: "candidate-1", isContentReport: true })]);
    txExecuteResults.push([], [{ count: 8 }]);
    const response = await request(buildApp()).post("/support/ticket/JS-ABCDEF1234/appeal")
      .set(authAs("candidate")).set("X-Jobsage-Report-User", "candidate-1")
      .send({ message: "Please reconsider the earlier review outcome." });
    expect(response.status).toBe(429);
    expect(txInsertedValues).toHaveLength(0);
    expect(sendSupportTicketNotificationMock).not.toHaveBeenCalled();
  });

  it("does not allow an appeal ticket to be appealed again", async () => {
    dbResults.push([{ email: "reporter@example.test", firstName: "Reporter", lastName: "Fixture" }]);
    txResults.push([supportTicketRow({ userId: "candidate-1", isContentReport: true, appealOfTicketId: 40 })]);
    const response = await request(buildApp()).post("/support/ticket/JS-ABCDEF1234/appeal")
      .set(authAs("candidate")).set("X-Jobsage-Report-User", "candidate-1")
      .send({ message: "Please reconsider the earlier review outcome." });
    expect(response.status).toBe(404);
    expect(txInsertedValues).toHaveLength(0);
    expect(txExecuteResults).toHaveLength(0);
  });

  it("does not accept anonymous tagged AI reports", async () => {
    const response = await request(buildApp()).post("/support/ticket")
      .set("X-Jobsage-AI-Report", "1").set("X-Jobsage-Report-User", "candidate-1").send(ticketInput);
    expect(response.status).toBe(403);
    expect(txInsertedValues).toHaveLength(0);
  });

  it("does not save an AI report for a deleted account", async () => {
    dbResults.push([]);
    const response = await request(buildApp()).post("/support/ticket").set(authAs("candidate"))
      .set("X-Jobsage-AI-Report", "1").set("X-Jobsage-Report-User", "candidate-1").send(ticketInput);
    expect(response.status).toBe(403);
    expect(txInsertedValues).toHaveLength(0);
  });

  it("enforces the daily report limit before storing evidence", async () => {
    dbResults.push([{ email: "reporter@example.test", firstName: "Reporter", lastName: "Fixture" }]);
    txExecuteResults.push([], [{ count: 8 }]);
    const response = await request(buildApp()).post("/support/ticket").set(authAs("candidate"))
      .set("X-Jobsage-AI-Report", "1").set("X-Jobsage-Report-User", "candidate-1")
      .send({ ...ticketInput, message: "Private answer excerpt fixture." });
    expect(response.status).toBe(429);
    expect(txInsertedValues).toHaveLength(0);
    expect(sendSupportTicketNotificationMock).not.toHaveBeenCalled();
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

    dbResults.push([supportTicketRow()]);
    dbResults.push([
      supportTicketRow({
        status: "in_review",
        severity: "urgent",
        assignedModeratorId: "super_admin-1",
        adminNotes: "Sent a replacement link.",
        reviewedBy: "super_admin-1",
        reviewedAt: new Date("2026-10-01T11:00:00.000Z"),
      }),
    ]);
    const updated = await request(buildApp())
      .patch("/admin/super/support-tickets/41")
      .set(authAs("super_admin"))
      .send({ status: "in_review", adminNotes: "Sent a replacement link.", severity: "urgent", assignment: "me", escalate: true });

    expect(updated.status).toBe(200);
    expect(updated.body.status).toBe("in_review");
    expect(updatedValues[0]).toMatchObject({
      status: "in_review",
      severity: "urgent",
      assignedModeratorId: "super_admin-1",
      escalatedAt: expect.any(Date),
      adminNotes: "Sent a replacement link.",
      reviewedBy: "super_admin-1",
    });
  });

  it("prevents moderators from unassigning a ticket owned by another moderator", async () => {
    dbResults.push([supportTicketRow({ assignedModeratorId: "admin-2" })]);
    const response = await request(buildApp())
      .patch("/admin/super/support-tickets/41")
      .set(authAs("admin"))
      .send({ assignment: "unassigned" });
    expect(response.status).toBe(403);
    expect(updatedValues).toHaveLength(0);
  });

  it("requires a delivered admin reply before resolving a content report", async () => {
    dbResults.push([supportTicketRow({ isContentReport: true, status: "in_review" })]);
    const response = await request(buildApp())
      .patch("/admin/super/support-tickets/41")
      .set(authAs("admin"))
      .send({ status: "resolved" });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Send a reply");
    expect(updatedValues).toHaveLength(0);
  });

  it("prevents moderators from taking over another moderator's ticket", async () => {
    dbResults.push([supportTicketRow({ assignedModeratorId: "admin-2" })]);
    const response = await request(buildApp())
      .patch("/admin/super/support-tickets/41")
      .set(authAs("admin"))
      .send({ assignment: "me" });
    expect(response.status).toBe(403);
    expect(updatedValues).toHaveLength(0);
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
    const event = {
      id: 21,
      actor: "admin-1",
      action: "admin_update_support_ticket",
      details: { status: "in_review", severity: "high", assignedModeratorId: "admin-1" },
      createdAt: new Date("2026-10-01T11:30:00.000Z"),
    };
    dbResults.push([supportTicketRow()], [reply], [event]);

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
    expect(response.body.history[0]).toMatchObject({
      action: "admin_update_support_ticket",
      actor: "admin-1",
      details: { status: "in_review", severity: "high" },
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
