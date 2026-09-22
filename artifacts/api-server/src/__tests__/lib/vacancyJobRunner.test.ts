import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  connectMock,
  queryMock,
  releaseMock,
  runAdditionalBoardProfessionBackfillMock,
  runCompanySiteProbeDiscoveryBatchMock,
  runReedProfessionBackfillMock,
  runVacancyLivenessSweepMock,
} = vi.hoisted(() => ({
  connectMock: vi.fn(),
  queryMock: vi.fn(),
  releaseMock: vi.fn(),
  runAdditionalBoardProfessionBackfillMock: vi.fn(),
  runCompanySiteProbeDiscoveryBatchMock: vi.fn(),
  runReedProfessionBackfillMock: vi.fn(),
  runVacancyLivenessSweepMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { connect: connectMock },
}));

vi.mock("../../lib/vacancyCheckScheduler", () => ({
  DEFAULT_VACANCY_CHECK_BATCH_SIZE: 50,
  runVacancyCheckBatch: vi.fn(),
}));

vi.mock("../../lib/companySiteScheduler", () => ({
  COMPANY_SITE_DISCOVERY_BATCH_SIZE: 5,
  runCompanySiteDiscoveryBatch: vi.fn(),
  runCompanySiteProbeDiscoveryBatch: runCompanySiteProbeDiscoveryBatchMock,
}));

vi.mock("../../lib/companySiteProbe", () => ({
  COMPANY_SITE_PROBE_BATCH_SIZE: 30,
  COMPANY_SITE_PROBE_HTTP_BUDGET_MS: 20_000,
}));

vi.mock("../../lib/contactEnrichmentRunner", () => ({
  CONTACT_ENRICHMENT_BATCH_SIZE: 5,
  runContactEnrichmentBatch: vi.fn(),
}));

vi.mock("../../lib/vacancyLivenessSweep", () => ({
  VACANCY_LIVENESS_BATCH_LIMIT: 600,
  VACANCY_LIVENESS_DOMAIN_CONCURRENCY: 24,
  runVacancyLivenessSweep: runVacancyLivenessSweepMock,
}));

vi.mock("../../lib/reedProfessionBackfill", () => ({
  REED_PROFESSION_BACKFILL_TARGETS: Array.from({ length: 9 }),
  runReedProfessionBackfill: runReedProfessionBackfillMock,
}));

vi.mock("../../lib/additionalBoardProfessionBackfill", () => ({
  getAdditionalBoardBackfillPage: vi.fn(() => ({ total: 10, selected: 1, sources: [] })),
  getAdditionalBoardBackfillPlan: vi.fn(() => Array.from({ length: 10 })),
  runAdditionalBoardProfessionBackfill: runAdditionalBoardProfessionBackfillMock,
}));

describe("runVacancyJob liveness deadline", () => {
  beforeEach(() => {
    vi.resetModules();
    connectMock.mockReset();
    queryMock.mockReset();
    releaseMock.mockReset();
    runAdditionalBoardProfessionBackfillMock.mockReset();
    runCompanySiteProbeDiscoveryBatchMock.mockReset();
    runReedProfessionBackfillMock.mockReset();
    runVacancyLivenessSweepMock.mockReset();
    connectMock.mockResolvedValue({
      query: queryMock,
      release: releaseMock,
    });
  });

  it("unlocks a writer lock acquired after the HTTP deadline before releasing the client", async () => {
    let resolveLock!: (value: { rows: Array<{ acquired: boolean }> }) => void;
    const lateLock = new Promise<{ rows: Array<{ acquired: boolean }> }>((resolve) => {
      resolveLock = resolve;
    });
    queryMock
      .mockReturnValueOnce(lateLock)
      .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] });

    const { runVacancyJob } = await import("../../lib/vacancyJobRunner");
    const result = await runVacancyJob("liveness", 10, {
      deadlineMs: Date.now() + 20,
    });

    expect(result).toMatchObject({
      done: false,
      remainingIsLowerBound: true,
    });
    expect(releaseMock).not.toHaveBeenCalled();

    resolveLock({ rows: [{ acquired: true }] });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(String(queryMock.mock.calls[1]?.[0])).toContain("pg_advisory_unlock");
    expect(releaseMock).toHaveBeenCalledOnce();
    expect(runVacancyLivenessSweepMock).not.toHaveBeenCalled();
  });

  it("bounds the probe response but keeps the writer lock until the probe settles", async () => {
    let resolveProbe!: (value: {
      selected: number;
      checked: number;
      okForCrawl: number;
      temporaryBad: number;
      permanentBad: number;
      skipped: number;
      deferred: number;
      errors: number;
      done: boolean;
      remaining: number;
      remainingIsLowerBound: boolean;
      durationMs: number;
    }) => void;
    const probe = new Promise<Parameters<typeof resolveProbe>[0]>((resolve) => {
      resolveProbe = resolve;
    });
    queryMock.mockResolvedValue({ rows: [{ acquired: true }] });
    runCompanySiteProbeDiscoveryBatchMock.mockReturnValue(probe);

    const { runVacancyJob } = await import("../../lib/vacancyJobRunner");
    const running = runVacancyJob("company_site_probe", 30, {
      deadlineMs: Date.now() + 20,
    });

    await expect(running).rejects.toThrow("VACANCY_JOB_DEADLINE");
    expect(releaseMock).not.toHaveBeenCalled();

    resolveProbe({
      selected: 1,
      checked: 1,
      okForCrawl: 1,
      temporaryBad: 0,
      permanentBad: 0,
      skipped: 0,
      deferred: 0,
      errors: 0,
      done: true,
      remaining: 0,
      remainingIsLowerBound: false,
      durationMs: 30,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(String(queryMock.mock.calls[1]?.[0])).toContain("pg_advisory_unlock");
    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it("uses the widened bounded result cap for Reed profession pages", async () => {
    queryMock.mockResolvedValue({ rows: [{ acquired: true }] });
    runReedProfessionBackfillMock.mockResolvedValue({
      inserted: 0,
      revived: 0,
      categories: [{ failed: false, updated: 0 }],
      live: 0,
    });

    const { PROFESSION_BACKFILL_HTTP_RESULTS_PER_CATEGORY, runVacancyJob } =
      await import("../../lib/vacancyJobRunner");
    await runVacancyJob("reed_professions", 1, {
      cursor: 3,
      deadlineMs: Date.now() + 5_000,
    });

    expect(PROFESSION_BACKFILL_HTTP_RESULTS_PER_CATEGORY).toBe(20);
    expect(runReedProfessionBackfillMock).toHaveBeenCalledWith(expect.objectContaining({
      perCategoryLimit: 20,
      totalPersistLimit: 20,
      targets: expect.any(Array),
    }));
  });

  it("uses the widened bounded result cap for additional-board pages", async () => {
    queryMock.mockResolvedValue({ rows: [{ acquired: true }] });
    runAdditionalBoardProfessionBackfillMock.mockResolvedValue({
      inserted: 0,
      updated: 0,
      revived: 0,
      sources: [],
      live: 0,
      failed: false,
    });

    const { runVacancyJob } = await import("../../lib/vacancyJobRunner");
    await runVacancyJob("additional_boards", 1, {
      cursor: 3,
      deadlineMs: Date.now() + 5_000,
    });

    expect(runAdditionalBoardProfessionBackfillMock).toHaveBeenCalledWith(expect.objectContaining({
      perCategoryLimit: 20,
      sources: [],
    }));
  });
});