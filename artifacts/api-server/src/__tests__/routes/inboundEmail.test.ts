import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createHmac } from "crypto";

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
    insertedMessages.length = 0;
    updatedStatuses.length = 0;
    process.env.INBOUND_EMAIL_WEBHOOK_SECRET = TEST_SECRET;
    process.env.NODE_ENV = "test";
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
});
