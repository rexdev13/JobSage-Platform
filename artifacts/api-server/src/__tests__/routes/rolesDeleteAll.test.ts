import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

// ── hoisted DB results queue ──────────────────────────────────────────────────
const { dbResults, txDeleteCalls } = vi.hoisted(() => ({
  dbResults: [] as any[],
  txDeleteCalls: [] as unknown[],
}));

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from() { return chain; },
      innerJoin() { return chain; },
      leftJoin() { return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return chain; },
      values() { return chain; },
      set() { return chain; },
      onConflictDoNothing() { return chain; },
      delete() { return chain; },
      then(resolve: any, reject?: any) {
        return Promise.resolve(dbResults.shift() ?? []).then(resolve, reject);
      },
      catch() { return chain; },
      returning() { return Promise.resolve(dbResults.shift() ?? []); },
    };
    return chain;
  }
  const tx = {
    delete: (table: unknown) => {
      txDeleteCalls.push(table);
      const chain: any = {
        where() { return Promise.resolve(); },
        then(resolve: any) { return Promise.resolve().then(resolve); },
      };
      return chain;
    },
  };
  return {
    db: {
      select: () => makeChain(),
      insert: () => makeChain(),
      update: () => makeChain(),
      delete: () => makeChain(),
      execute: () => Promise.resolve({ rows: [] }),
      transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
    },
    rolesTable: { __name: "roles" },
    profilesTable: {},
    decisionRecordsTable: {},
    rulesetRulesTable: {},
    applicationsTable: { __name: "applications", roleId: {} },
    speculativeApplicationsTable: {},
    jobListingsTable: {},
    employerProfilesTable: {},
    candidateMatchScoresTable: { __name: "candidate_match_scores", roleId: {} },
    matchDismissalsTable: { __name: "match_dismissals", roleId: {} },
    smartApplyDraftsTable: { __name: "smart_apply_drafts", roleId: {} },
    careerProfilesTable: {},
    auditEventsTable: {},
    sponsorLicenceVacanciesTable: {},
    sponsorLicencesTable: {},
    sponsorLicenceVacancyScoresTable: {},
  };
});

vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return {
    ...actual,
    getSession: vi.fn().mockResolvedValue({
      user: { id: "admin-1", email: "admin@test.com", role: "admin", firstName: null, lastName: null, profileImageUrl: null },
    }),
    clearSession: vi.fn(),
    deleteSession: vi.fn(),
    createSession: vi.fn().mockResolvedValue("sess"),
  };
});

vi.mock("../../middlewares/consentMiddleware", () => ({
  requireConsent: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("../../lib/candidateAiMatch", () => ({
  batchScoreRoles: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("../../lib/sponsorshipFeasibility", () => ({
  assessSponsorshipFeasibility: vi.fn().mockReturnValue(null),
}));

const rolesRouter = (await import("../../routes/roles")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(rolesRouter);
  return app;
}

const AUTH = "Bearer admin-session";

describe("DELETE /admin/roles/all — bulk delete", () => {
  beforeEach(() => {
    dbResults.length = 0;
    txDeleteCalls.length = 0;
  });

  it("route exists and is not shadowed by /admin/roles/:id (no 404)", async () => {
    dbResults.push([]); // no roles
    const res = await request(buildApp())
      .delete("/admin/roles/all")
      .set("Authorization", AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 0 });
  });

  it("deletes every role plus dependent rows and returns the count", async () => {
    dbResults.push([{ id: 1 }, { id: 2 }, { id: 3 }]); // roles listing
    const res = await request(buildApp())
      .delete("/admin/roles/all")
      .set("Authorization", AUTH);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 3 });
    // dependent tables + roles table all deleted inside the transaction
    expect(txDeleteCalls.length).toBe(5);
    expect(txDeleteCalls[txDeleteCalls.length - 1]).toMatchObject({ __name: "roles" });
  });

  it("rejects non-admin users with 403, not 404", async () => {
    const { getSession } = await import("../../lib/auth");
    (getSession as any).mockResolvedValueOnce({
      user: { id: "cand-1", email: "c@test.com", role: "candidate", firstName: null, lastName: null, profileImageUrl: null },
    });
    const res = await request(buildApp())
      .delete("/admin/roles/all")
      .set("Authorization", AUTH);
    expect(res.status).toBe(403);
  });
});
