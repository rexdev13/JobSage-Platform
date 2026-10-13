import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { requireRole, type AppRole } from "../../middlewares/requireRole";

const fixture = vi.hoisted(() => ({
  selectRows: [] as Record<string, unknown>[][],
  selectCalls: 0,
  updateValues: [] as Record<string, unknown>[],
  updateResults: [] as Record<string, unknown>[][],
  insertedValues: [] as Record<string, unknown>[],
  sendSupportTicketReply: vi.fn(),
}));

vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema");
  function selectChain() {
    const chain: any = {
      from() { return chain; },
      innerJoin() { return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return chain; },
      for() { return chain; },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        fixture.selectCalls++;
        return Promise.resolve(fixture.selectRows.shift() ?? []).then(resolve, reject);
      },
    };
    return chain;
  }
  const database: any = {
    select: selectChain,
    execute: async () => ({ rows: [{ count: 1 }] }),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        fixture.insertedValues.push(values);
        return Promise.resolve(undefined);
      },
    }),
    update: () => {
      const chain: any = {
        set(values: Record<string, unknown>) {
          fixture.updateValues.push(values);
          return chain;
        },
        where() { return chain; },
        returning: async () => fixture.updateResults.shift() ?? [],
      };
      return chain;
    },
    transaction: async (callback: (tx: any) => unknown) => callback(database),
  };
  return {
    ...schema,
    db: database,
  };
});

vi.mock("../../lib/email", () => ({
  sendSupportTicketReply: fixture.sendSupportTicketReply,
}));

import moderationRouter from "../../routes/moderation";

beforeEach(() => {
  fixture.selectRows = [];
  fixture.selectCalls = 0;
  fixture.updateValues = [];
  fixture.updateResults = [];
  fixture.insertedValues = [];
  fixture.sendSupportTicketReply.mockReset().mockResolvedValue({ success: true });
});

function roleTestApp(role: AppRole | null, impersonating = false) {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).isAuthenticated = () => role !== null;
    (req as any).isImpersonating = impersonating;
    if (role) (req as any).user = { id: "fixture-user", role };
    next();
  });
  app.get("/moderation/reports", requireRole("moderator"), (_req, res) => res.json({ allowed: true }));
  return app;
}

function moderationApp(role: AppRole | null, impersonating = false) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).isAuthenticated = () => role !== null;
    (req as any).isImpersonating = impersonating;
    if (role) (req as any).user = { id: "fixture-moderator", role };
    (req as any).log = { error: () => undefined };
    next();
  });
  app.use(moderationRouter);
  return app;
}

