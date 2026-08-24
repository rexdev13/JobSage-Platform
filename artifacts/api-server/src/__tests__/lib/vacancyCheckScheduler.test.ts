import { describe, it, expect, vi, beforeEach } from "vitest";

const { insertedRows, executeMock } = vi.hoisted(() => ({
  insertedRows: [] as any[],
  executeMock: vi.fn(async () => ({ rows: [] as { id: number; organisation_name: string }[] })),
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: executeMock,
    insert: () => ({
      values: (v: any) => {
        insertedRows.push(v);
        return { catch: () => Promise.resolve() };
      },
    }),
  },
  vacancySyncLogTable: {},
}));

vi.mock("node-cron", () => ({ default: { schedule: vi.fn() } }));

const { runVacancyCheckMock } = vi.hoisted(() => ({
  runVacancyCheckMock: vi.fn(),
}));

import {
  HEALTHCARE_SPONSOR_INDICATORS,
  HEALTHCARE_SPONSOR_SQL_REGEXP,
  OBVIOUS_NON_HEALTH_INDUSTRY_INDICATORS,
  OBVIOUS_NON_HEALTH_INDUSTRY_SQL_REGEXP,
} from "../../lib/vacancyCheckScheduler";
vi.mock("../../lib/vacancyCheckHelper", () => ({
  runVacancyCheck: runVacancyCheckMock,
}));

const { runVacancyCheckBatch } = await import("../../lib/vacancyCheckScheduler");

describe("runVacancyCheckBatch", () => {
  it("documents the health and non-health industry signals used for batch selection", () => {
    expect(HEALTHCARE_SPONSOR_INDICATORS).toEqual([
      "nhs", "hospital", "health", "medical", "social care", "care home", "nursing",
    ]);
    expect(OBVIOUS_NON_HEALTH_INDUSTRY_INDICATORS).toContain("construction");
    expect(OBVIOUS_NON_HEALTH_INDUSTRY_INDICATORS).toContain("retail");
    const healthcareWordPattern = new RegExp(HEALTHCARE_SPONSOR_SQL_REGEXP.replace(/\\m|\\M/g, "\\b"), "i");
    const nonHealthWordPattern = new RegExp(OBVIOUS_NON_HEALTH_INDUSTRY_SQL_REGEXP.replace(/\\m|\\M/g, "\\b"), "i");
    expect(healthcareWordPattern.test("Hospitality")).toBe(false);
    expect(healthcareWordPattern.test("Hospital")).toBe(true);
    expect(nonHealthWordPattern.test("Retail")).toBe(true);
    expect(nonHealthWordPattern.test("Retail Health Staffing")).toBe(true);
  });

  beforeEach(() => {
    insertedRows.length = 0;
    runVacancyCheckMock.mockReset();
    executeMock.mockReset();
  });

  it("processes the chunk concurrently, skips per-company failures, and writes a sync log", async () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, organisation_name: `Org ${i + 1}` }));
    executeMock.mockResolvedValue({ rows });

    let inFlight = 0;
    let maxInFlight = 0;
    runVacancyCheckMock.mockImplementation(async (name: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      if (name === "Org 5") throw new Error("boom");
      return { fromCache: name === "Org 6" };
    });

    await runVacancyCheckBatch("scheduler");

    expect(runVacancyCheckMock).toHaveBeenCalledTimes(30);
    // Worker pool of 15 should overlap far beyond sequential processing.
    expect(maxInFlight).toBeGreaterThan(5);

    expect(insertedRows).toHaveLength(1);
    const log = insertedRows[0];
    expect(log.status).toBe("success");
    expect(log.batchSize).toBe(30);
    expect(log.checkedCount).toBe(28);
    expect(log.cacheHitCount).toBe(1);
    expect(log.errorCount).toBe(1);
    expect(log.errorMessage).toContain("boom");
    expect(log.triggeredBy).toBe("scheduler");
  });

  it("skips overlapping runs instead of stacking them", async () => {
    executeMock.mockResolvedValue({ rows: [{ id: 1, organisation_name: "Slow Org" }] });
    let resolveCheck!: () => void;
    runVacancyCheckMock.mockImplementation(
      () => new Promise((r) => { resolveCheck = () => r({ fromCache: false }); }),
    );

    const first = runVacancyCheckBatch("scheduler");
    await new Promise((r) => setTimeout(r, 20));
    await runVacancyCheckBatch("scheduler"); // overlapping tick — should no-op
    expect(runVacancyCheckMock).toHaveBeenCalledTimes(1);

    resolveCheck();
    await first;

    // Lock released — a fresh run proceeds.
    runVacancyCheckMock.mockResolvedValue({ fromCache: false });
    await runVacancyCheckBatch("scheduler");
    expect(runVacancyCheckMock).toHaveBeenCalledTimes(2);
  });

  it("writes no sync log when no companies are stale", async () => {
    executeMock.mockResolvedValue({ rows: [] });
    await runVacancyCheckBatch("scheduler");
    expect(runVacancyCheckMock).not.toHaveBeenCalled();
    expect(insertedRows).toHaveLength(0);
  });
});
