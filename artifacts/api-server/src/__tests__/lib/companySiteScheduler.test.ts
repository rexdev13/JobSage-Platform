import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  executeMock,
  scheduleMock,
  discoverCompanySiteVacanciesMock,
} = vi.hoisted(() => ({
  executeMock: vi.fn(),
  scheduleMock: vi.fn(),
  discoverCompanySiteVacanciesMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: executeMock,
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
  persistCompanySiteVacancies: vi.fn(),
}));

const {
  COMPANY_SITE_DISCOVERY_BATCH_SIZE,
  COMPANY_SITE_DISCOVERY_CONCURRENCY,
  COMPANY_SITE_DISCOVERY_CRON,
  runCompanySiteCheck,
  selectCompanySiteBatch,
  startCompanySiteDiscoveryScheduler,
} = await import("../../lib/companySiteScheduler");

describe("company-site scheduler", () => {
  beforeEach(() => {
    executeMock.mockReset();
    scheduleMock.mockReset();
    discoverCompanySiteVacanciesMock.mockReset();
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
});