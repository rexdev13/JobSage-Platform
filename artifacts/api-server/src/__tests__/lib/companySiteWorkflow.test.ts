import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  fetchPage: vi.fn(),
  discover: vi.fn(),
  parseMapping: vi.fn(),
  saveReport: vi.fn(),
  loadReport: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ db: { transaction: mocks.transaction, execute: vi.fn() } }));
vi.mock("../../lib/companySiteHttp", () => ({ fetchCompanySitePage: mocks.fetchPage }));
vi.mock("../../lib/companySiteDiscovery", () => ({ discoverCompanySiteVacancies: mocks.discover }));
vi.mock("../../lib/directEmployerBoardConnectors", () => ({ parseDirectBoardMapping: mocks.parseMapping }));
vi.mock("../../lib/companySiteWorkflowReports", () => ({
  saveWorkflowReport: mocks.saveReport,
  loadWorkflowReport: mocks.loadReport,
}));

const workflow = await import("../../lib/companySiteWorkflow");

function countRow() {
  return { rows: [{ c: "1", v: "0", s: "2", site: "0" }] };
}

describe("company-site workflow safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveReport.mockImplementation(async (kind, data) => ({
      ...data,
      reportId: `${kind}-00000000-0000-4000-8000-000000000000`,
      reportKind: kind,
      generatedAt: new Date().toISOString(),
    }));
    mocks.fetchPage.mockResolvedValue({ ok: true, url: "https://example.org", body: "<html></html>" });
    mocks.discover.mockResolvedValue({
      completion: "complete", atsCompleted: true, advertsExtracted: 2, adverts: [],
    });
  });

  it("runs discovery read-only, rolls back, and fails closed on count drift", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(countRow())
      .mockResolvedValueOnce({ rows: [{
        organisation_name: "Example Employer", website: "https://example.org",
        careers_url: null, ats_provider: null, ats_board_id: null,
        ats_mapping_status: "unverified", ats_mapping_evidence_url: null,
      }] })
      .mockResolvedValueOnce(countRow())
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ c: "2", v: "0", s: "2", site: "0" }] });
    mocks.transaction.mockImplementation(async (callback) => callback({ execute }));
    await expect(workflow.runReadOnlyDiscovery({ limit: 1 })).rejects.toThrow("could not prove unchanged row counts");
    expect(mocks.discover).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(7);
    const sqlCalls = execute.mock.calls.map(([query]) => JSON.stringify(query)).join("\n");
    expect(sqlCalls).toMatch(/READ ONLY/i);
    expect(sqlCalls).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
    expect(mocks.saveReport).toHaveBeenCalledTimes(1);
    expect(mocks.saveReport.mock.calls[0]?.[1]).toMatchObject({
      status: "proof_failed",
      writesAttempted: 0,
      rowCounts: { unchanged: false },
    });
  });

  it("discovers a supported direct feed without issuing database writes", async () => {
    mocks.fetchPage.mockResolvedValue({
      ok: true,
      url: "https://example.org/careers",
      body: '<a href="https://boards.greenhouse.io/example">Careers</a>',
    });
    mocks.parseMapping.mockReturnValue({
      provider: "Greenhouse",
      boardId: "example",
      evidenceUrl: "https://boards.greenhouse.io/example",
    });
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(countRow())
      .mockResolvedValueOnce({ rows: [{
        organisation_name: "Example Employer", website: "https://example.org",
        careers_url: null, ats_provider: null, ats_board_id: null,
        ats_mapping_status: null, ats_mapping_evidence_url: null,
      }] })
      .mockResolvedValueOnce(countRow())
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce(countRow());
    mocks.transaction.mockImplementation(async (callback) => callback({ execute }));

    const report = await workflow.runReadOnlyDiscovery({ limit: 1 });
    const sqlCalls = execute.mock.calls.map(([query]) => JSON.stringify(query)).join("\n");
    expect(report.status).toBe("completed");
    expect(report.verifiedMappingCandidates).toEqual([
      expect.objectContaining({ provider: "Greenhouse", status: "verified_feed" }),
    ]);
    expect(mocks.discover).toHaveBeenCalledWith(
      "Example Employer",
      "https://example.org",
      expect.objectContaining({
        checkGeneric: false,
        directFeedsOnly: true,
        readOnly: true,
        noHostState: true,
        noProcessCache: true,
      }),
    );
    expect(sqlCalls).toMatch(/READ ONLY/i);
    expect(sqlCalls).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
  });

  it("keeps mapping dry-run read-only and records rejected input", async () => {
    mocks.loadReport.mockResolvedValue({
      reportId: "00000000-0000-4000-8000-000000000001", reportKind: "discovery",
      records: [{ organisationName: "Uncertain", status: "uncertain", confidence: "none" }],
    });
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    mocks.transaction.mockImplementation(async (callback) => callback({ execute }));
    const report = await workflow.runMappingDryRun({
      discoveryReportId: "00000000-0000-4000-8000-000000000001",
      reviewed: true,
    });
    expect(report.reviewed).toBe(true);
    expect(report.approvalToken).toMatch(/^[0-9a-f-]{36}$/i);
    expect(report.sourceRecords).toHaveLength(1);
    expect(report.refused).toEqual([expect.objectContaining({
      organisationName: "Uncertain",
      sourceStatus: "uncertain",
    })]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(String(execute.mock.calls[0]?.[0])).not.toContain("UPDATE");
  });

  it("resolves an employer-name alias to the canonical mapping row", async () => {
    mocks.parseMapping.mockReturnValue({
      provider: "Greenhouse",
      boardId: "example",
      evidenceUrl: "https://boards.greenhouse.io/example",
    });
    mocks.loadReport.mockResolvedValue({
      reportId: "00000000-0000-4000-8000-000000000002",
      reportKind: "discovery",
      records: [{
        organisationName: "EXAMPLE EMPLOYER",
        websiteOrigin: "https://example.org",
        provider: "Greenhouse",
        boardId: "example",
        careersUrl: "https://boards.greenhouse.io/example",
        evidenceUrl: "https://example.org/careers",
        status: "verified_feed",
        confidence: "high",
        feedComplete: true,
      }],
    });
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        organisation_name: "Example Employer",
        website: "https://example.org",
      }] })
      .mockResolvedValueOnce({ rows: [{
        organisation_name: "Example Employer",
        ats_provider: null,
        ats_board_id: null,
        ats_mapping_status: "unverified",
        ats_mapping_evidence_url: null,
        careers_url: null,
      }] });
    mocks.transaction.mockImplementation(async (callback) => callback({ execute }));

    const report = await workflow.runMappingDryRun({
      discoveryReportId: "00000000-0000-4000-8000-000000000002",
      reviewed: true,
    });

    expect(report.changes).toEqual([expect.objectContaining({
      organisationName: "Example Employer",
      submittedOrganisationName: "EXAMPLE EMPLOYER",
      status: "dry_run",
    })]);
    expect(report.mappingRowsChanged).toBe(1);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("refuses to dry-run multiple different ATS boards for one employer", async () => {
    mocks.parseMapping.mockImplementation((_provider, url) => ({
      provider: "Greenhouse",
      boardId: String(url).split("/").at(-1),
      evidenceUrl: String(url),
    }));
    mocks.loadReport.mockResolvedValue({
      reportId: "00000000-0000-4000-8000-000000000003",
      reportKind: "discovery",
      records: ["one", "two"].map((boardId) => ({
        organisationName: "Example Employer",
        websiteOrigin: "https://example.org",
        provider: "Greenhouse",
        boardId,
        careersUrl: `https://boards.greenhouse.io/${boardId}`,
        evidenceUrl: "https://example.org/careers",
        status: "verified_feed",
        confidence: "high",
        feedComplete: true,
      })),
    });
    const execute = vi.fn().mockResolvedValue({ rows: [] });
    mocks.transaction.mockImplementation(async (callback) => callback({ execute }));

    const report = await workflow.runMappingDryRun({
      discoveryReportId: "00000000-0000-4000-8000-000000000003",
      reviewed: true,
    });

    expect(report.changes).toEqual([]);
    expect(report.mappingRowsChanged).toBe(0);
    expect(report.refused).toEqual([expect.objectContaining({
      organisationName: "Example Employer",
      reason: "multiple_mapping_candidates_for_employer",
    })]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("rejects an unreviewed report and an incorrect approval token", async () => {
    mocks.loadReport.mockResolvedValueOnce({
      reportId: "dry-1", reportKind: "dry-run", reviewed: false, approvalToken: "right",
    });
    await expect(workflow.runMappingApply({ dryRunReportId: "dry-1", approvalToken: "right" })).rejects.toThrow("reviewed");
    mocks.loadReport.mockResolvedValueOnce({
      reportId: "dry-2", reportKind: "dry-run", reviewed: true, approvalToken: "right",
    });
    await expect(workflow.runMappingApply({ dryRunReportId: "dry-2", approvalToken: "wrong" })).rejects.toThrow("exactly match");
  });

  it("writes only mapping columns after website and before-state checks", async () => {
    mocks.loadReport.mockResolvedValue({
      reportId: "dry-3", reportKind: "dry-run", reviewed: true, approvalToken: "right",
      changes: [{
        organisationName: "Example Employer", websiteOrigin: "https://example.org", status: "dry_run",
        before: { atsProvider: null, atsBoardId: null, atsMappingStatus: "unverified", atsMappingEvidenceUrl: null, careersUrl: null },
        after: { atsProvider: "Greenhouse", atsBoardId: "example", atsMappingStatus: "verified", atsMappingEvidenceUrl: "https://example.org/careers", careersUrl: "https://boards.greenhouse.io/example" },
      }],
    });
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ organisation_name: "Example Employer", website: "https://example.org" }] })
      .mockResolvedValueOnce({ rows: [{
        organisation_name: "Example Employer", ats_provider: null, ats_board_id: null,
        ats_mapping_status: "unverified", ats_mapping_evidence_url: null, careers_url: null,
      }] })
      .mockResolvedValueOnce({ rows: [] });
    mocks.transaction.mockImplementation(async (callback) => callback({ execute }));
    const result = await workflow.runMappingApply({ dryRunReportId: "dry-3", approvalToken: "right" });
    expect(result.status).toBe("committed");
    expect(execute).toHaveBeenCalledTimes(4);
    const updateSql = JSON.stringify(execute.mock.calls[3]?.[0]);
    expect(updateSql).toContain("UPDATE sponsor_licence_company_site_checks");
    expect(updateSql).toContain("ats_mapping_evidence_url");
    expect(updateSql).not.toContain("sponsor_licence_vacancies");
    expect(execute.mock.calls[4]).toBeUndefined();
    expect(mocks.saveReport).toHaveBeenCalledTimes(2);
    expect(mocks.saveReport.mock.calls[0]?.[1]).toMatchObject({ status: "intent_saved" });
    expect(mocks.saveReport.mock.calls[1]?.[1]).toMatchObject({ status: "committed" });
  });
});