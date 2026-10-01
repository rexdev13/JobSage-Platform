import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const { dbResults, insertedValues, mockGetSession } = vi.hoisted(() => ({
  dbResults: [] as any[],
  insertedValues: [] as any[],
  mockGetSession: vi.fn(),
}));

vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema");

  function makeSelectChain(): any {
    const chain: any = {
      from() { return chain; },
      leftJoin() { return chain; },
      where() { return chain; },
      groupBy() { return chain; },
      orderBy() { return chain; },
      limit() { return chain; },
      offset() { return chain; },
      then(resolve: any, reject?: any) {
        return Promise.resolve(dbResults.shift() ?? []).then(resolve, reject);
      },
    };
    return chain;
  }

  function makeInsertChain(): any {
    const chain: any = {
      values(value: any) {
        insertedValues.push(value);
        return chain;
      },
      then(resolve: any, reject?: any) {
        return Promise.resolve(undefined).then(resolve, reject);
      },
    };
    return chain;
  }

  return {
    ...schema,
    db: {
      select: vi.fn(() => makeSelectChain()),
      insert: vi.fn(() => makeInsertChain()),
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

const descriptionFeedbackRouter = (await import("../../routes/descriptionFeedback")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

const employer = {
  id: "employer-1",
  email: "employer@example.com",
  role: "employer",
  firstName: "Care",
  lastName: "Group",
  profileImageUrl: null,
  emailVerified: true,
};

const superAdmin = { ...employer, id: "super-admin-1", role: "super_admin" };

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(descriptionFeedbackRouter);
  return app;
}

function authAs(user: typeof employer | typeof superAdmin) {
  mockGetSession.mockResolvedValue({ user });
  return { Authorization: "Bearer description-feedback-test-session" };
}

describe("employer AI description feedback routes", () => {
  beforeEach(() => {
    dbResults.length = 0;
    insertedValues.length = 0;
    mockGetSession.mockResolvedValue(null);
  });

  it("persists the rating with server-owned employer identity and normalized job context", async () => {
    const response = await request(buildApp())
      .post("/employer/jobs/description-feedback")
      .set(authAs(employer))
      .send({ sentiment: "up", jobTitle: "  Staff Nurse  ", specialty: "  ICU  " });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(insertedValues).toEqual([{
      employerUserId: employer.id,
      sentiment: "up",
      jobTitle: "Staff Nurse",
      specialty: "ICU",
    }]);
  });

  it("rejects blank job titles instead of recording unusable ratings", async () => {
    const response = await request(buildApp())
      .post("/employer/jobs/description-feedback")
      .set(authAs(employer))
      .send({ sentiment: "down", jobTitle: "   " });

    expect(response.status).toBe(400);
    expect(insertedValues).toHaveLength(0);
  });

  it("only allows employers and admins to submit ratings", async () => {
    const candidate = { ...employer, role: "candidate" };
    const response = await request(buildApp())
      .post("/employer/jobs/description-feedback")
      .set(authAs(candidate as typeof employer))
      .send({ sentiment: "up", jobTitle: "Staff Nurse" });

    expect(response.status).toBe(403);
    expect(insertedValues).toHaveLength(0);
  });

  it("lists ratings with company context and aggregate counts for admins", async () => {
    dbResults.push(
      [{ sentiment: "up", total: 2 }, { sentiment: "down", total: 1 }],
      [{
        id: 4,
        sentiment: "down",
        jobTitle: "Staff Nurse",
        specialty: "ICU",
        employerUserId: employer.id,
        email: employer.email,
        companyName: "Care Group",
        createdAt: new Date("2026-10-01T09:00:00.000Z"),
      }],
    );

    const response = await request(buildApp())
      .get("/admin/super/description-feedback?limit=25&offset=0")
      .set(authAs(superAdmin));

    expect(response.status).toBe(200);
    expect(response.body.summary).toEqual({ total: 3, up: 2, down: 1 });
    expect(response.body.items).toHaveLength(1);
    expect(response.body.items[0]).toMatchObject({
      id: 4,
      sentiment: "down",
      jobTitle: "Staff Nurse",
      specialty: "ICU",
      employerUserId: employer.id,
      email: employer.email,
      companyName: "Care Group",
    });
  });

  it("keeps employer ratings behind admin access", async () => {
    const response = await request(buildApp())
      .get("/admin/super/description-feedback")
      .set(authAs(employer));

    expect(response.status).toBe(403);
  });
});