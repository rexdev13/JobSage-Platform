import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sources: [] as Array<Record<string, unknown>>,
  fetchPage: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  upsert: vi.fn(),
  stateWrites: [] as Array<Record<string, unknown>>,
  listingAudits: [] as Array<Record<string, unknown>>,
  observations: [] as Array<Record<string, unknown>>,
  reviewedAliases: [] as Array<Record<string, unknown>>,
  sponsorRows: [{ organisationName: "Example Trust" }] as Array<Record<string, unknown>>,
  syncLogs: [] as Array<Record<string, unknown>>,
  tables: {
    states: { sourceId: "sourceId" },
    listingAudits: {
      externalId: "externalId",
      sourceId: "sourceId",
      lastSeenAt: "lastSeenAt",
    },
    observations: {
      externalId: "externalId",
      sourceId: "sourceId",
      lastSeenAt: "lastSeenAt",
      vacancyId: "vacancyId",
      missingSince: "missingSince",
    },
    sponsorLicences: { id: "id", organisationName: "organisationName" },
    crosswalk: {
      identitySnapshot: "identitySnapshot",
      resolutionMethod: "resolutionMethod",
      targetSponsorLicenceId: "targetSponsorLicenceId",
      sourceSystem: "sourceSystem",
    },
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
  vacancySourceListingAuditsTable: mocks.tables.listingAudits,
  sponsorLicencesTable: mocks.tables.sponsorLicences,
  sponsorLicenceIdentityCrosswalkTable: mocks.tables.crosswalk,
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
  innerJoin: (...values: unknown[]) => ({ innerJoin: values }),
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
    mocks.listingAudits.length = 0;
    mocks.observations.length = 0;
    mocks.reviewedAliases.length = 0;
    mocks.sponsorRows.splice(0, mocks.sponsorRows.length, {
      organisationName: "Example Trust",
    });
    mocks.syncLogs.length = 0;

    mocks.select.mockImplementation(() => ({
      from: (table: object) => ({
        innerJoin: () => ({
          where: () => Promise.resolve(mocks.reviewedAliases),
        }),
        where: () => table === mocks.tables.states
          ? { limit: () => Promise.resolve([storedState]) }
          : Promise.resolve(
              table === mocks.tables.sponsorLicences
                ? mocks.sponsorRows
                : table === mocks.tables.listingAudits
                  ? mocks.listingAudits
                  : table === mocks.tables.observations
                    ? mocks.observations
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
        if (table === mocks.tables.listingAudits) {
          const rows = Array.isArray(values) ? values : [values];
          mocks.listingAudits.push(...rows as Array<Record<string, unknown>>);
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
    mocks.upsert.mockImplementation((adverts: Array<Record<string, unknown>>) => {
      const lastSeenAt = new Date();
      mocks.observations.push(...adverts.map((advert) => ({
        externalId: advert["externalId"],
        sourceId: advert["sourceId"],
        lastSeenAt,
      })));
      return Promise.resolve({ inserted: adverts.length, updated: 0, revived: 0 });
    });
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

  it("retains a host backoff that is later than the source retry", async () => {
    const hostRetry = new Date(Date.now() + 60 * 60_000);
    mocks.fetchPage.mockReset().mockRejectedValue(Object.assign(
      new Error("rate_limited: hostname is paced or in backoff"),
      { retryAt: hostRetry },
    ));
    await runFreeBoardVacancyCollector({ pagesPerSource: 2, deadlineMs: Date.now() + 60_000 });
    expect(mocks.stateWrites.at(-1)).toMatchObject({
      cursor: null, lastOutcome: "retryable_failure", nextRetryAt: hostRetry,
    });
    expect(mocks.update).not.toHaveBeenCalled();
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

  it("deduplicates listing IDs across pages and persists unmatched employer evidence", async () => {
    mocks.sponsorRows.splice(0);
    mocks.sources[0]!["reconcileMissingAfterSweep"] = false;
    const advert = (externalId: string, organisationName: string) => ({
      organisationName,
      employer: organisationName,
      title: "Community Adviser",
      location: "London",
      salary: null,
      url: `https://fixture-board.example/jobs/${externalId}`,
      applicationUrl: null,
      description: null,
      postedDate: null,
      targetRegions: [],
      boardName: "Fixture Board",
      externalId,
      sourceType: "job_board",
    });
    mocks.fetchPage
      .mockReset()
      .mockResolvedValueOnce({
        adverts: [advert("charity-1", "Unmapped Charity")],
        recordsFetched: 1,
        nextCursor: "page-2",
      })
      .mockResolvedValueOnce({
        adverts: [
          advert("charity-1", "Unmapped Charity"),
          advert("charity-2", "Another Unmapped Charity"),
        ],
        recordsFetched: 2,
        nextCursor: null,
      });

    const summary = await runFreeBoardVacancyCollector({
      pagesPerSource: 2,
      sourceId: "fixture-source",
      deadlineMs: Date.now() + 60_000,
    });

    expect(summary).toMatchObject({
      recordsFetched: 3,
      uniqueListingsSeen: 2,
      duplicateListingsSkipped: 1,
      sweepUniqueListingsSeen: 2,
      unmatchedSponsorIdentity: 2,
      sweepUnmatchedSponsorIdentity: 2,
      sponsorMatched: 0,
      done: true,
    });
    expect(mocks.fetchPage.mock.calls[1]?.[0]?.seenExternalIds.has("charity-1")).toBe(true);
    expect(mocks.listingAudits.map((row) => row["externalId"])).toEqual([
      "charity-1",
      "charity-2",
    ]);
    expect(mocks.listingAudits).toEqual(expect.arrayContaining([
      expect.objectContaining({
        employerName: "Unmapped Charity",
        matchReason: "no_sponsor_identity_match",
      }),
    ]));
  });

  it("uses a reviewed sponsor identity crosswalk for an employer alias", async () => {
    mocks.sponsorRows.splice(0);
    mocks.sources[0]!["reconcileMissingAfterSweep"] = false;
    mocks.reviewedAliases.push({
      identitySnapshot: { organisationName: "Example & Support" },
      resolutionMethod: "manual_review",
      organisationName: "Example Trust",
    });
    mocks.fetchPage.mockReset().mockResolvedValue({
      adverts: [{
        organisationName: "Example and Support",
        employer: "Example and Support",
        title: "Staff Nurse",
        location: "London",
        salary: null,
        url: "https://fixture-board.example/jobs/alias-1001",
        applicationUrl: null,
        description: null,
        postedDate: null,
        targetRegions: [],
        boardName: "Fixture Board",
        externalId: "alias-1001",
        sourceType: "job_board",
      }],
      recordsFetched: 1,
      nextCursor: null,
    });

    const summary = await runFreeBoardVacancyCollector({
      pagesPerSource: 1,
      sourceId: "fixture-source",
      deadlineMs: Date.now() + 60_000,
    });

    expect(summary).toMatchObject({
      uniqueListingsSeen: 1,
      sweepUniqueListingsSeen: 1,
      sweepSponsorMatched: 1,
      sponsorMatched: 1,
      saved: 1,
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({
        organisationName: "Example Trust",
        employer: "Example Trust",
      })],
      { enrichContacts: false, queueVerifications: true },
    );
    expect(mocks.listingAudits).toHaveLength(0);
  });

  it("keeps a crosswalk alias with conflicting sponsor targets unmatched", async () => {
    mocks.sponsorRows.splice(0);
    mocks.sources[0]!["reconcileMissingAfterSweep"] = false;
    mocks.reviewedAliases.push(
      {
        identitySnapshot: { organisationName: "Example & Support" },
        resolutionMethod: "exact_unique",
        organisationName: "Example Trust",
      },
      {
        identitySnapshot: { organisationName: "Example & Support" },
        resolutionMethod: "manual_review",
        organisationName: "Example Foundation",
      },
    );
    mocks.fetchPage.mockReset().mockResolvedValue({
      adverts: [{
        organisationName: "Example and Support",
        employer: "Example and Support",
        title: "Community Nurse",
        location: "London",
        salary: null,
        url: "https://fixture-board.example/jobs/ambiguous-1001",
        applicationUrl: null,
        description: null,
        postedDate: null,
        targetRegions: [],
        boardName: "Fixture Board",
        externalId: "ambiguous-1001",
        sourceType: "job_board",
      }],
      recordsFetched: 1,
      nextCursor: null,
    });

    const summary = await runFreeBoardVacancyCollector({
      pagesPerSource: 1,
      sourceId: "fixture-source",
      deadlineMs: Date.now() + 60_000,
    });

    expect(summary.sponsorMatched).toBe(0);
    expect(summary.sweepUnmatchedSponsorIdentity).toBe(1);
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.listingAudits).toEqual([
      expect.objectContaining({
        externalId: "ambiguous-1001",
        matchReason: "ambiguous_sponsor_identity",
      }),
    ]);
  });
});
