import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createHmac } from "crypto";

const mockReceivingProvider = vi.hoisted(() => {
  class MockResendReceivingError extends Error {
    constructor(
      readonly stage: string,
      readonly statusCode?: number,
    ) {
      super(stage);
    }
  }
  return {
    getReceivedEmail: vi.fn(),
    forwardReceivedEmail: vi.fn(),
    ResendReceivingError: MockResendReceivingError,
  };
});

vi.mock("../../lib/resendReceiving", () => mockReceivingProvider);
const blockedSenderMock = vi.hoisted(() => vi.fn().mockResolvedValue(false));
vi.mock("../../lib/messageSenderBlocks", () => ({ isMessageSenderBlocked: blockedSenderMock }));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Capture inserted messages for assertion
const insertedMessages: any[] = [];
const updatedStatuses: Array<{ id: number; status: string }> = [];

const mockDb = {
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
};

function makeSelectChain(rows: unknown[]) {
  const chain: any = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
    // Make the chain itself thenable so `await db.select().from().where()` works
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject),
    catch: (reject: (e: unknown) => void) => Promise.resolve(rows).catch(reject),
  };
  return chain;
}

function makeInsertChain(id: number) {
  const chain: any = {
    values: (v: unknown) => {
      insertedMessages.push(v);
      return chain;
    },
    returning: () => Promise.resolve([{ id }]),
  };
  return chain;
}

function makeUpdateChain() {
  const chain: any = {
    set: (v: { status: string }) => {
      chain._status = v.status;
      return chain;
    },
    where: (cond: unknown) => {
      updatedStatuses.push({ id: 1, status: chain._status });
      return chain;
    },
  };
  return chain;
}

vi.mock("@workspace/db", () => ({
  db: mockDb,
  candidateMessagesTable: {
    id: "id",
    externalMessageId: "external_message_id",
    recipientUserId: "recipient_user_id",
  },
  speculativeApplicationsTable: {
    userId: "user_id",
    status: "status",
    id: "id",
    emailRecipient: "email_recipient",
    companyName: "company_name",
  },
  usersTable: {
    id: "id",
    email: "email",
    firstName: "first_name",
    jobsageEmail: "jobsage_email",
  },
  profilesTable: {
    userId: "user_id",
    jobsageEmail: "jobsage_email",
  },
}));

vi.mock("../../lib/email", () => ({
  sendEmployerReplyNotification: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../lib/privacyAccess", () => ({
  isPrivacyNotificationAllowed: async () => true,
}));

// ---------------------------------------------------------------------------
// Svix helpers
// ---------------------------------------------------------------------------

const TEST_SECRET = "whsec_" + Buffer.from("test-secret-32-bytes-minimum-pad").toString("base64");

/**
 * Build a valid Svix signature for a given payload body.
 * Follows the Svix signing spec: HMAC-SHA256 over `msgId.timestamp.body`.
 */
