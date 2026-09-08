import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted shared state ──────────────────────────────────────────────────────
const { executeMock, updateMock, dbUpdateState } = vi.hoisted(() => {
  const dbUpdateState = {
    setCalls: [] as Array<{ set: any; whereArg: any }>,
  };
  return {
    executeMock: vi.fn(async () => ({ rows: [] as any[] })),
    updateMock: vi.fn(),
    dbUpdateState,
  };
});

// ── @workspace/db mock ────────────────────────────────────────────────────────
vi.mock("@workspace/db", () => {
  function updateChain(table: any) {
    const captured: { set?: any; whereArg?: any } = {};
    let pending: Promise<unknown> = Promise.resolve();
    const chain: any = {
      set: (s: any) => {
        captured.set = s;
        return chain;
      },
      where: (w: any) => {
        captured.whereArg = w;
        pending = Promise.resolve(updateMock(table, captured.set, w));
        return chain;
      },
      catch: (fn: any) => {
        pending = pending.catch(fn);
        return chain;
      },
      then: (resolve: any, reject: any) => pending.then(resolve, reject),
    };
    return chain;
  }

  const sponsorLicenceVacanciesTable = { __name: "sponsor_licence_vacancies" };
  const rolesTable = { __name: "roles" };
  const jobListingsTable = { __name: "job_listings" };

  return {
    db: {
      execute: executeMock,
      update: (table: any) => updateChain(table),
    },
    sponsorLicenceVacanciesTable,
    rolesTable,
    jobListingsTable,
  };
});

// ── node-cron mock ────────────────────────────────────────────────────────────
vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));

// ── linkHealth mock ───────────────────────────────────────────────────────────
const { checkDestinationDeadMock } = vi.hoisted(() => ({
  checkDestinationDeadMock: vi.fn(),
}));
vi.mock("../../lib/linkHealth", () => ({
  checkDestinationDead: checkDestinationDeadMock,
}));

const { verifyCompanySiteStoredLinkMock } = vi.hoisted(() => ({
  verifyCompanySiteStoredLinkMock: vi.fn(),
}));
vi.mock("../../lib/companySiteVerification", () => ({
  verifyCompanySiteStoredLink: verifyCompanySiteStoredLinkMock,
}));

