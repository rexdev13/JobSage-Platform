import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";

const { appResults, insertValues, updateSets } = vi.hoisted(() => ({
  appResults: [] as any[],
  insertValues: [] as any[],
  updateSets: [] as any[],
}));

vi.mock("../../lib/jobsageEmailGen", () => ({
  resolveJobsageAlias: vi.fn().mockResolvedValue("jane.doe.abc123@mail.jobsage.co.uk"),
}));

vi.mock("@workspace/db", () => {
  function makeChain(): any {
    const chain: any = {
      from() { return chain; },
      leftJoin() { return chain; },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return chain; },
      values(value: unknown) { insertValues.push(value); return chain; },
      set(value: unknown) { updateSets.push(value); return chain; },
      then(resolve: any, reject?: any) {
        return Promise.resolve(appResults.shift() ?? []).then(resolve, reject);
      },
      catch() { return chain; },
      returning() { return Promise.resolve(appResults.shift() ?? []); },
    };
    return chain;
  }
  const dbMock: any = {
    select: () => makeChain(),
    insert: () => makeChain(),
    update: () => makeChain(),
    delete: () => makeChain(),
    execute: () => Promise.resolve([]),
    transaction: (callback: (tx: any) => Promise<unknown>) => callback(dbMock),
  };
  return {
    db: dbMock,
    applicationsTable: {},
    speculativeApplicationsTable: {},
    jobListingsTable: {},
    documentsTable: {},
    rolesTable: {},
    candidateMessagesTable: {},
    employerProfilesTable: {},
    sponsorLicenceVacanciesTable: {},
    sponsorLicencesTable: {},
  };
});

vi.mock("../../lib/auth", async () => {
  const actual = await vi.importActual<typeof import("../../lib/auth")>("../../lib/auth");
  return {
    ...actual,
    getSession: vi.fn().mockResolvedValue({
      user: { id: "cand-1", email: "cand@test.com", role: "candidate", firstName: "Jane", lastName: "Doe", profileImageUrl: null },
    }),
    clearSession: vi.fn(),
    deleteSession: vi.fn(),
    createSession: vi.fn().mockResolvedValue("sess"),
  };
});

vi.mock("../../lib/systemMessages", () => ({
  createApplicationReceivedMessage: vi.fn().mockResolvedValue(undefined),
}));

// DNS lookups in the SSRF guard: hostnames containing "private" resolve to an
// RFC1918 address; everything else resolves to a public IP.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async (host: string) => {
    if (host.includes("private")) return [{ address: "10.0.0.5", family: 4 }];
    return [{ address: "93.184.216.34", family: 4 }];
  }),
}));

const applicationsRouter = (await import("../../routes/applications")).default;
const { authMiddleware } = await import("../../middlewares/authMiddleware");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(authMiddleware);
  app.use(applicationsRouter);
  return app;
}

const SESS = "cand-session";