function buildSvixHeaders(body: string): Record<string, string> {
  const msgId = "msg_test123";
  const timestamp = Math.floor(Date.now() / 1000).toString();
  // Svix signs: "msgId + '.' + timestamp + '.' + body"
  const toSign = `${msgId}.${timestamp}.${body}`;
  // The secret is base64-encoded after the "whsec_" prefix
  const secretBytes = Buffer.from(TEST_SECRET.slice("whsec_".length), "base64");
  const sig = createHmac("sha256", secretBytes).update(toSign).digest("base64");
  return {
    "svix-id": msgId,
    "svix-timestamp": timestamp,
    "svix-signature": `v1,${sig}`,
  };
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

async function buildApp() {
  const router = (await import("../../routes/inboundEmail")).default;
  const app = express();
  // Capture raw body (mirrors app.ts)
  app.use(
    express.json({
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );
  app.use(router);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /webhooks/inbound-email", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    blockedSenderMock.mockResolvedValue(false);
    insertedMessages.length = 0;
    updatedStatuses.length = 0;
    process.env.INBOUND_EMAIL_WEBHOOK_SECRET = TEST_SECRET;
    process.env.NODE_ENV = "test";
    delete process.env.INBOUND_EMAIL_FORWARD_TO;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  it("rejects requests with a bad Svix signature", async () => {
    const app = await buildApp();
    const body = JSON.stringify({ type: "email.inbound_received", data: {} });

    const res = await request(app)
      .post("/webhooks/inbound-email")
      .set("Content-Type", "application/json")
      .set("svix-id", "msg_fake")
      .set("svix-timestamp", "1000000")
      .set("svix-signature", "v1,invalidsig")
      .send(body);

    expect(res.status).toBe(401);
  });

  it("accepts requests with no secret set in development/test mode", async () => {
    delete process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
    // No alias → will skip early, still 200
    mockDb.select.mockReturnValue(makeSelectChain([])); // no user found
    const app = await buildApp();

    const body = JSON.stringify({
      type: "email.inbound_received",
      data: {
        from: "employer@company.com",
        to: ["john.smith.abc@mail.jobsage.co.uk"],
        subject: "Re: your application",
        text: "Thank you",
      },
    });

    const res = await request(app)
      .post("/webhooks/inbound-email")
      .set("Content-Type", "application/json")
      .send(body);

    // Either 200 (skipped) or 200 (processed) — must not be 401
    expect(res.status).not.toBe(401);
  });

  it("returns 401 when secret is missing in production", async () => {
    delete process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
    process.env.NODE_ENV = "production";
    const app = await buildApp();

    const body = JSON.stringify({ type: "email.inbound_received", data: {} });
    const res = await request(app)
      .post("/webhooks/inbound-email")
      .set("Content-Type", "application/json")
      .send(body);

    expect(res.status).toBe(401);
    process.env.NODE_ENV = "test";
  });

  // -------------------------------------------------------------------------
  // Deduplication
  // -------------------------------------------------------------------------

  it("returns 200 skipped for a duplicate messageId", async () => {
    const app = await buildApp();

    // Simulate existing message with same externalMessageId
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([{ id: "user-1", email: "cand@test.com", firstName: "Jane" }])) // user lookup by alias
      .mockReturnValueOnce(makeSelectChain([{ id: 42 }])); // dedup lookup finds existing

    const payload = {
      type: "email.inbound_received",
      data: {
        from: "HR <hr@company.com>",
        to: ["jane.smith.aaa@mail.jobsage.co.uk"],
        subject: "Re: [Speculative CV]",
        text: "Thanks for applying!",
        messageId: "<duplicate-msg-id@company.com>",
      },
    };
    const body = JSON.stringify(payload);
    const headers = buildSvixHeaders(body);

    const res = await request(app)
      .post("/webhooks/inbound-email")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe("duplicate");
    expect(insertedMessages).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it("inserts an inbox message and returns 200 for a valid reply", async () => {
    const app = await buildApp();

    // 1. user lookup by alias → found
    // 2. dedup check → not found (no existing message)
    // 3. open speculative apps lookup → empty (no match)
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([{ id: "user-1", email: "cand@test.com", firstName: "Jane" }]))
      .mockReturnValueOnce(makeSelectChain([]))  // dedup: no existing
      .mockReturnValueOnce(makeSelectChain([])); // no open apps

    mockDb.insert.mockReturnValue(makeInsertChain(99));

    const payload = {
      type: "email.inbound_received",
      data: {
        from: "Sarah Recruiter <sarah@acme.com>",
        to: ["jane.smith.abc@mail.jobsage.co.uk"],
        subject: "Your application at Acme",
        text: "Thank you for your application. We will be in touch.",
        messageId: "<new-msg-id@acme.com>",
      },
    };
    const body = JSON.stringify(payload);
    const headers = buildSvixHeaders(body);

    const res = await request(app)
      .post("/webhooks/inbound-email")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.messageId).toBe(99);
    expect(res.body.category).toBe("acknowledged");
    expect(insertedMessages).toHaveLength(1);
    expect(insertedMessages[0]).toMatchObject({
      recipientUserId: "user-1",
      messageType: "employer_reply",
      senderEmail: "sarah@acme.com",
      companyName: "Sarah Recruiter",
      externalMessageId: "<new-msg-id@acme.com>",
    });
  });
  it("acknowledges a blocked address without saving, advancing the tracker, or notifying the candidate", async () => {
    const app = await buildApp();
    blockedSenderMock.mockResolvedValue(true);
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([{ id: "user-1", email: "candidate@example.test", firstName: "Fixture" }]))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([]));
    const body = JSON.stringify({ type: "email.inbound_received", data: {
      from: "Blocked fixture <blocked@example.test>", to: ["jane.smith.abc@mail.jobsage.co.uk"],
      subject: "Fixture reply", text: "Fixture body", messageId: "<blocked-fixture@example.test>",
    } });
    const response = await request(app).post("/webhooks/inbound-email")
      .set("Content-Type", "application/json").set(buildSvixHeaders(body)).send(body);
    expect(response.status).toBe(200);
    expect(response.body.ignored).toBe("sender_blocked");
    expect(insertedMessages).toHaveLength(0);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it("classifies an interview reply and updates application status", async () => {
    const app = await buildApp();

    mockDb.select
      .mockReturnValueOnce(makeSelectChain([{ id: "user-1", email: "cand@test.com", firstName: "Jane" }])) // user
      .mockReturnValueOnce(makeSelectChain([]))  // dedup: no existing
      .mockReturnValueOnce(makeSelectChain([     // open apps
        { id: 7, userId: "user-1", companyName: "Acme Corp", status: "cv_sent", emailRecipient: "hr@acme.com" }
      ]))
      .mockReturnValueOnce(makeSelectChain([{ status: "cv_sent" }])); // current app status

    mockDb.insert.mockReturnValue(makeInsertChain(101));
    mockDb.update.mockReturnValue(makeUpdateChain());

    const payload = {
      type: "email.inbound_received",
      data: {
        from: "HR Team <hr@acme.com>",
        to: ["jane.smith.abc@mail.jobsage.co.uk"],
        subject: "Interview invitation",
        text: "We would like to invite you for an interview next week.",
        messageId: "<interview-msg@acme.com>",
      },
    };
    const body = JSON.stringify(payload);
    const headers = buildSvixHeaders(body);

    const res = await request(app)
      .post("/webhooks/inbound-email")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.category).toBe("interview_invited");
    expect(res.body.matchedApplicationId).toBe(7);
  });

  it("skips emails addressed to unknown aliases", async () => {
    const app = await buildApp();

    // user lookup finds nothing
    mockDb.select.mockReturnValue(makeSelectChain([]));

    const payload = {
      type: "email.inbound_received",
      data: {
        from: "someone@company.com",
        to: ["unknown.alias.xyz@mail.jobsage.co.uk"],
        subject: "Hello",
        text: "Hi there",
      },
    };
    const body = JSON.stringify(payload);
    const headers = buildSvixHeaders(body);

    const res = await request(app)
      .post("/webhooks/inbound-email")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe("alias not matched to any candidate");
    expect(insertedMessages).toHaveLength(0);
  });

  it("ignores no-reply / automated senders", async () => {
    const app = await buildApp();

    const payload = {
      type: "email.inbound_received",
      data: {
        from: "noreply@company.com",
        to: ["jane.smith.abc@mail.jobsage.co.uk"],
        subject: "Auto-reply",
        text: "This is an automated response.",
      },
    };
    const body = JSON.stringify(payload);
    const headers = buildSvixHeaders(body);

    const res = await request(app)
      .post("/webhooks/inbound-email")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe("automated sender");
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it("forwards modern developer-mail events before filtering automated senders", async () => {
    process.env.INBOUND_EMAIL_FORWARD_TO = "jobsage.inbox@gmail.com";
    mockReceivingProvider.forwardReceivedEmail.mockResolvedValue("forwarded-email-1");
    const app = await buildApp();
    const payload = {
      type: "email.received",
      data: {
        email_id: "received-email-1",
        from: "no-reply@google.com",
        to: ["developer@jobsage.co.uk"],
        received_for: ["developer@jobsage.co.uk"],
        subject: "Developer account verification",
      },
    };
    const body = JSON.stringify(payload);
    const headers = buildSvixHeaders(body);

    const res = await request(app)
      .post("/webhooks/inbound-email")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, forwarded: true });
    expect(mockReceivingProvider.forwardReceivedEmail).toHaveBeenCalledWith(
      "received-email-1",
      "jobsage.inbox@gmail.com",
    );
    expect(mockDb.select).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain("Developer account verification");
  });

  it("fails visibly when developer forwarding is not configured", async () => {
    const app = await buildApp();
    const payload = {
      type: "email.received",
      data: {
        email_id: "received-email-unconfigured",
        from: "no-reply@apple.com",
        to: ["developer@jobsage.co.uk"],
        subject: "Apple Developer verification",
      },
    };
    const body = JSON.stringify(payload);
    const headers = buildSvixHeaders(body);

    const res = await request(app)
      .post("/webhooks/inbound-email")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(body);

    expect(res.status).toBe(503);
    expect(mockReceivingProvider.forwardReceivedEmail).not.toHaveBeenCalled();
  });

  it("returns a retryable error without logging private message details", async () => {
    process.env.INBOUND_EMAIL_FORWARD_TO = "jobsage.inbox@gmail.com";
    mockReceivingProvider.forwardReceivedEmail.mockRejectedValue(
      new Error("private message body must not be logged"),
    );
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = await buildApp();
    const payload = {
      type: "email.received",
      data: {
        email_id: "received-private-email",
        from: "Private Sender <private.sender@example.com>",
        to: ["developer@jobsage.co.uk"],
        subject: "Private verification content",
      },
    };
    const body = JSON.stringify(payload);
    const headers = buildSvixHeaders(body);

    const res = await request(app)
      .post("/webhooks/inbound-email")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(body);

    expect(res.status).toBe(503);
    const loggedText = JSON.stringify(errorLog.mock.calls);
    expect(loggedText).toContain("received-private-email");
    expect(loggedText).not.toContain("private message body");
    expect(loggedText).not.toContain("private.sender@example.com");
    expect(loggedText).not.toContain("Private verification content");
    expect(loggedText).not.toContain("jobsage.inbox@gmail.com");
  });

  it("reports a failed developer forward even when a candidate alias is also processed", async () => {
    process.env.INBOUND_EMAIL_FORWARD_TO = "jobsage.inbox@gmail.com";
    mockReceivingProvider.forwardReceivedEmail.mockRejectedValue(new Error("provider unavailable"));
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([{ id: "user-1", email: "cand@test.com", firstName: "Jane" }]))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([]));
    mockDb.insert.mockReturnValue(makeInsertChain(201));
    const app = await buildApp();
    const payload = {
      type: "email.received",
      data: {
        email_id: "received-combined-email",
        from: "Recruiter <recruiter@company.com>",
        to: ["developer@jobsage.co.uk", "jane.smith.abc@mail.jobsage.co.uk"],
        subject: "Thanks for your application",
        text: "We will be in touch soon.",
        message_id: "<combined-message@company.com>",
      },
    };
    const body = JSON.stringify(payload);
    const headers = buildSvixHeaders(body);

    const res = await request(app)
      .post("/webhooks/inbound-email")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(body);

    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("Developer mailbox forwarding unavailable");
    expect(insertedMessages).toHaveLength(1);
  });

  it("loads full Resend content for a metadata-only candidate reply", async () => {
    const app = await buildApp();
    mockReceivingProvider.getReceivedEmail.mockResolvedValue({
      id: "received-candidate-email",
      from: "Sarah Recruiter <sarah@acme.com>",
      to: ["jane.smith.abc@mail.jobsage.co.uk"],
      subject: "Interview invitation",
      text: "We would like to invite you for an interview next week.",
      html: null,
      headers: { "message-id": "<modern-interview@acme.com>" },
      message_id: "<modern-interview@acme.com>",
      created_at: "2026-10-09T09:00:00.000Z",
      cc: null,
      bcc: null,
      reply_to: null,
      raw: null,
      attachments: [],
      object: "email",
    });
    mockDb.select
      .mockReturnValueOnce(makeSelectChain([{ id: "user-1", email: "cand@test.com", firstName: "Jane" }]))
      .mockReturnValueOnce(makeSelectChain([]))
      .mockReturnValueOnce(makeSelectChain([]));
    mockDb.insert.mockReturnValue(makeInsertChain(199));

    const payload = {
      type: "email.received",
      data: {
        email_id: "received-candidate-email",
        from: "Sarah Recruiter <sarah@acme.com>",
        to: ["jane.smith.abc@mail.jobsage.co.uk"],
        subject: "Interview invitation",
        message_id: "<modern-interview@acme.com>",
      },
    };
    const body = JSON.stringify(payload);
    const headers = buildSvixHeaders(body);
    const res = await request(app)
      .post("/webhooks/inbound-email")
      .set("Content-Type", "application/json")
      .set(headers)
      .send(body);

    expect(res.status).toBe(200);
    expect(mockReceivingProvider.getReceivedEmail).toHaveBeenCalledWith("received-candidate-email");
    expect(insertedMessages[0]?.messageText).toContain("invite you for an interview");
    expect(res.body.category).toBe("interview_invited");
  });
});
