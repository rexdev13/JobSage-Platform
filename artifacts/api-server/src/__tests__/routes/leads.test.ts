import { beforeEach, describe, expect, it, vi } from "vitest";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";

const {
  queryResults,
  setCalls,
  valueCalls,
  sendWaitlistWelcomeEmailMock,
  openAiCreateMock,
} = vi.hoisted(() => ({
  queryResults: [] as unknown[],
  setCalls: [] as unknown[],
  valueCalls: [] as unknown[],
  sendWaitlistWelcomeEmailMock: vi.fn(),
  openAiCreateMock: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      groupBy: () => chain,
      limit: () => chain,
      offset: () => chain,
      for: () => chain,
      set: (values: unknown) => {
        setCalls.push(values);
        return chain;
      },
      values: (values: unknown) => {
        valueCalls.push(values);
        return chain;
      },
      returning: () => Promise.resolve(queryResults.shift() ?? []),
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(queryResults.shift() ?? []).then(resolve, reject),
    };
    return chain;
  }

  return {
    db: {
      select: () => makeChain(),
      update: () => makeChain(),
      delete: () => makeChain(),
      insert: () => makeChain(),
      transaction: async (callback: (tx: any) => Promise<unknown>) => callback({
        select: () => makeChain(),
        update: () => makeChain(),
      }),
    },
    socialLeadsTable: {
      id: "id",
      firstName: "first_name",
      lastName: "last_name",
      email: "email",
      phone: "phone",
      industrySector: "industry_sector",
      source: "source",
      status: "status",
      createdAt: "created_at",
      desiredRole: "desired_role",
      additionalMessage: "additional_message",
      marketingUserId: "marketing_user_id",
      claimedAt: "claimed_at",
      contactedAt: "contacted_at",
      waitlistConfirmationSentAt: "waitlist_confirmation_sent_at",
      waitlistConfirmationProviderId: "waitlist_confirmation_provider_id",
      waitlistConfirmationLastError: "waitlist_confirmation_last_error",
    },
    usersTable: {
      id: "id",
      email: "email",
      firstName: "first_name",
      lastName: "last_name",
      role: "role",
      calendlyUrl: "calendly_url",
    },
    sponsorLicencesTable: { industry: "industry" },
  };
});

const mockGetSession = vi.fn();
vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return { ...actual, getSession: mockGetSession };
});

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { chat: { completions: { create: openAiCreateMock } } },
}));

vi.mock("../../lib/email", () => ({
  sendWaitlistWelcomeEmail: sendWaitlistWelcomeEmailMock,
}));

const {
  default: leadsRouter,
  isMarketingLeadVisible,
  resolveMarketingLeadScope,
} = await import("../../routes/leads");
const { authMiddleware } = await import("../../middlewares/authMiddleware");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(leadsRouter);
  return app;
}

const marketingSession = {
  user: {
    id: "marketing-1",
    email: "marketing@test.com",
    role: "marketing",
    firstName: "Mara",
    lastName: "K",
    profileImageUrl: null,
  },
};
const adminSession = {
  user: {
    id: "admin-1",
    email: "admin@test.com",
    role: "admin",
    firstName: "Ari",
    lastName: "Admin",
    profileImageUrl: null,
  },
};
const candidateSession = {
  user: {
    id: "candidate-1",
    email: "candidate@test.com",
    role: "candidate",
    firstName: "Cam",
    lastName: "Candidate",
    profileImageUrl: null,
  },
};

const validLeadSubmission = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "Ada@Example.com",
  phone: "+44 7700 900123",
  industrySector: "Technology",
  desiredRole: "Software Engineer",
  gdprConsent: true,
};

