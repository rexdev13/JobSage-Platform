import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

// ── hoisted DB results queue ──────────────────────────────────────────────────
const { dbResults } = vi.hoisted(() => ({ dbResults: [] as any[] }));

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from() { return chain; },
      innerJoin() { return chain; },
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
      catch(fn: any) { return chain; },
      returning() { return Promise.resolve(dbResults.shift() ?? []); },
    };
    return chain;
  }
  return {
    db: {
      select: () => makeChain(),
      insert: () => makeChain(),
      update: () => makeChain(),
      delete: () => makeChain(),
      execute: () => Promise.resolve({ rows: [] }),
    },
    rolesTable: {},
    profilesTable: {},
    decisionRecordsTable: {},
    rulesetRulesTable: {},
    applicationsTable: {},
    speculativeApplicationsTable: {},
    jobListingsTable: {},
    employerProfilesTable: {},
    candidateMatchScoresTable: {},
    matchDismissalsTable: {},
    careerProfilesTable: {},
    auditEventsTable: {},
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

// ── Helper: create a multipart CSV upload request ────────────────────────────
async function importCSV(app: express.Express, csvContent: string) {
  const boundary = "----TestBoundary";
  const body =
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="roles.csv"\r\nContent-Type: text/csv\r\n\r\n` +
    csvContent +
    `\r\n--${boundary}--\r\n`;
  return request(app)
    .post("/admin/roles/import")
    .set("Authorization", AUTH)
    .set("Content-Type", `multipart/form-data; boundary=${boundary}`)
    .send(Buffer.from(body));
}

describe("Admin roles CSV import — applyUrl column", () => {
  beforeEach(() => { dbResults.length = 0; });

  it("imports CSV without applyUrl column (backward compatibility)", async () => {
    const csv = [
      "title,employer,location,regulator,sponsorshipOffered,requiredRegistration",
      "Staff Nurse,NHS Trust,London,NMC,true,Full NMC Registration",
    ].join("\n");

    // DB: insert returns [] success, audit insert returns []
    dbResults.push([]); // insert roles
    dbResults.push([]); // audit insert

    const app = buildApp();
    const res = await importCSV(app, csv);
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(0);
  });

  it("imports CSV with valid applyUrl column", async () => {
    const csv = [
      "title,employer,location,regulator,sponsorshipOffered,requiredRegistration,applyUrl",
      "Consultant Cardiologist,NHS Trust,London,GMC,true,Full GMC Registration,https://jobs.nhs.uk/vacancy/123",
    ].join("\n");

    dbResults.push([]); // insert roles
    dbResults.push([]); // audit insert

    const app = buildApp();
    const res = await importCSV(app, csv);
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(0);
  });

  it("rejects rows with invalid applyUrl (non-http/https)", async () => {
    const csv = [
      "title,employer,location,regulator,sponsorshipOffered,requiredRegistration,applyUrl",
      "Staff Nurse,NHS Trust,London,NMC,true,Full NMC Registration,ftp://invalid.com/jobs",
    ].join("\n");

    const app = buildApp();
    const res = await importCSV(app, csv);
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(0);
    expect(res.body.skipped).toBe(1);
    expect(res.body.errors[0].message).toMatch(/valid http/i);
  });

  it("accepts empty applyUrl column (treated as null)", async () => {
    const csv = [
      "title,employer,location,regulator,sponsorshipOffered,requiredRegistration,applyUrl",
      "Physiotherapist,NHS Trust,Leeds,HCPC,false,Full HCPC Registration,",
    ].join("\n");

    dbResults.push([]); // insert roles
    dbResults.push([]); // audit insert

    const app = buildApp();
    const res = await importCSV(app, csv);
    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(res.body.skipped).toBe(0);
  });

  it("rejects CSV missing required columns", async () => {
    const csv = [
      "title,employer,location",
      "Staff Nurse,NHS Trust,London",
    ].join("\n");

    const app = buildApp();
    const res = await importCSV(app, csv);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing required columns/i);
  });
});

describe("applyUrl URL validation pattern", () => {
  const APPLY_URL_PATTERN = /^https?:\/\/.+/i;

  it("accepts http URLs", () => {
    expect(APPLY_URL_PATTERN.test("http://example.com/jobs")).toBe(true);
  });

  it("accepts https URLs", () => {
    expect(APPLY_URL_PATTERN.test("https://jobs.nhs.uk/vacancy/123")).toBe(true);
  });

  it("rejects ftp URLs", () => {
    expect(APPLY_URL_PATTERN.test("ftp://example.com/jobs")).toBe(false);
  });

  it("rejects plain text", () => {
    expect(APPLY_URL_PATTERN.test("not a url")).toBe(false);
  });

  it("rejects javascript: protocol", () => {
    expect(APPLY_URL_PATTERN.test("javascript:alert(1)")).toBe(false);
  });

  it("accepts https URL with path and query params", () => {
    expect(APPLY_URL_PATTERN.test("https://jobs.nhs.uk/vacancy?id=123&ref=abc")).toBe(true);
  });
});
