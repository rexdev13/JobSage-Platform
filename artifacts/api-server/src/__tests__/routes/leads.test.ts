import { beforeEach, describe, expect, it, vi } from "vitest";
import cookieParser from "cookie-parser";
import express from "express";
import request from "supertest";

const { queryResults } = vi.hoisted(() => ({ queryResults: [] as unknown[] }));

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
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

const leadsRouter = (await import("../../routes/leads")).default;
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

describe("marketing lead access", () => {
  beforeEach(() => {
    queryResults.length = 0;
    mockGetSession.mockResolvedValue(marketingSession);
  });

  it("allows marketing to list only the approved lead fields", async () => {
    queryResults.push(
      [{ total: 1 }],
      [{
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
      }],
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
    queryResults.push([{ id: 9 }, { id: 10 }]);

    const response = await request(buildApp())
      .patch("/leads/bulk-status")
      .set("Authorization", "Bearer marketing-session")
      .send({ ids: [9, 10], status: "contacted" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ updated: 2 });
  });

  it("denies marketing bulk deletion", async () => {
    const response = await request(buildApp())
      .delete("/leads")
      .set("Authorization", "Bearer marketing-session")
      .send({ ids: [9] });

    expect(response.status).toBe(403);
  });
});