describe("GET /applications", () => {
  beforeEach(() => { appResults.length = 0; });

  it("returns 401 when not authenticated (no auth header)", async () => {
    const app = buildApp();
    const res = await request(app).get("/applications");
    expect(res.status).toBe(401);
  });

  it("returns empty application list with stats when none exist", async () => {
    appResults.push(
      [],
      [],
    );
    const app = buildApp();
    const res = await request(app)
      .get("/applications")
      .set("Authorization", `Bearer ${SESS}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.applications)).toBe(true);
    expect(res.body.applications).toHaveLength(0);
    expect(res.body.stats).toBeDefined();
    expect(res.body.stats.total).toBe(0);
  });

  it("enriches a sponsor-vacancy unified role ID from the sponsor vacancy source", async () => {
    const appliedAt = new Date("2025-02-01T12:00:00Z");
    appResults.push(
      [{ id: 8, userId: "cand-1", roleId: 2_000_123, applicationType: "platform", companyName: null, appliedAt, cvDocumentId: null, status: "applied" }],
      [],
      [{
        id: 123,
        title: "Registered Nurse",
        location: "Leeds",
        organisationName: "Sponsor NHS Trust",
        companyName: "Sponsor NHS Trust",
        liveness: "dead",
        livenessReason: "The vacancy closing date has passed.",
      }],
    );

    const res = await request(buildApp())
      .get("/applications")
      .set("Authorization", `Bearer ${SESS}`);

    expect(res.status).toBe(200);
    expect(res.body.applications[0]).toMatchObject({
      roleId: 2_000_123,
      roleTitle: "Registered Nurse",
      roleLocation: "Leeds",
      companyName: "Sponsor NHS Trust",
      isClosed: true,
      livenessReason: "The vacancy closing date has passed.",
    });
  });

  it("marks a closed job-board listing as closed with its liveness reason", async () => {
    appResults.push(
      [{ id: 9, userId: "cand-1", roleId: 1_000_321, applicationType: "platform", companyName: null, appliedAt: new Date(), cvDocumentId: null, status: "applied" }],
      [],
      [{
        id: 321,
        title: "Staff Nurse",
        location: "York",
        employerProfileId: 4,
        status: "closed",
        liveness: "live",
        livenessReason: null,
      }],
      [{ id: 4, companyName: "York Hospital" }],
    );

    const res = await request(buildApp())
      .get("/applications")
      .set("Authorization", `Bearer ${SESS}`);

    expect(res.status).toBe(200);
    expect(res.body.applications[0]).toMatchObject({
      isClosed: true,
      livenessReason: null,
      companyName: "York Hospital",
    });
  });

  it("marks an inactive normal role as closed with its liveness reason", async () => {
    appResults.push(
      [{ id: 10, userId: "cand-1", roleId: 77, applicationType: "platform", companyName: null, appliedAt: new Date(), cvDocumentId: null, status: "applied" }],
      [],
      [{
        id: 77,
        title: "Clinical Specialist",
        employer: "North Trust",
        active: false,
        liveness: "live",
        livenessReason: "Role withdrawn by the employer.",
      }],
    );

    const res = await request(buildApp())
      .get("/applications")
      .set("Authorization", `Bearer ${SESS}`);

    expect(res.status).toBe(200);
    expect(res.body.applications[0]).toMatchObject({
      isClosed: true,
      livenessReason: "Role withdrawn by the employer.",
    });
  });
});

describe("DELETE /applications/:id", () => {
  beforeEach(() => { appResults.length = 0; });

  it("deletes an owned regular application", async () => {
    appResults.push([{ id: 12 }]);

    const res = await request(buildApp())
      .delete("/applications/12")
      .set("Authorization", `Bearer ${SESS}`);

    expect(res.status).toBe(204);
  });

  it("deletes an owned speculative application using its negative tracker ID", async () => {
    appResults.push([{ id: 12 }]);

    const res = await request(buildApp())
      .delete("/applications/-12")
      .set("Authorization", `Bearer ${SESS}`);

    expect(res.status).toBe(204);
  });

  it("returns 404 when the application is missing or owned by another candidate", async () => {
    appResults.push([]);

    const res = await request(buildApp())
      .delete("/applications/12")
      .set("Authorization", `Bearer ${SESS}`);

    expect(res.status).toBe(404);
  });

  it("returns 400 for invalid application IDs", async () => {
    const res = await request(buildApp())
      .delete("/applications/0")
      .set("Authorization", `Bearer ${SESS}`);

    expect(res.status).toBe(400);
  });
});

describe("POST /applications", () => {
  beforeEach(() => {
    appResults.length = 0;
    insertValues.length = 0;
    updateSets.length = 0;
  });

  it("returns 400 when roleId is missing", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/applications")
      .set("Authorization", `Bearer ${SESS}`)
      .send({ coverLetter: "Hello" });
    expect(res.status).toBe(400);
  });

  it("creates new application and returns 200 when no duplicate exists", async () => {
    appResults.push(
      [],
      [{ id: 1, userId: "cand-1", roleId: 42, status: "applied", appliedAt: new Date(), applicationType: "platform", cvDocumentId: null }],
      [],
      [],
    );
    const app = buildApp();
    const res = await request(app)
      .post("/applications")
      .set("Authorization", `Bearer ${SESS}`)
      .send({ roleId: 42 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(1);
  });

  it("returns 200 when application already exists for that role (idempotent)", async () => {
    appResults.push(
      [{ id: 5, userId: "cand-1", roleId: 42, status: "applied", appliedAt: new Date(), applicationType: "platform", cvDocumentId: null }],
    );
    const app = buildApp();
    const res = await request(app)
      .post("/applications")
      .set("Authorization", `Bearer ${SESS}`)
      .send({ roleId: 42 });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(5);
  });

  it("creates the website click record sent by Opportunities with exact URL and title", async () => {
    appResults.push(
      [],
      [{
        id: 12,
        userId: "cand-1",
        roleId: 42,
        applicationType: "website",
        companyName: "Example NHS Trust",
        jobTitle: "Band 5 Nurse",
        applicationUrl: "https://jobs.example.nhs.uk/roles/42",
        status: "link_clicked",
        appliedAt: new Date(),
        cvDocumentId: null,
      }],
    );
    const app = buildApp();
    const res = await request(app)
      .post("/applications")
      .set("Authorization", `Bearer ${SESS}`)
      .send({
        applicationType: "website",
        status: "link_clicked",
        roleId: 42,
        companyName: "Example NHS Trust",
        jobTitle: "Band 5 Nurse",
        applicationUrl: "https://jobs.example.nhs.uk/roles/42",
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe("link_clicked");
    expect(insertValues).toEqual([expect.objectContaining({
      userId: "cand-1",
      roleId: 42,
      applicationType: "website",
      companyName: "Example NHS Trust",
      jobTitle: "Band 5 Nurse",
      applicationUrl: "https://jobs.example.nhs.uk/roles/42",
      status: "link_clicked",
      jobsageEmail: "jane.doe.abc123@mail.jobsage.co.uk",
    })]);
  });

  it("persists the extension jobTitle and maps pageUrl to applicationUrl", async () => {
    appResults.push(
      [],
      [{
        id: 13,
        userId: "cand-1",
        roleId: 0,
        applicationType: "website",
        companyName: "Example Trust",
        jobTitle: "Clinical Pharmacist",
        applicationUrl: "https://apply.example.org/confirmation",
        status: "applied",
        appliedAt: new Date(),
        cvDocumentId: null,
      }],
    );
    const app = buildApp();
    const res = await request(app)
      .post("/applications")
      .set("Authorization", `Bearer ${SESS}`)
      .send({
        applicationType: "website",
        status: "applied",
        companyName: "Example Trust",
        jobTitle: "Clinical Pharmacist",
        pageUrl: "https://apply.example.org/confirmation",
      });

    expect(res.status).toBe(201);
    expect(insertValues).toEqual([expect.objectContaining({
      jobTitle: "Clinical Pharmacist",
      applicationUrl: "https://apply.example.org/confirmation",
      status: "applied",
      jobsageEmail: "jane.doe.abc123@mail.jobsage.co.uk",
    })]);
  });

  it("reuses one website row when the same URL is clicked then confirmed", async () => {
    const url = "https://jobs.example.nhs.uk/roles/42";
    const existingClick = {
      id: 14,
      userId: "cand-1",
      roleId: 42,
      applicationType: "website",
      companyName: "Example NHS Trust",
      jobTitle: "Band 5 Nurse",
      applicationUrl: url,
      status: "link_clicked",
      appliedAt: new Date(),
      cvDocumentId: null,
      notes: null,
      jobsageEmail: "jane.doe.abc123@mail.jobsage.co.uk",
    };
    appResults.push(
      [],
      [existingClick],
      [{ ...existingClick, status: "applied" }],
    );
    const app = buildApp();

    const first = await request(app)
      .post("/applications")
      .set("Authorization", `Bearer ${SESS}`)
      .send({
        applicationType: "website",
        status: "link_clicked",
        roleId: 42,
        companyName: "Example NHS Trust",
        jobTitle: "Band 5 Nurse",
        applicationUrl: url,
      });
    const second = await request(app)
      .post("/applications")
      .set("Authorization", `Bearer ${SESS}`)
      .send({
        applicationType: "website",
        status: "applied",
        companyName: "Example NHS Trust",
        jobTitle: "Band 5 Nurse",
        pageUrl: url,
      });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(insertValues).toHaveLength(1);
    expect(updateSets).toEqual([expect.objectContaining({
      applicationUrl: url,
      jobTitle: "Band 5 Nurse",
      status: "applied",
      jobsageEmail: "jane.doe.abc123@mail.jobsage.co.uk",
    })]);
  });

  it("upgrades an original JOBSAGE click after a different confirmation-page URL without replacing its vacancy metadata", async () => {
    const outboundUrl = "https://jobs.example.nhs.uk/roles/42?ref=jobsage";
    const confirmationUrl = "https://apply.example.org/thank-you";
    const existingClick = {
      id: 16,
      userId: "cand-1",
      roleId: 42,
      applicationType: "website",
      companyName: "Example NHS Trust",
      jobTitle: "Band 5 Nurse",
      applicationUrl: outboundUrl,
      status: "link_clicked",
      appliedAt: new Date(),
      cvDocumentId: null,
      notes: null,
      jobsageEmail: null,
    };
    appResults.push(
      [existingClick],
      [{ ...existingClick, status: "applied" }],
    );
    const app = buildApp();

    const response = await request(app)
      .post("/applications")
      .set("Authorization", `Bearer ${SESS}`)
      .send({
        applicationType: "website",
        status: "applied",
        applicationUrl: outboundUrl,
        pageUrl: confirmationUrl,
        companyName: "Application submitted",
        jobTitle: "Thank you for applying",
      });

    expect(response.status).toBe(200);
    expect(updateSets).toEqual([expect.objectContaining({
      roleId: 42,
      companyName: "Example NHS Trust",
      jobTitle: "Band 5 Nurse",
      applicationUrl: outboundUrl,
      status: "applied",
      jobsageEmail: "jane.doe.abc123@mail.jobsage.co.uk",
    })]);
    expect(insertValues).toHaveLength(0);
  });

  it("creates only one row when the same website URL is clicked twice", async () => {
    const url = "https://jobs.example.nhs.uk/roles/43";
    const clickRecord = {
      id: 15,
      userId: "cand-1",
      roleId: 43,
      applicationType: "website",
      companyName: "Example NHS Trust",
      jobTitle: "Band 6 Nurse",
      applicationUrl: url,
      status: "link_clicked",
      appliedAt: new Date(),
      cvDocumentId: null,
      notes: null,
      jobsageEmail: "jane.doe.abc123@mail.jobsage.co.uk",
    };
    appResults.push(
      [],
      [clickRecord],
      [clickRecord],
      [clickRecord],
    );
    const app = buildApp();
    const payload = {
      applicationType: "website",
      status: "link_clicked",
      roleId: 43,
      companyName: "Example NHS Trust",
      jobTitle: "Band 6 Nurse",
      applicationUrl: url,
    };

    const first = await request(app)
      .post("/applications")
      .set("Authorization", `Bearer ${SESS}`)
      .send(payload);
    const second = await request(app)
      .post("/applications")
      .set("Authorization", `Bearer ${SESS}`)
      .send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(insertValues).toHaveLength(1);
    expect(updateSets).toEqual([expect.objectContaining({
      applicationUrl: url,
      status: "link_clicked",
    })]);
  });
});

describe("PATCH /applications/:id/status", () => {
  beforeEach(() => { appResults.length = 0; });

  it("returns 401 when not authenticated", async () => {
    const { getSession } = await import("../../lib/auth");
    (getSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const app = buildApp();
    const res = await request(app)
      .patch("/applications/1/status")
      .set("Authorization", "Bearer no-auth");
    expect(res.status).toBe(401);
  });
});

describe("POST /applications/confirm-submission", () => {
  beforeEach(() => {
    appResults.length = 0;
    insertValues.length = 0;
    updateSets.length = 0;
  });

  it("upgrades the matching JOBSAGE click without replacing its metadata", async () => {
    const outboundUrl = "https://jobs.example.nhs.uk/roles/42?ref=jobsage";
    const existingClick = {
      id: 21,
      userId: "cand-1",
      roleId: 42,
      applicationType: "website",
      companyName: "Example NHS Trust",
      jobTitle: "Band 5 Nurse",
      applicationUrl: outboundUrl,
      status: "link_clicked",
      appliedAt: new Date(),
      cvDocumentId: null,
      notes: null,
    };
    appResults.push(
      [existingClick],
      [{ ...existingClick, status: "applied" }],
    );

    const response = await request(buildApp())
      .post("/applications/confirm-submission")
      .set("Authorization", `Bearer ${SESS}`)
      .send({ applicationUrl: outboundUrl });

    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(true);
    expect(response.body.application.status).toBe("applied");
    expect(updateSets).toEqual([{
      status: "applied",
      jobsageEmail: "jane.doe.abc123@mail.jobsage.co.uk",
    }]);
    expect(insertValues).toHaveLength(0);
  });

  it("is idempotent and never downgrades a later application status", async () => {
    const outboundUrl = "https://jobs.example.nhs.uk/roles/42?ref=jobsage";
    const progressedApplication = {
      id: 22,
      userId: "cand-1",
      roleId: 42,
      applicationType: "website",
      companyName: "Example NHS Trust",
      jobTitle: "Band 5 Nurse",
      applicationUrl: outboundUrl,
      status: "interview_invited",
      appliedAt: new Date(),
      cvDocumentId: null,
      notes: null,
    };
    appResults.push([progressedApplication]);

    const response = await request(buildApp())
      .post("/applications/confirm-submission")
      .set("Authorization", `Bearer ${SESS}`)
      .send({ applicationUrl: outboundUrl });

    expect(response.status).toBe(200);
    expect(response.body.updated).toBe(false);
    expect(response.body.application.status).toBe("interview_invited");
    expect(updateSets).toHaveLength(0);
    expect(insertValues).toHaveLength(0);
  });

  it("does not create an applied record when no tracked outbound click exists", async () => {
    appResults.push([]);

    const response = await request(buildApp())
      .post("/applications/confirm-submission")
      .set("Authorization", `Bearer ${SESS}`)
      .send({ applicationUrl: "https://jobs.example.nhs.uk/roles/unknown?ref=jobsage" });

    expect(response.status).toBe(404);
    expect(response.body.error).toMatch(/No tracked JOBSAGE application/i);
    expect(updateSets).toHaveLength(0);
    expect(insertValues).toHaveLength(0);
  });

  it("rejects malformed confirmation URLs", async () => {
    const response = await request(buildApp())
      .post("/applications/confirm-submission")
      .set("Authorization", `Bearer ${SESS}`)
      .send({ applicationUrl: "not-a-url" });

    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/valid HTTP/i);
  });
});
