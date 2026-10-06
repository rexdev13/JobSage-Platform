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
  reviewedImportPreview: vi.fn(),
  reviewedImportApply: vi.fn(),
  reviewedImportRepair: vi.fn(),
  queueCompanySiteVerification: vi.fn(),
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
vi.mock("../../lib/healthcareCompanySiteBatch", () => ({
  runHealthcareCompanySiteBatch: mocks.healthcareBatch,
}));
vi.mock("../../lib/reviewedCompanySiteImport", () => ({
  previewReviewedCompanySiteCsv: mocks.reviewedImportPreview,
  applyReviewedCompanySiteCsv: mocks.reviewedImportApply,
  repairReviewedCompanySiteEvidence: mocks.reviewedImportRepair,
  REVIEWED_COMPANY_SITE_IMPORT_CONFIRMATION: "apply-reviewed-company-site-vacancy-import",
  REVIEWED_COMPANY_SITE_IMPORT_REPAIR_CONFIRMATION: "repair-reviewed-company-site-import-visibility",
  REVIEWED_COMPANY_SITE_IMPORT_MAX_BYTES: 1_000_000,
  ReviewedCompanySiteImportInputError: class extends Error {},
  ReviewedCompanySiteImportTokenError: class extends Error {},
  ReviewedCompanySiteEvidenceRepairError: class extends Error {},
}));
vi.mock("../../lib/companySiteVerification", () => ({
  queueCompanySiteVerificationBatch: mocks.queueCompanySiteVerification,
}));
const { default: router } = await import("../../routes/internalCompanySiteWorkflow");
const app = express();
app.use(express.json());
app.use(router);