describe("waitlist lead submission", () => {
  beforeEach(() => {
    queryResults.length = 0;
    setCalls.length = 0;
    valueCalls.length = 0;
    mockGetSession.mockResolvedValue(null);
    sendWaitlistWelcomeEmailMock.mockReset().mockResolvedValue({
      success: true,
      messageId: "email-123",
    });
    openAiCreateMock.mockReset();
  });

  it("returns 201, sends the welcome email, and records provider attribution", async () => {
    queryResults.push([], [{ id: 42 }], []);

    const response = await request(buildApp())
      .post("/leads/submit")
      .send(validLeadSubmission);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ success: true });
    await vi.waitFor(() => {
      expect(sendWaitlistWelcomeEmailMock).toHaveBeenCalledWith({
        to: "ada@example.com",
        firstName: "Ada",
        industrySector: "Technology",
        desiredRole: "Software Engineer",
      });
      expect(setCalls).toContainEqual({
        waitlistConfirmationSentAt: expect.any(Date),
        waitlistConfirmationProviderId: "email-123",
        waitlistConfirmationLastError: null,
      });
    });
  });

  it("keeps the submission successful and records a provider failure", async () => {
    queryResults.push([], [{ id: 43 }], []);
    sendWaitlistWelcomeEmailMock.mockResolvedValueOnce({
      success: false,
      error: "Resend unavailable",
    });

    const response = await request(buildApp())
      .post("/leads/submit")
      .send(validLeadSubmission);

    expect(response.status).toBe(201);
    await vi.waitFor(() => {
      expect(setCalls).toContainEqual({
        waitlistConfirmationLastError: "Resend unavailable",
      });
    });
  });

  it("keeps the submission successful and records an unexpected dispatch error", async () => {
    queryResults.push([], [{ id: 44 }], []);
    sendWaitlistWelcomeEmailMock.mockRejectedValueOnce(new Error("Email worker failed"));

    const response = await request(buildApp())
      .post("/leads/submit")
      .send(validLeadSubmission);

    expect(response.status).toBe(201);
    await vi.waitFor(() => {
      expect(setCalls).toContainEqual({
        waitlistConfirmationLastError: "Email worker failed",
      });
    });
  });

  it("does not send a welcome email for a partial chat lead", async () => {
    async function* streamResponse() {
      yield { choices: [{ delta: { content: "Thanks, Ada." } }] };
    }
    openAiCreateMock
      .mockResolvedValueOnce(streamResponse())
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              name: "Ada Lovelace",
              email: "ada@example.com",
            }),
          },
        }],
      });
    queryResults.push([], [{ id: 98 }]);

    const response = await request(buildApp())
      .post("/leads/chat")
      .send({
        message: "My email is ada@example.com",
        history: [{ role: "user", content: "My name is Ada Lovelace" }],
      });

    expect(response.status).toBe(200);
    expect(valueCalls).toContainEqual(expect.objectContaining({
      email: "ada@example.com",
      source: "chat",
    }));
    expect(sendWaitlistWelcomeEmailMock).not.toHaveBeenCalled();
  });

  it("sends the welcome email after chat collects the required contact details", async () => {
    async function* streamResponse() {
      yield { choices: [{ delta: { content: "Thanks, Ada. You are all set." } }] };
    }
    openAiCreateMock
      .mockResolvedValueOnce(streamResponse())
      .mockResolvedValueOnce({
        choices: [{
          message: {
            content: JSON.stringify({
              name: "Ada Lovelace",
              email: "ada@example.com",
              phone: "+44 7700 900123",
              industrySector: "Technology",
              desiredRole: "Software Engineer",
            }),
          },
        }],
      });
    queryResults.push([], [{ id: 99 }], []);

    const response = await request(buildApp())
      .post("/leads/chat")
      .send({
        message: "My phone is +44 7700 900123",
        history: [{ role: "user", content: "My name is Ada Lovelace and my email is ada@example.com" }],
      });

    expect(response.status).toBe(200);
    expect(response.text).toContain('"waitlistConfirmationQueued":true');
    await vi.waitFor(() => {
      expect(sendWaitlistWelcomeEmailMock).toHaveBeenCalledWith({
        to: "ada@example.com",
        firstName: "Ada",
        industrySector: "Technology",
        desiredRole: "Software Engineer",
      });
      expect(setCalls).toContainEqual({
        waitlistConfirmationSentAt: expect.any(Date),
        waitlistConfirmationProviderId: "email-123",
        waitlistConfirmationLastError: null,
      });
    });
  });
});

