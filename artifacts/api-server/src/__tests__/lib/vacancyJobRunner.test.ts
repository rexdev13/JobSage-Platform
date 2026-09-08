import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  connectMock,
  queryMock,
  releaseMock,
  runVacancyLivenessSweepMock,
} = vi.hoisted(() => ({
  connectMock: vi.fn(),
  queryMock: vi.fn(),
  releaseMock: vi.fn(),
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

describe("runVacancyJob liveness deadline", () => {
  beforeEach(() => {
    vi.resetModules();
    connectMock.mockReset();
    queryMock.mockReset();
    releaseMock.mockReset();
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
});