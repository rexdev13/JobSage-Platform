import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  discovery: vi.fn(),
  dryRun: vi.fn(),
  apply: vi.fn(),
  load: vi.fn(),
  save: vi.fn(),
  healthcareBatch: vi.fn(),
}));
vi.mock("../../lib/companySiteWorkflow", () => ({
  runReadOnlyDiscovery: mocks.discovery,
  runMappingDryRun: mocks.dryRun,
  runMappingApply: mocks.apply,
}));
vi.mock("../../lib/companySiteWorkflowReports", () => ({
  loadWorkflowReport: mocks.load,
  saveWorkflowReport: mocks.save,
}));
vi.mock("../../lib/healthcareCompanySiteBatch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/healthcareCompanySiteBatch")>()),
  runHealthcareCompanySiteBatch: mocks.healthcareBatch,
}));
const { default: router } = await import("../../routes/internalCompanySiteWorkflow");
const app = express();
app.use(express.json());
app.use(router);

describe("internal company-site workflow routes", () => {
  const original = process.env.VACANCY_JOB_SECRET;
  beforeEach(() => {
    process.env.VACANCY_JOB_SECRET = "test-job-secret";
    mocks.discovery.mockResolvedValue({ reportId: "discovery-id", reportKind: "discovery" });
    mocks.dryRun.mockResolvedValue({ reportId: "dry-id", reportKind: "dry-run" });
    mocks.apply.mockResolvedValue({ reportId: "apply-id", reportKind: "apply" });
    mocks.load.mockResolvedValue({ reportId: "report-id", reportKind: "discovery" });
    mocks.save.mockImplementation(async (reportKind: string, data: Record<string, unknown>) => ({
      ...data,
      reportId: "batch-id",
      reportKind,
      generatedAt: "2026-09-29T00:00:00.000Z",
    }));
    mocks.healthcareBatch.mockResolvedValue({ apply: false, accepted: 1, inserted: 0 });
  });
  afterEach(() => {
    if (original == null) delete process.env.VACANCY_JOB_SECRET;
    else process.env.VACANCY_JOB_SECRET = original;
    vi.clearAllMocks();
  });
  it("fails closed without the secret or header", async () => {
    delete process.env.VACANCY_JOB_SECRET;
    expect((await request(app).post("/internal/company-site-discovery/read-only").send({ limit: 5 })).status).toBe(503);
    process.env.VACANCY_JOB_SECRET = "test-job-secret";
    expect((await request(app).post("/internal/company-site-discovery/read-only").send({ limit: 5 })).status).toBe(401);
    expect(mocks.discovery).not.toHaveBeenCalled();
  });
  it("requires the exact secret on every operation and forwards bodies", async () => {
    const header = { "x-jobsage-job-secret": "test-job-secret" };
    expect((await request(app).post("/internal/company-site-discovery/read-only").set(header).send({ limit: 5 })).status).toBe(200);
    expect((await request(app).post("/internal/company-site-mappings/dry-run").set(header).send({ discoveryReportId: "discovery-id" })).status).toBe(200);
    expect((await request(app).post("/internal/company-site-mappings/apply").set(header).send({ dryRunReportId: "dry-id", approvalToken: "approved-token" })).status).toBe(200);
    expect((await request(app).get("/internal/company-site-workflow/reports/report-id").set(header)).status).toBe(200);
    expect(mocks.discovery).toHaveBeenCalledWith({ limit: 5 });
    expect(mocks.dryRun).toHaveBeenCalledWith({ discoveryReportId: "discovery-id" });
    expect(mocks.apply).toHaveBeenCalledWith({ dryRunReportId: "dry-id", approvalToken: "approved-token" });
  });

  it("accepts an authenticated reviewed JSON mapping file", async () => {
    const records = [{
      organisationName: "Example Employer",
      websiteOrigin: "https://example.org",
      status: "verified_feed",
      confidence: "high",
      feedComplete: true,
      provider: "Greenhouse",
      boardId: "example",
      careersUrl: "https://boards.greenhouse.io/example",
      evidenceUrl: "https://example.org/careers",
    }];
    const response = await request(app)
      .post("/internal/company-site-mappings/dry-run")
      .set({ "x-jobsage-job-secret": "test-job-secret" })
      .field("reviewed", "true")
      .attach("file", Buffer.from(JSON.stringify({ records })), {
        filename: "reviewed-mappings.json",
        contentType: "application/json",
      });

    expect(response.status).toBe(200);
    expect(mocks.dryRun).toHaveBeenCalledWith({
      reviewed: true,
      reviewedMappingFile: { records },
    });
  });

  describe("healthcare company-site batch", () => {
    const header = { "x-jobsage-job-secret": "test-job-secret" };
    const employers = [{
      organisationName: "Kingsley Healthcare Limited",
      website: "https://www.kingsleyhealthcare.co.uk",
      careersUrl: "https://careers.kingsleyhealthcare.co.uk/vacancies",
    }];

    it("rejects unauthenticated and malformed requests before running anything", async () => {
      expect((await request(app).post("/internal/healthcare-company-site-batch").send({ employers })).status).toBe(401);
      expect((await request(app).post("/internal/healthcare-company-site-batch").set(header).send({})).status).toBe(400);
      expect((await request(app).post("/internal/healthcare-company-site-batch").set(header).send({
        employers: [{ organisationName: "X", website: "http://insecure.example", careersUrl: "https://insecure.example/jobs" }],
      })).status).toBe(400);
      expect(mocks.healthcareBatch).not.toHaveBeenCalled();
    });

    it("runs a dry-run by default and saves the report", async () => {
      const response = await request(app).post("/internal/healthcare-company-site-batch").set(header).send({ employers });
      expect(response.status).toBe(200);
      expect(response.body.reportId).toBe("batch-id");
      expect(response.body.reportKind).toBe("dry-run");
      expect(mocks.healthcareBatch).toHaveBeenCalledWith({ employers, apply: false, budgetMs: 240_000 });
    });

    it("refuses apply without the exact confirmation string", async () => {
      expect((await request(app).post("/internal/healthcare-company-site-batch").set(header).send({ employers, apply: true })).status).toBe(400);
      expect((await request(app).post("/internal/healthcare-company-site-batch").set(header).send({ employers, apply: true, confirmApply: "yes" })).status).toBe(400);
      expect(mocks.healthcareBatch).not.toHaveBeenCalled();
      mocks.healthcareBatch.mockResolvedValue({ apply: true, accepted: 1, inserted: 1, repeatInserted: 0 });
      const response = await request(app).post("/internal/healthcare-company-site-batch").set(header).send({
        employers,
        apply: true,
        confirmApply: "apply-reviewed-healthcare-company-site-batch",
      });
      expect(response.status).toBe(200);
      expect(response.body.reportKind).toBe("apply");
      expect(mocks.healthcareBatch).toHaveBeenCalledWith({ employers, apply: true, budgetMs: 240_000 });
    });
  });

  it("authenticates before parsing a reviewed mapping upload", async () => {
    const response = await request(app)
      .post("/internal/company-site-mappings/dry-run")
      .attach("file", Buffer.from(JSON.stringify({ records: [] })), {
        filename: "reviewed-mappings.json",
        contentType: "application/json",
      });

    expect(response.status).toBe(401);
    expect(mocks.dryRun).not.toHaveBeenCalled();
  });
});