describe("moderator role boundary", () => {
  it("allows a moderator through moderator-only routes", async () => {
    const response = await request(roleTestApp("moderator")).get("/moderation/reports");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ allowed: true });
  });

  it.each(["candidate", "employer", "reviewer", "admin", "super_admin", "marketing"] as const)(
    "denies %s on moderator-only routes", async role => {
      const response = await request(roleTestApp(role)).get("/moderation/reports");
      expect(response.status).toBe(403);
    },
  );

  it("requires authentication", async () => {
    const response = await request(roleTestApp(null)).get("/moderation/reports");
    expect(response.status).toBe(401);
  });

  it("keeps non-moderators out of the real moderation queue before querying data", async () => {
    fixture.selectCalls = 0;
    const response = await request(moderationApp("candidate")).get("/moderation/reports");
    expect(response.status).toBe(403);
    expect(fixture.selectCalls).toBe(0);
  });

  it("blocks moderator access during impersonation", async () => {
    fixture.selectCalls = 0;
    const response = await request(moderationApp("moderator", true)).get("/moderation/reports");
    expect(response.status).toBe(403);
    expect(fixture.selectCalls).toBe(0);
  });

  it("projects queue rows without contact details or report text", async () => {
    fixture.selectRows = [[{
      id: 4, ticketId: "JS-CASE00004", category: "Other", status: "new",
      severity: "high", assignedModeratorId: null, createdAt: "2026-10-13T00:00:00.000Z",
      name: "Fixture Reporter", email: "private@example.invalid", userId: "private-user",
      message: "private report body",
    }]];
    const response = await request(moderationApp("moderator")).get("/moderation/reports");
    expect(response.status).toBe(200);
    expect(response.body).toEqual([{
      id: 4, ticketId: "JS-CASE00004", category: "Other", status: "new",
      severity: "high", assignedToMe: false, createdAt: "2026-10-13T00:00:00.000Z",
    }]);
  });

  it("shows source-specific profile evidence only to the assigned moderator", async () => {
    fixture.selectRows = [
      [{
        id: 4,
        ticketId: "JS-CASE00004",
        category: "Other",
        subject: "Candidate profile report",
        message: "Please review this profile.",
        reportedMessageId: null,
        reportedContentType: "candidate_profile",
        reportedContentId: "candidate-fixture",
        reportedContextId: 91,
        reporterUserId: "employer-fixture",
        appealOfTicketId: null,
        status: "in_review",
        severity: "normal",
        moderationDecision: "pending",
        adminNotes: null,
        escalatedAt: null,
        createdAt: "2026-10-13T00:00:00.000Z",
        updatedAt: "2026-10-13T00:00:00.000Z",
        assignedModeratorId: "fixture-moderator",
        email: "must-not-appear@example.invalid",
      }],
      [{ jobTitle: "Fixture Nursing Role" }],
      [{
        profession: "nurse",
        specialty: "adult",
        registrationStatus: "registered",
        qualificationCountry: "Ghana",
        experienceYears: 7,
        requiresSponsorship: true,
        phone: "private-phone-fixture",
      }],
    ];
    const response = await request(moderationApp("moderator")).get("/moderation/reports/4");
    expect(response.status).toBe(200);
    expect(response.body.sourceEvidence).toEqual({
      label: "Candidate profile",
      fields: expect.arrayContaining([
        { label: "Profession", value: "nurse" },
        { label: "Application context", value: "Fixture Nursing Role" },
      ]),
    });
    expect(JSON.stringify(response.body)).not.toContain("must-not-appear@example.invalid");
    expect(JSON.stringify(response.body)).not.toContain("private-phone-fixture");
    expect(response.body).not.toHaveProperty("reporterUserId");
  });

  it("does not open unassigned report details", async () => {
    fixture.selectRows = [[]];
    const response = await request(moderationApp("moderator")).get("/moderation/reports/4");
    expect(response.status).toBe(404);
    expect(fixture.selectCalls).toBe(1);
  });

  it("does not resolve a report without an explicit no-action decision", async () => {
    fixture.selectCalls = 0;
    const response = await request(moderationApp("moderator"))
      .patch("/moderation/reports/4")
      .send({ status: "resolved" });
    expect(response.status).toBe(400);
    expect(fixture.selectCalls).toBe(0);
  });

  it("emails a generic outcome when a moderator decides to take no action", async () => {
    fixture.selectRows = [[{
      id: 4,
      ticketId: "JS-CASE00004",
      email: "reporter@example.invalid",
      status: "in_review",
      severity: "normal",
      moderationDecision: "pending",
      escalatedAt: null,
      adminNotes: null,
      message: "private source excerpt",
    }]];
    fixture.updateResults = [[{
      ticketId: "JS-CASE00004",
      status: "resolved",
      severity: "normal",
      moderationDecision: "no_action",
    }]];
    const response = await request(moderationApp("moderator"))
      .patch("/moderation/reports/4")
      .send({ decision: "no_action", internalNote: "Reviewed the submitted context." });

    expect(response.status).toBe(200);
    expect(fixture.sendSupportTicketReply).toHaveBeenCalledWith({
      to: "reporter@example.invalid",
      ticketId: "JS-CASE00004",
      subject: "JOBSAGE report update",
      replyText: expect.stringContaining("will not take further action"),
    });
    expect(fixture.sendSupportTicketReply.mock.calls[0][0].replyText).not.toContain("private source excerpt");
    expect(fixture.insertedValues[0]).toMatchObject({
      ticketId: 4,
      adminUserId: "fixture-moderator",
      adminDisplayName: "JOBSAGE Moderation",
      deliveryChannel: "email",
      deliveryStatus: "sent",
      candidateMessageId: null,
    });
    expect(fixture.updateValues[0]).toMatchObject({ moderationDecision: "no_action", status: "resolved" });
  });

  it("notifies the reporter when a report is escalated", async () => {
    fixture.selectRows = [[{
      id: 4,
      ticketId: "JS-CASE00004",
      email: "reporter@example.invalid",
      status: "in_review",
      severity: "normal",
      moderationDecision: "pending",
      escalatedAt: null,
      adminNotes: null,
    }]];
    fixture.updateResults = [[{
      ticketId: "JS-CASE00004",
      status: "attended",
      severity: "urgent",
      moderationDecision: "escalated",
    }]];
    const response = await request(moderationApp("moderator"))
      .patch("/moderation/reports/4")
      .send({ decision: "escalate" });

    expect(response.status).toBe(200);
    expect(fixture.sendSupportTicketReply.mock.calls[0][0].replyText)
      .toContain("escalated for additional review");
    expect(fixture.insertedValues[0]).toMatchObject({
      deliveryChannel: "email",
      deliveryStatus: "sent",
    });
    expect(fixture.updateValues[0]).toMatchObject({
      moderationDecision: "escalated",
      status: "attended",
      severity: "urgent",
    });
  });

  it("does not save a moderation decision if its reporter email cannot be delivered", async () => {
    fixture.sendSupportTicketReply.mockResolvedValue({ success: false, error: "Provider unavailable" });
    fixture.selectRows = [[{
      id: 4,
      ticketId: "JS-CASE00004",
      email: "reporter@example.invalid",
      status: "in_review",
      severity: "normal",
      moderationDecision: "pending",
      escalatedAt: null,
      adminNotes: null,
    }]];
    const response = await request(moderationApp("moderator"))
      .patch("/moderation/reports/4")
      .send({ decision: "no_action", internalNote: "Reviewed the submitted context." });

    expect(response.status).toBe(502);
    expect(response.body.error).toContain("decision was not saved");
    expect(fixture.insertedValues[0]).toMatchObject({ deliveryStatus: "failed" });
    expect(fixture.updateValues).toHaveLength(0);
  });

  it("does not send duplicate email when the same final decision is retried", async () => {
    fixture.selectRows = [[{
      id: 4,
      ticketId: "JS-CASE00004",
      email: "reporter@example.invalid",
      status: "resolved",
      severity: "normal",
      moderationDecision: "no_action",
      escalatedAt: null,
      adminNotes: null,
    }]];
    fixture.updateResults = [[{
      ticketId: "JS-CASE00004",
      status: "resolved",
      severity: "normal",
      moderationDecision: "no_action",
    }]];
    const response = await request(moderationApp("moderator"))
      .patch("/moderation/reports/4")
      .send({ decision: "no_action", internalNote: "Reviewed the submitted context again." });

    expect(response.status).toBe(200);
    expect(fixture.sendSupportTicketReply).not.toHaveBeenCalled();
    expect(fixture.insertedValues.filter(value => "deliveryChannel" in value)).toHaveLength(0);
  });
});