// ── vacancyUrlPolicy mock ─────────────────────────────────────────────────────
const { isBlockedVacancyUrlMock, isValidJobBoardVacancyDeepLinkMock } = vi.hoisted(() => ({
  isBlockedVacancyUrlMock: vi.fn().mockReturnValue(false),
  isValidJobBoardVacancyDeepLinkMock: vi.fn().mockReturnValue(false),
}));
vi.mock("../../lib/vacancyUrlPolicy", () => ({
  isBlockedVacancyUrl: isBlockedVacancyUrlMock,
  isValidJobBoardVacancyDeepLink: isValidJobBoardVacancyDeepLinkMock,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeSweepRow(
  source: "sponsor_vacancy" | "role" | "job_listing",
  id: number,
  url: string,
  lastVerifiedAt: string | null = null,
  sourceType: "job_board" | "company_site" | null = null,
) {
  return { source, source_type: sourceType, id, url, last_verified_at: lastVerifiedAt };
}

function setExecuteRows(rows: any[]) {
  executeMock.mockResolvedValueOnce({ rows });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("runVacancyLivenessSweep", () => {
  beforeEach(() => {
    vi.resetModules();
    executeMock.mockReset();
    updateMock.mockReset();
    checkDestinationDeadMock.mockReset();
    verifyCompanySiteStoredLinkMock.mockReset();
    isBlockedVacancyUrlMock.mockReset().mockReturnValue(false);
  });

  it("returns zero counters when no rows are due", async () => {
    setExecuteRows([]);
    const { runVacancyLivenessSweep } = await import("../../lib/vacancyLivenessSweep");
    const result = await runVacancyLivenessSweep();
    expect(result).toEqual({ checked: 0, live: 0, dead: 0, inconclusive: 0, remaining: 0 });
    expect(checkDestinationDeadMock).not.toHaveBeenCalled();
  });

  it("routes stale company-site sponsor links through the controlled verifier", async () => {
    setExecuteRows([
      makeSweepRow(
        "sponsor_vacancy",
        70,
        "https://careers.example.org/jobs/nurse-70",
        "2026-08-01T00:00:00Z",
        "company_site",
      ),
    ]);
    verifyCompanySiteStoredLinkMock.mockResolvedValue("live");

    const { runVacancyLivenessSweep } = await import("../../lib/vacancyLivenessSweep");
    const result = await runVacancyLivenessSweep({ domainConcurrency: 1 });

    expect(verifyCompanySiteStoredLinkMock).toHaveBeenCalledWith(
      70,
      "https://careers.example.org/jobs/nurse-70",
      undefined,
    );
    expect(checkDestinationDeadMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ checked: 1, live: 1 });
  });

  it("never-verified rows sort first (SQL uses NULLS FIRST)", async () => {
    // The SQL in selectSweepBatch uses ORDER BY last_verified_at ASC NULLS FIRST.
    // Here we verify that the execute call is made (i.e. the query runs), and that
    // the batch is processed. Ordering is enforced by the SQL string itself.
    const rows = [
      makeSweepRow("role", 1, "https://nhs.uk/job/1", null), // never verified → first
      makeSweepRow("role", 2, "https://nhs.uk/job/2", "2024-01-01T00:00:00Z"),
    ];
    setExecuteRows(rows);
    checkDestinationDeadMock.mockResolvedValue({ verdict: "live", reason: null });

    const { runVacancyLivenessSweep } = await import("../../lib/vacancyLivenessSweep");
    const result = await runVacancyLivenessSweep({ domainConcurrency: 1 });

    expect(executeMock).toHaveBeenCalledTimes(2);
    // Both rows processed
    expect(result?.checked).toBe(2);
    expect(result?.live).toBe(2);
    expect(result?.dead).toBe(0);
    // linkHealth called with both URLs, first call is the never-verified row
    const calls = checkDestinationDeadMock.mock.calls.map((c: any[]) => c[0]);
    expect(calls[0]).toBe("https://nhs.uk/job/1");
    expect(calls[1]).toBe("https://nhs.uk/job/2");
  });

  it("uses the 600-link default, prioritises candidate-facing sources, and excludes dead rows", async () => {
    setExecuteRows([]);
    const {
      runVacancyLivenessSweep,
      VACANCY_LIVENESS_BATCH_LIMIT,
      VACANCY_LIVENESS_DOMAIN_CONCURRENCY,
    } = await import("../../lib/vacancyLivenessSweep");

    await runVacancyLivenessSweep();

    expect(VACANCY_LIVENESS_BATCH_LIMIT).toBe(600);
    expect(VACANCY_LIVENESS_DOMAIN_CONCURRENCY).toBe(24);
    const query = (executeMock.mock.calls as unknown[][])[0]?.[0] as
      | { queryChunks?: Array<{ value?: string[] }> }
      | undefined;
    const sqlText = query?.queryChunks?.map((chunk) => chunk.value?.join("") ?? "").join("") ?? String(query);
    expect(sqlText).toContain("WHEN source_type = 'job_board' THEN 0");
    expect(sqlText).toContain("WHEN source_type = 'company_site' THEN 1");
    expect(sqlText.indexOf("source_type = 'job_board'")).toBeLessThan(
      sqlText.indexOf("source_type = 'company_site'"),
    );
    expect(sqlText.match(/liveness <> 'dead'/g)).toHaveLength(3);
  });

  describe("URL dedupe — same (source, url) in batch is only fetched once", () => {
    it("deduplicates sponsor_vacancy rows sharing a URL and propagates verdict via URL-wide update", async () => {
      // Two sponsor_vacancy rows for the same URL (different snapshot dates)
      const rows = [
        makeSweepRow("sponsor_vacancy", 10, "https://employer.co.uk/apply", null),
        makeSweepRow("sponsor_vacancy", 11, "https://employer.co.uk/apply", null),
      ];
      setExecuteRows(rows);
      checkDestinationDeadMock.mockResolvedValue({ verdict: "live", reason: null });

      const { runVacancyLivenessSweep } = await import("../../lib/vacancyLivenessSweep");
      const result = await runVacancyLivenessSweep({ domainConcurrency: 1 });

      // Only one fetch despite two rows with same URL
      expect(checkDestinationDeadMock).toHaveBeenCalledOnce();
      expect(checkDestinationDeadMock).toHaveBeenCalledWith(
        "https://employer.co.uk/apply",
        expect.any(Object),
      );

      // Verdict written once — markResult uses WHERE url = ? for sponsor_vacancy
      // so both snapshot rows get updated in one statement
      expect(updateMock).toHaveBeenCalledOnce();
      const [_table, setArg] = updateMock.mock.calls[0];
      expect(setArg).toMatchObject({ liveness: "live" });

      expect(result?.checked).toBe(1);
      expect(result?.live).toBe(1);
    });

    it("deduplicates role rows sharing a URL and only fetches once", async () => {
      const rows = [
        makeSweepRow("role", 20, "https://nhs.uk/job/99", null),
        makeSweepRow("role", 21, "https://nhs.uk/job/99", null),
      ];
      setExecuteRows(rows);
      checkDestinationDeadMock.mockResolvedValue({ verdict: "dead", reason: "404" });

      const { runVacancyLivenessSweep } = await import("../../lib/vacancyLivenessSweep");
      const result = await runVacancyLivenessSweep({ domainConcurrency: 1 });

      expect(checkDestinationDeadMock).toHaveBeenCalledOnce();
      expect(result?.dead).toBe(1);
      expect(result?.checked).toBe(1);
    });

    it("does NOT deduplicate rows from different sources sharing a URL", async () => {
      // role and job_listing can share a URL — both must be verified independently
      const rows = [
        makeSweepRow("role", 30, "https://careers.org/apply", null),
        makeSweepRow("job_listing", 31, "https://careers.org/apply", null),
      ];
      setExecuteRows(rows);
      checkDestinationDeadMock.mockResolvedValue({ verdict: "live", reason: null });

      const { runVacancyLivenessSweep } = await import("../../lib/vacancyLivenessSweep");
      const result = await runVacancyLivenessSweep({ domainConcurrency: 1 });

      // Different (source, url) keys → two fetches
      expect(checkDestinationDeadMock).toHaveBeenCalledTimes(2);
      expect(result?.checked).toBe(2);
      expect(result?.live).toBe(2);
    });
  });

  describe("aggregator bulk-stamp", () => {
    it("bulk-stamps aggregator URLs without calling linkHealth, counts them as inconclusive", async () => {
      isBlockedVacancyUrlMock.mockImplementation((url: string) =>
        url.includes("linkedin.com"),
      );
      const rows = [
        makeSweepRow("sponsor_vacancy", 1, "https://www.linkedin.com/jobs/view/1"),
        makeSweepRow("sponsor_vacancy", 2, "https://www.linkedin.com/jobs/view/2"),
      ];
      setExecuteRows(rows);

      const { runVacancyLivenessSweep } = await import("../../lib/vacancyLivenessSweep");
      const result = await runVacancyLivenessSweep({ domainConcurrency: 1 });

      // No live HTTP checks for aggregators
      expect(checkDestinationDeadMock).not.toHaveBeenCalled();

      // lastVerifiedAt stamped on both records
      expect(updateMock).toHaveBeenCalled();
      const setArgs = updateMock.mock.calls.map((c: any[]) => c[1]);
      for (const s of setArgs) {
        expect(s).toMatchObject({ lastVerifiedAt: expect.any(Date) });
        expect(s.livenessReason).toMatch(/aggregator/i);
      }

      // Counted under inconclusive (aggregators pre-seed checked & inconclusive)
      expect(result?.checked).toBe(2);
      expect(result?.inconclusive).toBe(2);
      expect(result?.live).toBe(0);
      expect(result?.dead).toBe(0);
    });

    it("handles a mix of aggregator and real URLs: stamps aggregators, fetches real ones", async () => {
      isBlockedVacancyUrlMock.mockImplementation((url: string) =>
        url.includes("indeed.com"),
      );
      const rows = [
        makeSweepRow("sponsor_vacancy", 1, "https://www.indeed.com/viewjob?jk=x"),
        makeSweepRow("role", 2, "https://careers.nhs.uk/apply/42", null),
      ];
      setExecuteRows(rows);
      checkDestinationDeadMock.mockResolvedValue({ verdict: "live", reason: null });

      const { runVacancyLivenessSweep } = await import("../../lib/vacancyLivenessSweep");
      const result = await runVacancyLivenessSweep({ domainConcurrency: 1 });

      expect(checkDestinationDeadMock).toHaveBeenCalledOnce();
      expect(checkDestinationDeadMock).toHaveBeenCalledWith(
        "https://careers.nhs.uk/apply/42",
        expect.any(Object),
      );
      expect(result?.checked).toBe(2);
      expect(result?.inconclusive).toBe(1); // aggregator
      expect(result?.live).toBe(1); // real URL
    });
  });

  describe("verdict propagation", () => {
    it("marks row dead and stores the reason when verdict is dead", async () => {
      setExecuteRows([makeSweepRow("role", 5, "https://dead.example.com/job")]);
      checkDestinationDeadMock.mockResolvedValue({ verdict: "dead", reason: "HTTP 404" });

      const { runVacancyLivenessSweep } = await import("../../lib/vacancyLivenessSweep");
      const result = await runVacancyLivenessSweep({ domainConcurrency: 1 });

      const [_table, setArg] = updateMock.mock.calls[0];
      expect(setArg).toMatchObject({
        liveness: "dead",
        livenessReason: "HTTP 404",
        lastVerifiedAt: expect.any(Date),
      });
      expect(result?.dead).toBe(1);
    });

    it("marks row dead when verdict is unsafe", async () => {
      setExecuteRows([makeSweepRow("job_listing", 7, "https://phishing.example.com/")]);
      checkDestinationDeadMock.mockResolvedValue({ verdict: "unsafe", reason: "phishing detected" });

      const { runVacancyLivenessSweep } = await import("../../lib/vacancyLivenessSweep");
      const result = await runVacancyLivenessSweep({ domainConcurrency: 1 });

      const [_table, setArg] = updateMock.mock.calls[0];
      expect(setArg).toMatchObject({ liveness: "dead" });
      expect(result?.dead).toBe(1);
    });

    it("marks row live and clears reason when link is healthy", async () => {
      setExecuteRows([makeSweepRow("role", 3, "https://careers.nhs.uk/apply/1")]);
      checkDestinationDeadMock.mockResolvedValue({ verdict: "live", reason: null });

      const { runVacancyLivenessSweep } = await import("../../lib/vacancyLivenessSweep");
      const result = await runVacancyLivenessSweep({ domainConcurrency: 1 });

      const [_table, setArg] = updateMock.mock.calls[0];
      expect(setArg).toMatchObject({ liveness: "live", livenessReason: null });
      expect(result?.live).toBe(1);
    });

    it("stamps lastVerifiedAt only (inconclusive) when linkHealth throws", async () => {
      setExecuteRows([makeSweepRow("role", 9, "https://slow.example.com/apply")]);
      checkDestinationDeadMock.mockRejectedValue(new Error("timeout"));

      const { runVacancyLivenessSweep } = await import("../../lib/vacancyLivenessSweep");
      const result = await runVacancyLivenessSweep({ domainConcurrency: 1 });

      // update called with only lastVerifiedAt — no liveness field
      const [_table, setArg] = updateMock.mock.calls[0];
      expect(setArg).toMatchObject({ lastVerifiedAt: expect.any(Date) });
      expect(setArg.liveness).toBeUndefined();
      expect(result?.inconclusive).toBe(1);
    });

    it("marks a malformed URL dead without calling linkHealth", async () => {
      setExecuteRows([makeSweepRow("role", 12, "not-a-url-at-all")]);
      // isBlockedVacancyUrl returns false (default)

      const { runVacancyLivenessSweep } = await import("../../lib/vacancyLivenessSweep");
      await runVacancyLivenessSweep({ domainConcurrency: 1 });

      expect(checkDestinationDeadMock).not.toHaveBeenCalled();
      const [_table, setArg] = updateMock.mock.calls[0];
      expect(setArg).toMatchObject({ liveness: "dead" });
    });
  });

  it("prevents concurrent sweeps from running simultaneously (lock guard)", async () => {
    // First call: return a row that takes time to resolve
    setExecuteRows([makeSweepRow("role", 1, "https://slow.example.com/apply")]);
    let resolveCheck!: () => void;
    checkDestinationDeadMock.mockImplementation(
      () => new Promise((r) => { resolveCheck = () => r({ verdict: "live", reason: null }); }),
    );

    const { runVacancyLivenessSweep } = await import("../../lib/vacancyLivenessSweep");
    const first = runVacancyLivenessSweep({ domainConcurrency: 1 });

    // Small tick so the sweep acquires the lock
    await new Promise((r) => setTimeout(r, 10));

    // Second call while first is in-flight → should return null immediately
    setExecuteRows([]); // wouldn't be consumed anyway
    const second = await runVacancyLivenessSweep({ domainConcurrency: 1 });
    expect(second).toBeNull();

    // Unblock first
    resolveCheck();
    const firstResult = await first;
    expect(firstResult?.checked).toBe(1);

    // After first completes, a fresh sweep can run
    setExecuteRows([]);
    const third = await runVacancyLivenessSweep({ domainConcurrency: 1 });
    expect(third).not.toBeNull();
  });

  it("stops an in-flight verification at the outer deadline and reports deferred work", async () => {
    setExecuteRows([makeSweepRow("role", 1, "https://slow.example.com/apply")]);
    checkDestinationDeadMock.mockImplementation(() => new Promise(() => {}));

    const { runVacancyLivenessSweep } = await import("../../lib/vacancyLivenessSweep");
    const startedAt = Date.now();
    const result = await runVacancyLivenessSweep({
      domainConcurrency: 1,
      batchLimit: 1,
      deadlineMs: startedAt + 30,
    });

    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(result).toMatchObject({
      checked: 0,
      deadlineStopped: true,
      remaining: 2,
      remainingIsLowerBound: true,
    });
  });

  it("stops at the outer deadline when the inconclusive timestamp write stalls", async () => {
    setExecuteRows([makeSweepRow("role", 2, "https://failing.example.com/apply")]);
    checkDestinationDeadMock.mockRejectedValue(new Error("network failure"));
    updateMock.mockImplementation(() => new Promise(() => {}));

    const { runVacancyLivenessSweep } = await import("../../lib/vacancyLivenessSweep");
    const startedAt = Date.now();
    const result = await runVacancyLivenessSweep({
      domainConcurrency: 1,
      deadlineMs: startedAt + 30,
    });

    expect(Date.now() - startedAt).toBeLessThan(250);
    expect(result).toMatchObject({
      checked: 0,
      deadlineStopped: true,
      remaining: 1,
      remainingIsLowerBound: true,
    });
  });

  it("returns an exact zero remaining count for an empty queue", async () => {
    setExecuteRows([]);
    const { runVacancyLivenessSweep } = await import("../../lib/vacancyLivenessSweep");

    await expect(runVacancyLivenessSweep({ deadlineMs: Date.now() + 100 })).resolves.toMatchObject({
      checked: 0,
      remaining: 0,
    });
  });
});

// ── runFullLivenessScan ───────────────────────────────────────────────────────

describe("runFullLivenessScan", () => {
  beforeEach(() => {
    vi.resetModules();
    executeMock.mockReset();
    updateMock.mockReset();
    checkDestinationDeadMock.mockReset();
    isBlockedVacancyUrlMock.mockReset().mockReturnValue(false);
  });

  it("terminates when sweep returns zero checked (no more stale rows)", async () => {
    // First batch: 2 rows. Second batch: empty → loop breaks.
    executeMock
      .mockResolvedValueOnce({
        rows: [makeSweepRow("role", 1, "https://nhs.uk/job/1")],
      })
      .mockResolvedValueOnce({ rows: [] }); // second sweep → empty → done

    checkDestinationDeadMock.mockResolvedValue({ verdict: "live", reason: null });

    const { runFullLivenessScan } = await import("../../lib/vacancyLivenessSweep");
    const totals = await runFullLivenessScan();

    expect(totals.checked).toBe(1);
    expect(totals.live).toBe(1);
    // Exactly 2 execute calls: one with data, one empty that triggers break
    expect(executeMock).toHaveBeenCalledTimes(2);
  });

  it("accumulates counters across multiple batches", async () => {
    // Batch 1: 2 rows; Batch 2: 1 row; Batch 3: empty → done
    executeMock
      .mockResolvedValueOnce({
        rows: [
          makeSweepRow("role", 1, "https://a.example.com/1"),
          makeSweepRow("role", 2, "https://b.example.com/2"),
        ],
      })
      .mockResolvedValueOnce({
        rows: [makeSweepRow("role", 3, "https://c.example.com/3")],
      })
      .mockResolvedValueOnce({ rows: [] });

    checkDestinationDeadMock
      .mockResolvedValueOnce({ verdict: "live", reason: null })
      .mockResolvedValueOnce({ verdict: "dead", reason: "410 Gone" })
      .mockResolvedValueOnce({ verdict: "live", reason: null });

    const { runFullLivenessScan } = await import("../../lib/vacancyLivenessSweep");
    const totals = await runFullLivenessScan();

    expect(totals.checked).toBe(3);
    expect(totals.live).toBe(2);
    expect(totals.dead).toBe(1);
    expect(totals.inconclusive).toBe(0);
  });

  it("rejects if a scan is already running", async () => {
    // First call: hangs on db.execute
    let resolveExec!: () => void;
    executeMock.mockImplementationOnce(
      () => new Promise((r) => { resolveExec = () => r({ rows: [] }); }),
    );

    const { runFullLivenessScan } = await import("../../lib/vacancyLivenessSweep");
    const first = runFullLivenessScan();
    await new Promise((r) => setTimeout(r, 10));

    await expect(runFullLivenessScan()).rejects.toThrow(/already running/i);

    // Unblock
    resolveExec();
    await first;
  });

  it("updates isRunning/startedAt/finishedAt on getFullScanStatus across the lifecycle", async () => {
    // Use a deferred mock so the sweep is visibly in-flight when we check status.
    let resolveCheck!: () => void;
    executeMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveCheck = () => r({ rows: [] });
        }),
    );

    const { runFullLivenessScan, getFullScanStatus } = await import(
      "../../lib/vacancyLivenessSweep"
    );

    expect(getFullScanStatus().isRunning).toBe(false);
    const promise = runFullLivenessScan();

    // Tick the event loop so the scan sets isRunning and hits the deferred execute
    await new Promise((r) => setTimeout(r, 10));

    expect(getFullScanStatus().isRunning).toBe(true);
    expect(getFullScanStatus().startedAt).not.toBeNull();

    // Unblock: empty rows → loop breaks immediately
    resolveCheck();
    await promise;

    const status = getFullScanStatus();
    expect(status.isRunning).toBe(false);
    expect(status.finishedAt).not.toBeNull();
    expect(status.error).toBeNull();
    expect(status.totals.checked).toBe(0);
  });

  it("records error on getFullScanStatus when sweep throws", async () => {
    executeMock.mockRejectedValueOnce(new Error("DB connection lost"));

    const { runFullLivenessScan, getFullScanStatus } = await import(
      "../../lib/vacancyLivenessSweep"
    );

    await expect(runFullLivenessScan()).rejects.toThrow("DB connection lost");

    const status = getFullScanStatus();
    expect(status.isRunning).toBe(false);
    expect(status.error).toMatch(/DB connection lost/);
    expect(status.finishedAt).not.toBeNull();
  });
});
