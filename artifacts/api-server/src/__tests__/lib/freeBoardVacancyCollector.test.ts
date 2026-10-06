import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sources: [] as Array<Record<string, unknown>>,
  fetchPage: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  stateWrites: [] as Array<Record<string, unknown>>,
  syncLogs: [] as Array<Record<string, unknown>>,
  tables: {
    states: { sourceId: "sourceId" },
    observations: {
      externalId: "externalId",
      sourceId: "sourceId",
      lastSeenAt: "lastSeenAt",
      vacancyId: "vacancyId",
      missingSince: "missingSince",
    },
    sponsorLicences: { organisationName: "organisationName" },
    vacancies: { id: "id", sourceMissingSince: "sourceMissingSince", sourceMissingObservations: "sourceMissingObservations" },
    syncLog: {},
  },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
  },
  vacancySourceStatesTable: mocks.tables.states,
  vacancySourceObservationsTable: mocks.tables.observations,
  sponsorLicencesTable: mocks.tables.sponsorLicences,
  sponsorLicenceVacanciesTable: mocks.tables.vacancies,
  vacancySyncLogTable: mocks.tables.syncLog,
}));

vi.mock("drizzle-orm", () => ({
  and: (...values: unknown[]) => ({ and: values }),
  eq: (...values: unknown[]) => ({ eq: values }),
  gte: (...values: unknown[]) => ({ gte: values }),
  inArray: (...values: unknown[]) => ({ inArray: values }),
  isNull: (...values: unknown[]) => ({ isNull: values }),
  lt: (...values: unknown[]) => ({ lt: values }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
}));

vi.mock("../../lib/freeBoardSources", () => ({
  FREE_BOARD_SOURCES: mocks.sources,
}));

vi.mock("../../lib/boardVacancyPipeline", () => ({
  normaliseAndDedupeBoardAdverts: (adverts: unknown[]) => adverts,
  upsertSharedBoardVacancies: mocks.upsert,
}));

const { runFreeBoardVacancyCollector } = await import("../../lib/freeBoardVacancyCollector");

describe("free-board vacancy collector", () => {
  const storedState = {
    sourceId: "fixture-source",
    provider: "fixture",
    sourceType: "job_board",
    boardName: "Fixture Board",
    parserVersion: "fixture-v1",
    cursor: null,
    sweepStartedAt: null,
    lastRunAt: null,
    lastSuccessAt: null,
    lastExhaustedAt: null,
    lastOutcome: null,
    lastError: null,
    reportedTotal: null,
    consecutiveFailures: 0,
    nextRetryAt: null,
    updatedAt: new Date("2026-10-06T00:00:00.000Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sources.splice(0);
    mocks.sources.push({
      id: "fixture-source",
      provider: "fixture",
      boardName: "Fixture Board",
      parserVersion: "fixture-v1",
      maxPagesPerRun: 10,
      fetchPage: mocks.fetchPage,
    });
    mocks.stateWrites.length = 0;
    mocks.syncLogs.length = 0;

    mocks.select.mockImplementation(() => ({
      from: (table: object) => ({
        where: () => table === mocks.tables.states
          ? { limit: () => Promise.resolve([storedState]) }
          : Promise.resolve(
              table === mocks.tables.sponsorLicences
                ? [{ organisationName: "Example Trust" }]
                : [],
            ),
      }),
    }));
    mocks.insert.mockImplementation((table: object) => ({
      values: (values: Record<string, unknown>) => {
        if (table === mocks.tables.states) {
          mocks.stateWrites.push(values);
          return { onConflictDoUpdate: () => Promise.resolve() };
        }
        if (table === mocks.tables.syncLog) {
          mocks.syncLogs.push(values);
          return Promise.resolve();
        }
        throw new Error("Unexpected insert target in collector test.");
      },
    }));
    mocks.update.mockReturnValue({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve([]),
        }),
      }),
    });
    mocks.upsert.mockResolvedValue({ inserted: 1, updated: 0, revived: 0 });
    mocks.fetchPage
      .mockResolvedValueOnce({
        adverts: [{
          organisationName: "Example Trust",
          employer: "Example Trust",
          title: "Staff Nurse",
          location: "London",
          salary: null,
          url: "https://fixture-board.example/jobs/1001",
          applicationUrl: null,
          description: null,
          postedDate: null,
          targetRegions: [],
          boardName: "Fixture Board",
          externalId: "1001",
          sourceType: "job_board",
        }],
        nextCursor: "cursor-2",
      })
      .mockRejectedValueOnce(new Error("temporary feed timeout"));
  });

  it("retains the current cursor and skips missing reconciliation when a sweep fails", async () => {
    const summary = await runFreeBoardVacancyCollector({
      pagesPerSource: 2,
      deadlineMs: Date.now() + 60_000,
    });

    expect(summary).toMatchObject({
      selected: 1,
      upserted: 1,
      errors: 1,
      done: false,
      remaining: 1,
      metrics: {
        sources: [{
          sourceId: "fixture-source",
          outcome: "retryable_failure",
          nextCursor: "cursor-2",
          error: "temporary feed timeout",
        }],
      },
    });
    expect(mocks.fetchPage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: "cursor-2" }),
    );
    expect(mocks.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({
        organisationName: "Example Trust",
        sourceId: "job_board:fixture board",
        externalId: "1001",
      })],
      { enrichContacts: false, queueVerifications: true },
    );
    expect(mocks.stateWrites.map((write) => write["lastOutcome"])).toEqual([
      "partial",
      "retryable_failure",
    ]);
    expect(mocks.stateWrites.every((write) => write["cursor"] === "cursor-2")).toBe(true);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.syncLogs[0]).toMatchObject({
      status: "error",
      jobKind: "free_board_sources",
    });
  });
});
