import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const { insertedRows, executeMock, scheduleMock } = vi.hoisted(() => ({
  insertedRows: [] as any[],
  executeMock: vi.fn(async (_statement: unknown) => ({
    rows: [] as { id: number; organisation_name: string }[],
  })),
  scheduleMock: vi.fn(),
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

vi.mock("node-cron", () => ({ default: { schedule: scheduleMock } }));

const { runVacancyCheckMock } = vi.hoisted(() => ({
  runVacancyCheckMock: vi.fn(),
}));

import {
  BOOKMARK_QUEUE_SHARE,
  HEALTHCARE_SPONSOR_INDICATORS,
  HEALTHCARE_SPONSOR_SQL_REGEXP,
  HEALTHCARE_QUEUE_SHARE,
  DEFAULT_VACANCY_CHECK_BATCH_SIZE,
  VACANCY_CHECK_CONCURRENCY,
  VACANCY_CHECK_CRON,
  startVacancyCheckScheduler,
} from "../../lib/vacancyCheckScheduler";
vi.mock("../../lib/vacancyCheckHelper", () => ({
  runVacancyCheck: runVacancyCheckMock,
}));

const { runVacancyCheckBatch } = await import("../../lib/vacancyCheckScheduler");

describe("runVacancyCheckBatch", () => {
  it("uses healthcare only as a balanced cohort signal, not a non-health exclusion", () => {
    expect(HEALTHCARE_SPONSOR_INDICATORS).toEqual([
      "nhs", "hospital", "health", "medical", "social care", "care home", "nursing",
    ]);
    expect(BOOKMARK_QUEUE_SHARE).toBe(0.25);
    expect(HEALTHCARE_QUEUE_SHARE).toBe(0.5);
    const healthcareWordPattern = new RegExp(HEALTHCARE_SPONSOR_SQL_REGEXP.replace(/\\m|\\M/g, "\\b"), "i");
    expect(healthcareWordPattern.test("Hospitality")).toBe(false);
    expect(healthcareWordPattern.test("Hospital")).toBe(true);
  });

  beforeEach(() => {
    insertedRows.length = 0;
    runVacancyCheckMock.mockReset();
    executeMock.mockReset();
    scheduleMock.mockReset();
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
    expect(log.jobKind).toBe("job_board");
    expect(log.metrics).toMatchObject({
      selected: 30,
      checked: 28,
      cacheHits: 1,
      errors: 1,
    });
  });

  it("does not globally exclude bookmarked engineering, accounting, or education sponsors", async () => {
    executeMock.mockResolvedValue({
      rows: [
        { id: 1, organisation_name: "Bookmarked Engineer Ltd" },
        { id: 2, organisation_name: "Bookmarked Accountants LLP" },
        { id: 3, organisation_name: "Bookmarked Teacher College" },
      ],
    });
    runVacancyCheckMock.mockResolvedValue({ fromCache: false });

    await runVacancyCheckBatch("scheduler");

    expect(runVacancyCheckMock.mock.calls.map(([name]) => name)).toEqual([
      "Bookmarked Engineer Ltd",
      "Bookmarked Accountants LLP",
      "Bookmarked Teacher College",
    ]);
    const statement = executeMock.mock.calls[0]?.[0] as SQL;
    const query = new PgDialect().sqlToQuery(statement);
    expect(query.sql).toContain("PARTITION BY e.is_healthcare");
    expect(query.sql).toContain("FROM sponsor_licence_bookmarks");
    expect(query.sql).not.toContain("!~*");
    expect(query.params).not.toContain("construction|hospitality|retail");
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

  it("writes an explicit empty sync log when no companies are stale", async () => {
    executeMock.mockResolvedValue({ rows: [] });
    await runVacancyCheckBatch("scheduler");
    expect(runVacancyCheckMock).not.toHaveBeenCalled();
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({
      status: "success",
      jobKind: "job_board",
      checkedCount: 0,
      errorCount: 0,
    });
  });

  it("uses the safe high-volume batch and six-hour schedule", () => {
    expect(DEFAULT_VACANCY_CHECK_BATCH_SIZE).toBe(250);
    expect(VACANCY_CHECK_CONCURRENCY).toBe(15);

    startVacancyCheckScheduler();

    expect(scheduleMock).toHaveBeenCalledWith(
      VACANCY_CHECK_CRON,
      expect.any(Function),
      { timezone: "Europe/London" },
    );
  });
});
