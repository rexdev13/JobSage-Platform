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

vi.mock("../../lib/freeBoardSourceRegistry", () => ({
  ALL_FREE_BOARD_SOURCES: mocks.sources,
  isFreeBoardSourceId: (value: unknown) =>
    typeof value === "string" && mocks.sources.some((source) => source["id"] === value),
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
    Object.assign(storedState, {
      parserVersion: "fixture-v1",
      cursor: null,
      sweepStartedAt: null,
      consecutiveFailures: 0,
      nextRetryAt: null,
    });
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
      recordsFetched: 1,
      sponsorMatched: 1,
      saved: 1,
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

  it("persists and yields at a source phase boundary before fetching the next phase", async () => {
    mocks.fetchPage.mockReset().mockResolvedValue({
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
      nextCursor: "sitemap-phase",
      stopAfterPage: true,
    });

    const summary = await runFreeBoardVacancyCollector({
      pagesPerSource: 5,
      deadlineMs: Date.now() + 60_000,
    });

    expect(summary).toMatchObject({
      selected: 1,
      errors: 0,
      done: false,
      remaining: 1,
      metrics: {
        sources: [{
          outcome: "partial",
          nextCursor: "sitemap-phase",
        }],
      },
    });
    expect(mocks.fetchPage).toHaveBeenCalledTimes(1);
    expect(mocks.stateWrites).toHaveLength(2);
    expect(mocks.stateWrites.every((write) => write["cursor"] === "sitemap-phase")).toBe(true);
  });

  it("retries immediately when a parser version changes during backoff", async () => {
    Object.assign(storedState, {
      parserVersion: "fixture-v0",
      cursor: "old-cursor",
      sweepStartedAt: new Date("2026-10-05T00:00:00.000Z"),
      consecutiveFailures: 1,
      nextRetryAt: new Date(Date.now() + 60_000),
    });

    const summary = await runFreeBoardVacancyCollector({
      pagesPerSource: 1,
      deadlineMs: Date.now() + 60_000,
    });

    expect(summary).toMatchObject({
      selected: 1,
      upserted: 1,
      errors: 0,
      done: false,
      remaining: 1,
      metrics: {
        sources: [{
          sourceId: "fixture-source",
          outcome: "partial",
          nextCursor: "cursor-2",
        }],
      },
    });
    expect(mocks.fetchPage).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: null }),
    );
    expect(mocks.stateWrites[0]).toMatchObject({
      parserVersion: "fixture-v1",
      cursor: null,
      nextRetryAt: null,
    });
  });

  it("does not mark a source complete or reconcile missing rows when coverage needs review", async () => {
    mocks.fetchPage.mockReset().mockResolvedValue({
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
      reportedTotal: 21,
      coverageWarning: "Feed returned 19 raw listings; it reported 21.",
      nextCursor: null,
    });

    const summary = await runFreeBoardVacancyCollector({
      pagesPerSource: 1,
      sourceId: "fixture-source",
      deadlineMs: Date.now() + 60_000,
    });

    expect(summary).toMatchObject({
      selected: 1,
      sponsorMatched: 1,
      saved: 1,
      errors: 1,
      done: false,
      remaining: 1,
      metrics: {
        sources: [{
          outcome: "needs_review",
          nextCursor: null,
          reportedTotal: 21,
          coverageWarning: "Feed returned 19 raw listings; it reported 21.",
          error: "Feed returned 19 raw listings; it reported 21.",
        }],
      },
    });
    expect(mocks.stateWrites).toHaveLength(1);
    expect(mocks.stateWrites[0]).toMatchObject({
      cursor: null,
      sweepStartedAt: null,
      lastOutcome: "needs_review",
      lastError: "Feed returned 19 raw listings; it reported 21.",
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("runs one registered source without advancing other feeds and reports distinct counts", async () => {
    const otherFetch = vi.fn();
    mocks.sources.push({
      id: "other-source",
      provider: "other",
      boardName: "Other Board",
      parserVersion: "other-v1",
      maxPagesPerRun: 10,
      fetchPage: otherFetch,
    });
    mocks.sources[0]!["reconcileMissingAfterSweep"] = false;
    mocks.fetchPage
      .mockReset()
      .mockResolvedValue({
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
        recordsFetched: 3,
        nextCursor: null,
      });

    const summary = await runFreeBoardVacancyCollector({
      pagesPerSource: 2,
      sourceId: "fixture-source",
      deadlineMs: Date.now() + 60_000,
    });

    expect(summary).toMatchObject({
      selected: 3,
      recordsFetched: 3,
      sponsorMatched: 1,
      upserted: 1,
      done: true,
      remaining: 0,
      metrics: {
        sourceId: "fixture-source",
        sources: [{
          sourceId: "fixture-source",
          recordsFetched: 3,
          sponsorMatched: 1,
          saved: 1,
          missingReconciliation: false,
          missingCount: 0,
          outcome: "complete",
        }],
      },
    });
    expect(otherFetch).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