describe("internal company-site workflow routes", () => {
  const original = process.env.VACANCY_JOB_SECRET;
  const originalReviewedImportFlag = process.env.COMPANY_SITE_REVIEWED_IMPORT_ENABLED;
  beforeEach(() => {
    process.env.VACANCY_JOB_SECRET = "test-job-secret";
    process.env.COMPANY_SITE_REVIEWED_IMPORT_ENABLED = "true";
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
    mocks.reviewedImportPreview.mockResolvedValue({
      mode: "dry-run",
      environment: "development",
      inputSha256: "file-hash",
      planHash: "plan-hash",
      rows: [],
      counts: { sourceRows: 0, wouldInsert: 0, inserted: 0, alreadyPresent: 0, held: 0, notImported: 0 },
      dryRunToken: "signed-preview-token",
      tokenExpiresAt: "2026-10-06T08:00:00.000Z",
    });
    mocks.reviewedImportApply.mockResolvedValue({
      mode: "apply",
      environment: "development",
      inputSha256: "file-hash",
      rows: [],
      counts: { sourceRows: 0, wouldInsert: 0, inserted: 0, alreadyPresent: 0, held: 0, notImported: 0 },
    });
    mocks.reviewedImportRepair.mockResolvedValue({
      mode: "evidence_repair",
      environment: "production",
      applyReportId: "54cd3a9d-f189-4dc2-ac16-e91f2e8afcb0",
      inputSha256: "file-hash",
      counts: { insertedRows: 158, evidenceUpdated: 158, verificationQueued: 17 },
      rows: [],
      verificationQueue: [{ id: 1, url: "https://example.org/jobs/nurse" }],
    });
    mocks.queueCompanySiteVerification.mockClear();
  });
  afterEach(() => {
    if (original == null) delete process.env.VACANCY_JOB_SECRET;
    else process.env.VACANCY_JOB_SECRET = original;
    if (originalReviewedImportFlag == null) delete process.env.COMPANY_SITE_REVIEWED_IMPORT_ENABLED;
    else process.env.COMPANY_SITE_REVIEWED_IMPORT_ENABLED = originalReviewedImportFlag;
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

  it("requires the exact repair confirmation and queues only the verified repair result", async () => {
    const header = { "x-jobsage-job-secret": "test-job-secret" };
    const applyReportId = "54cd3a9d-f189-4dc2-ac16-e91f2e8afcb0";
    const rejected = await request(app)
      .post("/internal/company-site-vacancies/reviewed-import/repair-visibility")
      .set(header)
      .field("applyReportId", applyReportId)
      .field("confirmRepair", "wrong-confirmation")
      .attach("file", Buffer.from("source_row\n1\n"), {
        filename: "reviewed.csv",
        contentType: "text/csv",
      });
    expect(rejected.status).toBe(400);
    expect(mocks.reviewedImportRepair).not.toHaveBeenCalled();

    const response = await request(app)
      .post("/internal/company-site-vacancies/reviewed-import/repair-visibility")
      .set(header)
      .field("applyReportId", applyReportId)
      .field("confirmRepair", "repair-reviewed-company-site-import-visibility")
      .attach("file", Buffer.from("source_row\n1\n"), {
        filename: "reviewed.csv",
        contentType: "text/csv",
      });

    expect(response.status).toBe(200);
    expect(response.body.workflow).toBe("reviewed_explicit_company_site_vacancy_visibility_repair");
    expect(mocks.reviewedImportRepair).toHaveBeenCalledWith(
      expect.any(Buffer),
      applyReportId,
      expect.objectContaining({ reportId: "report-id" }),
    );
    expect(mocks.queueCompanySiteVerification).toHaveBeenCalledWith([
      { id: 1, url: "https://example.org/jobs/nurse" },
    ]);
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
      expect(mocks.healthcareBatch).toHaveBeenCalledWith({
        employers,
        apply: false,
        applyMode: "reviewed",
        sector: "healthcare",
        budgetMs: 240_000,
      });
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
      expect(mocks.healthcareBatch).toHaveBeenCalledWith({
        employers,
        apply: true,
        applyMode: "reviewed",
        sector: "healthcare",
        budgetMs: 240_000,
      });
    });

    it("accepts scheduled apply confirmation and forwards applyMode", async () => {
      mocks.healthcareBatch.mockResolvedValue({
        apply: true,
        accepted: 1,
        inserted: 1,
        repeatInserted: 0,
        scheduledApplyBlocked: null,
      });
      const response = await request(app).post("/internal/healthcare-company-site-batch").set(header).send({
        employers,
        apply: true,
        confirmApply: "scheduled-apply-named-company-site-batch",
      });
      expect(response.status).toBe(200);
      expect(mocks.healthcareBatch).toHaveBeenCalledWith({
        employers,
        apply: true,
        applyMode: "scheduled",
        sector: "healthcare",
        budgetMs: 240_000,
      });
    });

    it("forwards a named sector and refuses an unknown one", async () => {
      const response = await request(app).post("/internal/healthcare-company-site-batch").set(header).send({
        employers,
        sector: "education",
      });
      expect(response.status).toBe(200);
      expect(mocks.healthcareBatch).toHaveBeenCalledWith({
        employers,
        apply: false,
        applyMode: "reviewed",
        sector: "education",
        budgetMs: 240_000,
      });
      expect((await request(app).post("/internal/healthcare-company-site-batch").set(header).send({
        employers,
        sector: "hospitality",
      })).status).toBe(400);
      expect((await request(app).post("/internal/healthcare-company-site-batch").set(header).send({
        employers,
        apply: true,
        sector: "education",
        confirmApply: "apply-reviewed-healthcare-company-site-batch",
      })).status).toBe(400);
    });

    it("accepts the named confirmation string for a non-healthcare sector", async () => {
      mocks.healthcareBatch.mockResolvedValue({
        apply: true,
        accepted: 1,
        inserted: 1,
        repeatInserted: 0,
        scheduledApplyBlocked: null,
      });
      const response = await request(app).post("/internal/healthcare-company-site-batch").set(header).send({
        employers,
        apply: true,
        sector: "education",
        confirmApply: "apply-reviewed-named-company-site-batch",
      });
      expect(response.status).toBe(200);
      expect(mocks.healthcareBatch).toHaveBeenCalledWith({
        employers,
        apply: true,
        applyMode: "reviewed",
        sector: "education",
        budgetMs: 240_000,
      });
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

  describe("explicit reviewed vacancy import", () => {
    const header = { "x-jobsage-job-secret": "test-job-secret" };
    const csv = Buffer.from("source_row\n1\n", "utf8");

    it("fails closed for unauthenticated or disabled requests", async () => {
      const unauthenticated = await request(app)
        .post("/internal/company-site-vacancies/reviewed-import/dry-run")
        .attach("file", csv, { filename: "reviewed.csv", contentType: "text/csv" });
      expect(unauthenticated.status).toBe(401);

      process.env.COMPANY_SITE_REVIEWED_IMPORT_ENABLED = "false";
      const disabled = await request(app)
        .post("/internal/company-site-vacancies/reviewed-import/dry-run")
        .set(header)
        .attach("file", csv, { filename: "reviewed.csv", contentType: "text/csv" });
      expect(disabled.status).toBe(503);
      expect(mocks.reviewedImportPreview).not.toHaveBeenCalled();
    });

    it("returns a read-only preview and persists no reusable token in the audit report", async () => {
      const response = await request(app)
        .post("/internal/company-site-vacancies/reviewed-import/dry-run")
        .set(header)
        .attach("file", csv, { filename: "reviewed.csv", contentType: "text/csv" });

      expect(response.status).toBe(200);
      expect(response.body.dryRunToken).toBe("signed-preview-token");
      expect(mocks.reviewedImportPreview).toHaveBeenCalledWith(csv);
      expect(mocks.save).toHaveBeenCalledWith(
        "dry-run",
        expect.objectContaining({
          workflow: "reviewed_explicit_company_site_vacancy_import",
          uploadedSponsorAndDatabaseIdsIgnored: true,
        }),
      );
      expect(mocks.save.mock.calls[0]?.[1]).not.toHaveProperty("dryRunToken");
    });

    it("requires both the exact confirmation and a matching preview token to apply", async () => {
      const missingConfirmation = await request(app)
        .post("/internal/company-site-vacancies/reviewed-import/apply")
        .set(header)
        .field("dryRunToken", "signed-preview-token")
        .attach("file", csv, { filename: "reviewed.csv", contentType: "text/csv" });
      expect(missingConfirmation.status).toBe(400);
      expect(mocks.reviewedImportApply).not.toHaveBeenCalled();

      const response = await request(app)
        .post("/internal/company-site-vacancies/reviewed-import/apply")
        .set(header)
        .field("confirmApply", "apply-reviewed-company-site-vacancy-import")
        .field("dryRunToken", "signed-preview-token")
        .attach("file", csv, { filename: "reviewed.csv", contentType: "text/csv" });

      expect(response.status).toBe(200);
      expect(mocks.reviewedImportApply).toHaveBeenCalledWith(csv, "signed-preview-token");
      expect(mocks.save).toHaveBeenCalledWith(
        "apply",
        expect.objectContaining({ workflow: "reviewed_explicit_company_site_vacancy_import" }),
      );
    });
  });
});