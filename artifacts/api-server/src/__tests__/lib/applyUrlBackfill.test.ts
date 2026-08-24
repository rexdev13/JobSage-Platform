import { describe, it, expect, vi, beforeEach } from "vitest";

// ── DB mock ──────────────────────────────────────────────────────────────────
const mockDbSelect = vi.fn();
const mockDbUpdate = vi.fn();
const mockDbInsert = vi.fn();

// Shared state accessible both inside vi.mock factory and test helpers
const _selectState = { nextRows: [] as any[] };

vi.mock("@workspace/db", async () => {
  // Re-import the shared state ref via vi.hoisted trick — instead, use a
  // module-level object that the factory closes over via the outer scope trick.
  // vi.mock factories are hoisted but can access variables declared with
  // vi.hoisted(). Use a plain container object that both scopes reference.
  const state = { nextRows: [] as any[] };
  // Export state so tests can set it
  (globalThis as any).__applyUrlBackfillTestState = state;

  function selectChain(rows: any[] = []) {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(rows),
    };
    return chain;
  }

  function updateChain() {
    const chain: any = {
      set: () => chain,
      where: () => Promise.resolve(),
    };
    return chain;
  }

  function insertChain() {
    const chain: any = {
      values: () => chain,
      catch: () => chain,
      then: (resolve: any) => Promise.resolve(undefined).then(resolve),
    };
    return chain;
  }

  return {
    db: {
      select: (...args: any[]) => {
        mockDbSelect(...args);
        const rows = (globalThis as any).__applyUrlBackfillTestState?.nextRows ?? [];
        return selectChain(rows);
      },
      update: (...args: any[]) => {
        mockDbUpdate(...args);
        return updateChain();
      },
      insert: (...args: any[]) => {
        mockDbInsert(...args);
        return insertChain();
      },
    },
    rolesTable: {},
    auditEventsTable: {},
  };
});

// ── audit mock ───────────────────────────────────────────────────────────────
const mockWriteAuditEvent = vi.fn().mockResolvedValue(undefined);
vi.mock("../../lib/linkVerification", () => ({
  queueLinkVerification: vi.fn(),
  queueLinkVerificationBatch: vi.fn(),
}));

vi.mock("../../lib/audit", () => ({
  writeAuditEvent: (...args: any[]) => mockWriteAuditEvent(...args),
}));

// ── openai mock ──────────────────────────────────────────────────────────────
const mockOpenAICreate = vi.fn();
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    responses: {
      create: (...args: any[]) => mockOpenAICreate(...args),
    },
  },
}));

// ── helpers ──────────────────────────────────────────────────────────────────
function setNextSelectRows(rows: any[]) {
  (globalThis as any).__applyUrlBackfillTestState = { nextRows: rows };
}

function makeRole(overrides: Partial<{ id: number; title: string; employer: string; location: string }> = {}) {
  return {
    id: overrides.id ?? 1,
    title: overrides.title ?? "Staff Nurse",
    employer: overrides.employer ?? "NHS Trust",
    location: overrides.location ?? "London",
  };
}

