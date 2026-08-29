import { beforeEach, describe, expect, it, vi } from "vitest";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";

const { queryResults } = vi.hoisted(() => ({ queryResults: [] as unknown[] }));

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
      set: () => chain,
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
  openai: { chat: { completions: { create: vi.fn() } } },
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

describe("marketing lead access", () => {
  beforeEach(() => {
    queryResults.length = 0;
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
      [{ id: 9, marketingUserId: "marketing-1" }, { id: 10, marketingUserId: null }],
      [{ id: 9 }, { id: 10 }],
    );

    const response = await request(buildApp())
      .patch("/leads/bulk-status")
      .set("Authorization", "Bearer marketing-session")
      .send({ ids: [9, 10], status: "contacted" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ updated: 2 });
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