import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  executeMock,
  selectMock,
  insertMock,
  scheduleMock,
  discoverCompanySiteVacanciesMock,
  persistCompanySiteVacanciesMock,
} = vi.hoisted(() => ({
  executeMock: vi.fn(),
  selectMock: vi.fn(),
  insertMock: vi.fn(),
  scheduleMock: vi.fn(),
  discoverCompanySiteVacanciesMock: vi.fn(),
  persistCompanySiteVacanciesMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: executeMock,
    select: selectMock,
    insert: insertMock,
  },
  sponsorLicenceCompanySiteChecksTable: {
    organisationName: "organisationName",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("node-cron", () => ({ default: { schedule: scheduleMock } }));

vi.mock("../../lib/companySiteDiscovery", () => ({
  discoverCompanySiteVacancies: discoverCompanySiteVacanciesMock,
  persistCompanySiteVacancies: persistCompanySiteVacanciesMock,
}));

const {
  COMPANY_SITE_DISCOVERY_BATCH_SIZE,
  COMPANY_SITE_DISCOVERY_CONCURRENCY,
  COMPANY_SITE_DISCOVERY_CRON,
  runCompanySiteCheck,
  runCompanySiteDiscoveryBatch,
  selectCompanySiteBatch,
  startCompanySiteDiscoveryScheduler,
} = await import("../../lib/companySiteScheduler");

describe("company-site scheduler", () => {
  beforeEach(() => {
    executeMock.mockReset();
    selectMock.mockReset();
    insertMock.mockReset();
    scheduleMock.mockReset();
    discoverCompanySiteVacanciesMock.mockReset();
    persistCompanySiteVacanciesMock.mockReset();
    selectMock.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([]),
        }),
      }),
    });
    insertMock.mockReturnValue({
      values: () => ({
        onConflictDoUpdate: () => Promise.resolve(),
      }),
    });
    persistCompanySiteVacanciesMock.mockResolvedValue({ inserted: 0, revived: 0 });
  });

  it("uses its own hourly schedule and bounded worker settings", () => {
    expect(COMPANY_SITE_DISCOVERY_BATCH_SIZE).toBe(100);
    expect(COMPANY_SITE_DISCOVERY_CONCURRENCY).toBe(8);
    startCompanySiteDiscoveryScheduler();
    expect(scheduleMock).toHaveBeenCalledWith(
      COMPANY_SITE_DISCOVERY_CRON,
      expect.any(Function),
      { timezone: "Europe/London" },
    );
  });

  it("accepts a stale non-health sponsor selected by the all-industry website queue", async () => {
    executeMock.mockResolvedValue({
      rows: [{
        id: 7,
        organisation_name: "Acme Engineering Limited",
        website: "https://acme.example",
        generic_checked_at: null,
        ats_checked_at: null,
        careers_url: null,
        ats_provider: null,
        bookmarked: false,
      }],
    });

    const rows = await selectCompanySiteBatch(100);

    expect(rows).toEqual([
      expect.objectContaining({
        organisationName: "Acme Engineering Limited",
        bookmarked: false,
      }),
    ]);
  });

  it("skips sponsors without a website before any discovery request", async () => {
    await expect(runCompanySiteCheck({
      organisationName: "No Website Ltd",
      website: " ",
      genericCheckedAt: null,
      atsCheckedAt: null,
      careersUrl: null,
      atsProvider: null,
    })).resolves.toEqual({ status: "skipped", reason: "no website" });
    expect(discoverCompanySiteVacanciesMock).not.toHaveBeenCalled();
  });

  it("waits for a slow check and emits a final marked summary", async () => {
    executeMock
      .mockResolvedValueOnce({
        rows: [{
          id: 7,
          organisation_name: "Acme Engineering Limited",
          website: "https://acme.example",
          generic_checked_at: null,
          ats_checked_at: null,
          careers_url: null,
          ats_provider: null,
          bookmarked: false,
        }],
      });
    discoverCompanySiteVacanciesMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        adverts: [],
        pagesFetched: 1,
        genericCompleted: true,
        atsCompleted: false,
        transientFailure: false,
      };
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const summary = await runCompanySiteDiscoveryBatch({ batchSize: 1 });

    expect(summary).toEqual(expect.objectContaining({
      selected: 1,
      checked: 1,
      errors: 0,
      done: true,
      remaining: 0,
      remainingIsLowerBound: false,
      durationMs: expect.any(Number),
    }));
    expect(discoverCompanySiteVacanciesMock).toHaveBeenCalledWith(
      "Acme Engineering Limited",
      "https://acme.example",
      expect.objectContaining({ deadlineMs: undefined }),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(
      "Complete selected=1 checked=1 skipped=0 upserted=0 errors=0 done=true remaining=0",
    ));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(
      "job=company_site selected=1 upserted=0",
    ));
    logSpy.mockRestore();
  });

  it("reports resumable work when the lookahead finds another eligible employer", async () => {
    executeMock.mockResolvedValue({
      rows: Array.from({ length: 6 }, (_, index) => ({
        id: index + 1,
        organisation_name: `Employer ${index + 1}`,
        website: `https://employer-${index + 1}.example`,
        generic_checked_at: null,
        ats_checked_at: null,
        careers_url: null,
        ats_provider: null,
        bookmarked: false,
      })),
    });
    discoverCompanySiteVacanciesMock.mockResolvedValue({
      adverts: [],
      pagesFetched: 1,
      genericCompleted: true,
      atsCompleted: false,
      transientFailure: false,
    });

    const summary = await runCompanySiteDiscoveryBatch({ batchSize: 5 });

    expect(summary).toEqual(expect.objectContaining({
      selected: 5,
      checked: 5,
      errors: 0,
      done: false,
      remaining: 1,
      remainingIsLowerBound: true,
    }));
    expect(discoverCompanySiteVacanciesMock).toHaveBeenCalledTimes(5);
  });
});