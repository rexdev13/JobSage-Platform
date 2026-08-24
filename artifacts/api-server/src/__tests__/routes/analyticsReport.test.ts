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
      then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve(queryResults.shift() ?? []).then(resolve, reject),
    };
    return chain;
  }

  return {
    db: { select: () => makeChain() },
    profilesTable: { userId: "user_id" },
    applicationsTable: { userId: "user_id" },
    speculativeApplicationsTable: { userId: "user_id" },
    documentsTable: { id: "id", userId: "user_id" },
    remediationPlansTable: { userId: "user_id", createdAt: "created_at" },
    remediationStepsTable: { planId: "plan_id" },
    decisionRecordsTable: { userId: "user_id", createdAt: "created_at" },
  };
});

const mockGetSession = vi.fn();
vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return { ...actual, getSession: mockGetSession };
});

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({ choices: [{ message: { content: "Keep progressing." } }] }),
      },
    },
  },
}));

const analyticsRouter = (await import("../../routes/analyticsReport")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

function buildApp() {
  const app = express();
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(analyticsRouter);
  return app;
}

describe("GET /my-analytics", () => {
  beforeEach(() => {
    queryResults.length = 0;
    mockGetSession.mockResolvedValue({
      user: {
        id: "candidate-1",
        email: "candidate@example.com",
        role: "candidate",
        firstName: "Ada",
        lastName: "Lovelace",
      },
    });
  });

  it("returns the last-seven-days applications grouped by their current status", async () => {
    const now = Date.now();
    queryResults.push(
      [{ profession: "doctor", specialty: null, qualificationCountry: null, registrationStatus: null }],
      [
        { appliedAt: new Date(now - 60_000), status: "link_clicked" },
        { appliedAt: new Date(now - 120_000), status: "applied" },
        { appliedAt: new Date(now - 180_000), status: "interview" },
        { appliedAt: new Date(now - 240_000), status: "offer" },
        { appliedAt: new Date(now - 8 * 24 * 60 * 60 * 1000), status: "offer" },
      ],
      [],
      [],
      [{ outcome: "eligible" }],
      [],
    );

    const response = await request(buildApp())
      .get("/my-analytics")
      .set("Authorization", "Bearer candidate-session");

    expect(response.status).toBe(200);
    expect(response.body.applicationsLast7Days).toEqual({
      total: 4,
      link_clicked: 1,
      applied: 1,
      interview: 1,
      offer: 1,
    });
  });
});