describe("marketing lead access", () => {
  beforeEach(() => {
    queryResults.length = 0;
    setCalls.length = 0;
    mockGetSession.mockResolvedValue(marketingSession);
  });

  it("keeps marketing scope to its own or unassigned leads", () => {
    expect(isMarketingLeadVisible("marketing-2", "marketing-1")).toBe(false);
    expect(isMarketingLeadVisible("marketing-1", "marketing-1")).toBe(true);
    expect(isMarketingLeadVisible(null, "marketing-1")).toBe(true);
    expect(resolveMarketingLeadScope("marketing", "marketing-1", "")).toBe("mine_or_unassigned");
    expect(resolveMarketingLeadScope("marketing", "marketing-1", "marketing-2")).toBe("mine_or_unassigned");
    expect(resolveMarketingLeadScope("marketing", "marketing-1", "marketing-1")).toBe("mine");
    expect(resolveMarketingLeadScope("admin", "admin-1", "marketing-2")).toBe("all");
  });

  it("allows marketing to list only the approved lead fields", async () => {
    queryResults.push(
      [{ total: 1 }],
      [
        {
          id: 9,
          name: "Ada Lovelace",
          email: "ada@example.com",
          phone: "07123 456789",
          sector: "Technology",
          source: "form",
          status: "new",
          createdAt: new Date("2026-08-20T12:00:00.000Z"),
          desiredRole: "Product manager",
          additionalMessage: "Interested in relocation",
          assigneeId: null,
          assigneeEmail: null,
          assigneeName: null,
          assigneeCalendlyUrl: null,
        },
        {
          id: 10,
          name: "Other Marketer Lead",
          email: "other@example.com",
          phone: null,
          sector: "Technology",
          source: "form",
          status: "contacted",
          createdAt: new Date("2026-08-20T12:00:00.000Z"),
          desiredRole: null,
          additionalMessage: null,
          assigneeId: "marketing-2",
          assigneeEmail: "owner@example.com",
          assigneeName: "Morgan Owner",
          assigneeCalendlyUrl: "https://calendly.com/morgan-owner",
        },
      ],
      [
        { status: "new", total: 1 },
      ],
      [{ total: 1 }],
    );

    const response = await request(buildApp())
      .get("/leads")
      .set("Authorization", "Bearer marketing-session");

    expect(response.status).toBe(200);
    expect(response.body.leads).toEqual([
      expect.objectContaining({
        id: 9,
        name: "Ada Lovelace",
        email: "ada@example.com",
        sector: "Technology",
        desiredRole: "Product manager",
      }),
    ]);
    expect(response.body.leads[0]).not.toHaveProperty("ipHash");
    expect(response.body.leads[0]).not.toHaveProperty("utmCampaign");
    expect(response.body.leads[0].assignee).toBeNull();
    expect(response.body.stats.statusTotals).toEqual({
      new: 1,
      contacted: 0,
      registered: 0,
      unqualified: 0,
    });
    expect(response.body.stats.createdLast7Days).toBe(1);
  });

  it("returns performance metrics scoped to the signed-in marketer", async () => {
    queryResults.push([{
      assignedCount: 4,
      contactedCount: 2,
      registeredCount: 1,
      averageResponseTimeMinutes: 37.5,
    }]);

    const response = await request(buildApp())
      .get("/leads/my-performance")
      .set("Authorization", "Bearer marketing-session");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      assignedCount: 4,
      contactedCount: 2,
      registeredCount: 1,
      conversionRate: 25,
      averageResponseTimeMinutes: 37.5,
    });
  });

  it("denies personal performance to non-marketing users", async () => {
    mockGetSession.mockResolvedValue(candidateSession);

    const response = await request(buildApp())
      .get("/leads/my-performance")
      .set("Authorization", "Bearer candidate-session");

    expect(response.status).toBe(403);
  });

  it("claims an unassigned lead without marking it contacted", async () => {
    const claimedAt = new Date("2026-08-21T12:00:00.000Z");
    queryResults.push([{
      id: 9,
      status: "new",
      marketingUserId: "marketing-1",
      claimedAt,
      contactedAt: null,
    }]);

    const response = await request(buildApp())
      .post("/leads/9/claim")
      .set("Authorization", "Bearer marketing-session");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      id: 9,
      status: "new",
      marketingUserId: "marketing-1",
      claimedAt: claimedAt.toISOString(),
      contactedAt: null,
    });
    expect(setCalls[0]).toEqual({
      marketingUserId: "marketing-1",
      claimedAt: expect.any(Date),
    });
    expect(JSON.stringify(setCalls[0])).not.toContain("contactedAt");
    expect(JSON.stringify(setCalls[0])).not.toContain("status");
  });

  it("returns conflict when claiming an assigned lead", async () => {
    queryResults.push([], [{ id: 9, marketingUserId: "marketing-2" }]);

    const response = await request(buildApp())
      .post("/leads/9/claim")
      .set("Authorization", "Bearer marketing-session");

    expect(response.status).toBe(409);
  });

  it("returns not found when claiming an absent lead", async () => {
    queryResults.push([], []);

    const response = await request(buildApp())
      .post("/leads/999/claim")
      .set("Authorization", "Bearer marketing-session");

    expect(response.status).toBe(404);
  });

  it("denies non-marketing users from claiming leads", async () => {
    mockGetSession.mockResolvedValue(candidateSession);

    const response = await request(buildApp())
      .post("/leads/9/claim")
      .set("Authorization", "Bearer candidate-session");

    expect(response.status).toBe(403);
  });

  it("rejects an invalid claim lead ID", async () => {
    const response = await request(buildApp())
      .post("/leads/not-a-number/claim")
      .set("Authorization", "Bearer marketing-session");

    expect(response.status).toBe(400);
  });

  it("requires authentication to claim a lead", async () => {
    mockGetSession.mockResolvedValue(null);

    const response = await request(buildApp())
      .post("/leads/9/claim");

    expect(response.status).toBe(401);
  });

  it("allows marketing to update one lead status", async () => {
    queryResults.push([{ id: 9, status: "contacted" }]);

    const response = await request(buildApp())
      .patch("/leads/9/status")
      .set("Authorization", "Bearer marketing-session")
      .send({ status: "contacted" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ id: 9, status: "contacted" });
  });

  it("allows marketing to update statuses in bulk", async () => {
    queryResults.push(
      [{ id: 9, marketingUserId: "marketing-1" }],
      [{ id: 9, marketingUserId: "marketing-1" }],
    );

    const response = await request(buildApp())
      .patch("/leads/bulk-status")
      .set("Authorization", "Bearer marketing-session")
      .send({ ids: [9], status: "contacted" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ updated: 1 });
  });

  it("does not partially update a bulk request with a missing lead", async () => {
    queryResults.push([{ id: 9, marketingUserId: "marketing-1" }]);

    const response = await request(buildApp())
      .patch("/leads/bulk-status")
      .set("Authorization", "Bearer marketing-session")
      .send({ ids: [9, 10], status: "contacted" });

    expect(response.status).toBe(404);
  });

  it("does not partially update a bulk request with forbidden ownership", async () => {
    queryResults.push([
      { id: 9, marketingUserId: "marketing-1" },
      { id: 10, marketingUserId: "marketing-2" },
    ]);

    const response = await request(buildApp())
      .patch("/leads/bulk-status")
      .set("Authorization", "Bearer marketing-session")
      .send({ ids: [9, 10], status: "contacted" });

    expect(response.status).toBe(403);
  });

  it("returns 403 when marketing tries to update another marketer's lead", async () => {
    queryResults.push(
      [],
      [{ marketingUserId: "marketing-2" }],
    );

    const response = await request(buildApp())
      .patch("/leads/9/status")
      .set("Authorization", "Bearer marketing-session")
      .send({ status: "contacted" });

    expect(response.status).toBe(403);
  });

  it("returns 403 when marketing tries to update an unassigned lead", async () => {
    queryResults.push([], [{ marketingUserId: null }]);

    const response = await request(buildApp())
      .patch("/leads/9/status")
      .set("Authorization", "Bearer marketing-session")
      .send({ status: "contacted" });

    expect(response.status).toBe(403);
  });

  it("denies marketing bulk deletion", async () => {
    const response = await request(buildApp())
      .delete("/leads")
      .set("Authorization", "Bearer marketing-session")
      .send({ ids: [9] });

    expect(response.status).toBe(403);
  });

  it("denies marketing lead reassignment", async () => {
    const response = await request(buildApp())
      .patch("/leads/9/assignee")
      .set("Authorization", "Bearer marketing-session")
      .send({ marketingUserId: "marketing-2" });

    expect(response.status).toBe(403);
  });

  it("lets marketing users save and clear their own Calendly link", async () => {
    queryResults.push([{ calendlyUrl: "https://calendly.com/mara-k" }]);

    const saveResponse = await request(buildApp())
      .patch("/me/calendly-url")
      .set("Authorization", "Bearer marketing-session")
      .send({ calendlyUrl: "https://calendly.com/mara-k" });

    expect(saveResponse.status).toBe(200);
    expect(saveResponse.body).toEqual({ calendlyUrl: "https://calendly.com/mara-k" });

    queryResults.push([{ calendlyUrl: null }]);
    const clearResponse = await request(buildApp())
      .patch("/me/calendly-url")
      .set("Authorization", "Bearer marketing-session")
      .send({ calendlyUrl: "" });

    expect(clearResponse.status).toBe(200);
    expect(clearResponse.body).toEqual({ calendlyUrl: null });
  });

  it("rejects invalid or non-Calendly booking URLs", async () => {
    const response = await request(buildApp())
      .patch("/me/calendly-url")
      .set("Authorization", "Bearer marketing-session")
      .send({ calendlyUrl: "https://example.com/book" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("calendly.com");
  });

  it("rejects candidate access to the marketing Calendly endpoint", async () => {
    mockGetSession.mockResolvedValue(candidateSession);

    const response = await request(buildApp())
      .patch("/me/calendly-url")
      .set("Authorization", "Bearer candidate-session")
      .send({ calendlyUrl: "https://calendly.com/candidate" });

    expect(response.status).toBe(403);
  });
});

