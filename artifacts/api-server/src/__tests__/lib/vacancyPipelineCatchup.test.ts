import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  executeMock,
  queryMock,
  releaseMock,
  boardBatchMock,
  companyBatchMock,
  livenessBatchMock,
} = vi.hoisted(() => ({
  executeMock: vi.fn(),
  queryMock: vi.fn(),
  releaseMock: vi.fn(),
  boardBatchMock: vi.fn(),
  companyBatchMock: vi.fn(),
  livenessBatchMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { execute: executeMock },
  pool: {
    connect: vi.fn(async () => ({
      query: queryMock,
      release: releaseMock,
    })),
  },
}));

vi.mock("../../lib/vacancyCheckScheduler", () => ({
  runVacancyCheckBatch: boardBatchMock,
}));

vi.mock("../../lib/companySiteScheduler", () => ({
  runCompanySiteDiscoveryBatch: companyBatchMock,
}));

vi.mock("../../lib/vacancyLivenessSweep", () => ({
  runVacancyLivenessSweep: livenessBatchMock,
}));

const { runVacancyPipelineCatchupsIfStale } = await import("../../lib/vacancyPipelineCatchup");

describe("vacancy pipeline post-boot catch-up", () => {
  beforeEach(() => {
    executeMock.mockReset();
    queryMock.mockReset();
    releaseMock.mockReset();
    boardBatchMock.mockReset();
    companyBatchMock.mockReset();
    livenessBatchMock.mockReset();
    queryMock.mockImplementation(async (statement: string) =>
      statement.includes("pg_try_advisory_lock")
        ? { rows: [{ acquired: true }] }
        : { rows: [{ pg_advisory_unlock: true }] },
    );
  });

  it("runs one locked capped batch for every stale pipeline", async () => {
    executeMock.mockResolvedValue({
      rows: [{
        board_last_success: null,
        company_last_success: null,
        liveness_last_success: null,
        unverified_job_board: 13,
      }],
    });

    await runVacancyPipelineCatchupsIfStale();

    expect(boardBatchMock).toHaveBeenCalledOnce();
    expect(companyBatchMock).toHaveBeenCalledOnce();
    expect(livenessBatchMock).toHaveBeenCalledOnce();
    expect(queryMock.mock.calls.filter(([sql]) => String(sql).includes("pg_try_advisory_lock"))).toHaveLength(3);
    expect(releaseMock).toHaveBeenCalledTimes(3);
  });

  it("does not stack a catch-up when another boot owns the database lock", async () => {
    executeMock.mockResolvedValue({
      rows: [{
        board_last_success: null,
        company_last_success: new Date().toISOString(),
        liveness_last_success: new Date().toISOString(),
        unverified_job_board: 0,
      }],
    });
    queryMock.mockResolvedValueOnce({ rows: [{ acquired: false }] });

    await runVacancyPipelineCatchupsIfStale();

    expect(boardBatchMock).not.toHaveBeenCalled();
    expect(companyBatchMock).not.toHaveBeenCalled();
    expect(livenessBatchMock).not.toHaveBeenCalled();
    expect(releaseMock).toHaveBeenCalledOnce();
  });

  it("continues to company-site and liveness catch-up when board discovery fails", async () => {
    executeMock.mockResolvedValue({
      rows: [{
        board_last_success: null,
        company_last_success: null,
        liveness_last_success: null,
        unverified_job_board: 13,
      }],
    });
    boardBatchMock.mockRejectedValue(new Error("board unavailable"));

    await runVacancyPipelineCatchupsIfStale();

    expect(companyBatchMock).toHaveBeenCalledOnce();
    expect(livenessBatchMock).toHaveBeenCalledOnce();
  });
});