function makeAIResponse(url: string | null, found = true) {
  return {
    output_text: JSON.stringify({ found, url }),
  };
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("isValidApplyUrl", () => {
  let isValidApplyUrl: (url: string) => boolean;

  beforeEach(async () => {
    vi.resetModules();
    ({ isValidApplyUrl } = await import("../../lib/applyUrlBackfill"));
  });

  it("accepts a valid employer HTTPS URL", () => {
    expect(isValidApplyUrl("https://careers.nhstrust.nhs.uk/jobs/123")).toBe(true);
  });

  it("accepts a plain http URL", () => {
    expect(isValidApplyUrl("http://jobs.example-hospital.co.uk/apply/456")).toBe(true);
  });

  it("rejects a non-URL string", () => {
    expect(isValidApplyUrl("not-a-url")).toBe(false);
  });

  it("rejects indeed.com", () => {
    expect(isValidApplyUrl("https://www.indeed.com/viewjob?jk=abc123")).toBe(false);
  });

  it("rejects a subdomain of indeed.com", () => {
    expect(isValidApplyUrl("https://uk.indeed.com/viewjob?jk=xyz")).toBe(false);
  });

  it("rejects linkedin.com", () => {
    expect(isValidApplyUrl("https://www.linkedin.com/jobs/view/1234567")).toBe(false);
  });

  it("rejects reed.co.uk", () => {
    expect(isValidApplyUrl("https://www.reed.co.uk/jobs/staff-nurse/123")).toBe(false);
  });

  it("rejects totaljobs.com", () => {
    expect(isValidApplyUrl("https://www.totaljobs.com/job/456")).toBe(false);
  });

  it("rejects a URL that looks like a search-results page (has ?q= param)", () => {
    expect(isValidApplyUrl("https://jobs.example.com/search?q=nurse&location=london")).toBe(false);
  });

  it("rejects a URL with ?keywords= param", () => {
    expect(isValidApplyUrl("https://jobs.example.com/?keywords=nurse")).toBe(false);
  });

  it("rejects ftp:// scheme", () => {
    expect(isValidApplyUrl("ftp://example.com/job")).toBe(false);
  });

  it("rejects glassdoor.com", () => {
    expect(isValidApplyUrl("https://www.glassdoor.com/job-listing/123")).toBe(false);
  });
});

describe("runApplyUrlBackfill", () => {
  beforeEach(() => {
    vi.resetModules();
    mockDbSelect.mockClear();
    mockDbUpdate.mockClear();
    mockDbInsert.mockClear();
    mockWriteAuditEvent.mockClear();
    mockOpenAICreate.mockClear();
    (mockDbSelect as any).__nextRows = [];
  });

  it("saves a valid URL found by AI and writes an audit event", async () => {
    setNextSelectRows([makeRole()]);
    mockOpenAICreate.mockResolvedValueOnce(
      makeAIResponse("https://careers.nhstrust.nhs.uk/jobs/staff-nurse-london"),
    );

    const { runApplyUrlBackfill } = await import("../../lib/applyUrlBackfill");
    const summary = await runApplyUrlBackfill({ batchSize: 5, rateDelayMs: 0, triggeredBy: "manual" });

    expect(summary.found).toBe(1);
    expect(summary.skipped).toBe(0);
    expect(summary.failed).toBe(0);
    expect(mockDbUpdate).toHaveBeenCalled();
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      "system:backfill",
      "apply_url_backfill",
      "role:1",
      expect.objectContaining({ outcome: "url_set", applyUrl: "https://careers.nhstrust.nhs.uk/jobs/staff-nurse-london" }),
    );
  });

  it("skips and audits when AI returns an aggregator URL", async () => {
    setNextSelectRows([makeRole()]);
    mockOpenAICreate.mockResolvedValueOnce(
      makeAIResponse("https://www.indeed.com/viewjob?jk=abc"),
    );

    const { runApplyUrlBackfill } = await import("../../lib/applyUrlBackfill");
    const summary = await runApplyUrlBackfill({ batchSize: 5, rateDelayMs: 0, triggeredBy: "manual" });

    expect(summary.found).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      "system:backfill",
      "apply_url_backfill",
      "role:1",
      expect.objectContaining({ outcome: "skipped_no_url_found" }),
    );
  });

  it("skips and audits when AI returns found:false", async () => {
    setNextSelectRows([makeRole()]);
    mockOpenAICreate.mockResolvedValueOnce(makeAIResponse(null, false));

    const { runApplyUrlBackfill } = await import("../../lib/applyUrlBackfill");
    const summary = await runApplyUrlBackfill({ batchSize: 5, rateDelayMs: 0 });

    expect(summary.found).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      "system:backfill",
      "apply_url_backfill",
      "role:1",
      expect.objectContaining({ outcome: "skipped_no_url_found" }),
    );
  });

  it("counts failure and audits when AI call throws", async () => {
    setNextSelectRows([makeRole()]);
    mockOpenAICreate.mockRejectedValueOnce(new Error("OpenAI timeout"));

    const { runApplyUrlBackfill } = await import("../../lib/applyUrlBackfill");
    const summary = await runApplyUrlBackfill({ batchSize: 5, rateDelayMs: 0 });

    expect(summary.failed).toBe(1);
    expect(summary.found).toBe(0);
    expect(mockDbUpdate).not.toHaveBeenCalled();
    expect(mockWriteAuditEvent).toHaveBeenCalledWith(
      "system:backfill",
      "apply_url_backfill",
      "role:1",
      expect.objectContaining({ outcome: "failed" }),
    );
  });

  it("returns zero counts when there are no roles to process", async () => {
    setNextSelectRows([]);

    const { runApplyUrlBackfill } = await import("../../lib/applyUrlBackfill");
    const summary = await runApplyUrlBackfill({ batchSize: 5, rateDelayMs: 0 });

    expect(summary.total).toBe(0);
    expect(summary.found).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.failed).toBe(0);
    expect(mockOpenAICreate).not.toHaveBeenCalled();
  });

  it("processes multiple roles independently — saves valid, skips invalid", async () => {
    setNextSelectRows([makeRole({ id: 1 }), makeRole({ id: 2 })]);
    mockOpenAICreate
      .mockResolvedValueOnce(makeAIResponse("https://careers.hospital.co.uk/vacancies/staff-nurse-123"))
      .mockResolvedValueOnce(makeAIResponse(null, false));

    const { runApplyUrlBackfill } = await import("../../lib/applyUrlBackfill");
    const summary = await runApplyUrlBackfill({ batchSize: 5, rateDelayMs: 0 });

    expect(summary.found).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(mockDbUpdate).toHaveBeenCalledTimes(1);
    expect(mockWriteAuditEvent).toHaveBeenCalledTimes(2);
  });

  it("stores the last run summary accessible via getLastBackfillSummary", async () => {
    setNextSelectRows([makeRole()]);
    mockOpenAICreate.mockResolvedValueOnce(
      makeAIResponse("https://careers.nhstrust.nhs.uk/jobs/staff-nurse-123"),
    );

    const { runApplyUrlBackfill, getLastBackfillSummary } = await import(
      "../../lib/applyUrlBackfill"
    );
    await runApplyUrlBackfill({ batchSize: 5, rateDelayMs: 0, triggeredBy: "manual" });

    const last = getLastBackfillSummary();
    expect(last).not.toBeNull();
    expect(last!.triggeredBy).toBe("manual");
    expect(last!.found).toBe(1);
  });

  it("rejects a search URL even if domain is not blocked", async () => {
    setNextSelectRows([makeRole()]);
    mockOpenAICreate.mockResolvedValueOnce(
      makeAIResponse("https://careers.example.co.uk/search?keywords=nurse"),
    );

    const { runApplyUrlBackfill } = await import("../../lib/applyUrlBackfill");
    const summary = await runApplyUrlBackfill({ batchSize: 5, rateDelayMs: 0 });

    expect(summary.found).toBe(0);
    expect(summary.skipped).toBe(1);
  });
});