describe("admin lead assignment", () => {
  beforeEach(() => {
    queryResults.length = 0;
    mockGetSession.mockResolvedValue(adminSession);
  });

  it("keeps the full lead list scope for admins", async () => {
    queryResults.push(
      [{ total: 2 }],
      [
        {
          id: 9,
          firstName: "Ada",
          lastName: "Admin",
          email: "ada@example.com",
          phone: null,
          industrySector: null,
          desiredRole: null,
          additionalMessage: null,
          utmSource: null,
          utmMedium: null,
          utmCampaign: null,
          utmContent: null,
          landingPath: null,
          referrerUrl: null,
          ipHash: null,
          gdprConsent: true,
          gdprConsentedAt: null,
          status: "new",
          source: "form",
          convertedUserId: null,
          marketingUserId: "marketing-2",
          createdAt: new Date("2026-08-20T12:00:00.000Z"),
          assigneeId: "marketing-2",
          assigneeEmail: "owner@example.com",
          assigneeName: "Morgan Owner",
          assigneeCalendlyUrl: null,
        },
        {
          id: 10,
          firstName: "Una",
          lastName: "Assigned",
          email: "una@example.com",
          phone: null,
          industrySector: null,
          desiredRole: null,
          additionalMessage: null,
          utmSource: null,
          utmMedium: null,
          utmCampaign: null,
          utmContent: null,
          landingPath: null,
          referrerUrl: null,
          ipHash: null,
          gdprConsent: true,
          gdprConsentedAt: null,
          status: "new",
          source: "form",
          convertedUserId: null,
          marketingUserId: null,
          createdAt: new Date("2026-08-20T12:00:00.000Z"),
          assigneeId: null,
          assigneeEmail: null,
          assigneeName: null,
          assigneeCalendlyUrl: null,
        },
      ],
      [{ status: "new", total: 2 }],
      [{ total: 1 }],
    );

    const response = await request(buildApp())
      .get("/leads")
      .set("Authorization", "Bearer admin-session");

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(2);
    expect(response.body.leads).toHaveLength(2);
  });

  it("assigns a marketing user to a lead", async () => {
    queryResults.push(
      [{
        id: "marketing-2",
        email: "owner@example.com",
        name: "Morgan Owner",
      }],
      [{ id: 9, marketingUserId: "marketing-2" }],
    );

    const response = await request(buildApp())
      .patch("/leads/9/assignee")
      .set("Authorization", "Bearer admin-session")
      .send({ marketingUserId: "marketing-2" });

    expect(response.status).toBe(200);
    expect(response.body.assignee).toEqual({
      id: "marketing-2",
      email: "owner@example.com",
      name: "Morgan Owner",
    });
  });

  it("rejects a non-marketing user as assignee", async () => {
    queryResults.push([]);

    const response = await request(buildApp())
      .patch("/leads/9/assignee")
      .set("Authorization", "Bearer admin-session")
      .send({ marketingUserId: "candidate-1" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("not a marketing user");
  });

  it("assigns multiple leads to one marketing user", async () => {
    queryResults.push(
      [{
        id: "marketing-2",
        email: "owner@example.com",
        name: "Morgan Owner",
        calendlyUrl: "https://calendly.com/morgan-owner",
      }],
      [{ id: 9 }, { id: 10 }],
    );

    const response = await request(buildApp())
      .patch("/leads/bulk-assignee")
      .set("Authorization", "Bearer admin-session")
      .send({ ids: [9, 10], marketingUserId: "marketing-2" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      updated: 2,
      marketingUserId: "marketing-2",
      assignee: {
        id: "marketing-2",
        email: "owner@example.com",
        name: "Morgan Owner",
        calendlyUrl: "https://calendly.com/morgan-owner",
      },
    });
  });

  it("allows bulk unassignment with a null marketing user", async () => {
    queryResults.push([{ id: 9 }, { id: 10 }]);

    const response = await request(buildApp())
      .patch("/leads/bulk-assignee")
      .set("Authorization", "Bearer admin-session")
      .send({ ids: [9, 10], marketingUserId: null });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      updated: 2,
      marketingUserId: null,
      assignee: null,
    });
  });

  it("rejects an empty or invalid bulk lead ID list", async () => {
    const emptyResponse = await request(buildApp())
      .patch("/leads/bulk-assignee")
      .set("Authorization", "Bearer admin-session")
      .send({ ids: [], marketingUserId: "marketing-2" });

    expect(emptyResponse.status).toBe(400);

    const invalidResponse = await request(buildApp())
      .patch("/leads/bulk-assignee")
      .set("Authorization", "Bearer admin-session")
      .send({ ids: ["not-a-lead"], marketingUserId: "marketing-2" });

    expect(invalidResponse.status).toBe(400);
  });

  it("rejects a non-marketing user for bulk assignment", async () => {
    queryResults.push([]);

    const response = await request(buildApp())
      .patch("/leads/bulk-assignee")
      .set("Authorization", "Bearer admin-session")
      .send({ ids: [9, 10], marketingUserId: "candidate-1" });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("not a marketing user");
  });

  it("denies marketing users bulk lead assignment", async () => {
    mockGetSession.mockResolvedValue(marketingSession);

    const response = await request(buildApp())
      .patch("/leads/bulk-assignee")
      .set("Authorization", "Bearer marketing-session")
      .send({ ids: [9, 10], marketingUserId: "marketing-2" });

    expect(response.status).toBe(403);
  });
});