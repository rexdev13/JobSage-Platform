import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  execute: vi.fn(),
  insert: vi.fn(),
  deleteWhere: vi.fn(),
  schedule: vi.fn(),
  stored: { name: "sponsor_licences" },
  logs: { name: "sponsor_licence_sync_log" },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => ({ from: mocks.from })),
    execute: mocks.execute,
    insert: mocks.insert,
    delete: vi.fn(() => ({ where: mocks.deleteWhere })),
  },
  sponsorLicencesTable: mocks.stored,
  sponsorLicenceSyncLogTable: mocks.logs,
}));
vi.mock("node-cron", () => ({ default: { schedule: mocks.schedule } }));

const header = "Organisation Name,Town/City,County,Type & Rating,Route\n";
const csvRow = "Example Limited,London,,Worker (A rating),Skilled Worker\n";
const existing = {
  id: 123,
  organisationName: "Example Limited",
  townCity: "London",
  county: null,
  route: "Worker",
  rating: "A rating",
  subRoute: "Skilled Worker",
};

describe("sponsor register importer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("SPONSOR_LICENCE_REGISTER_URL", "https://example.test/register.csv");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      text: async () => header + csvRow + csvRow + csvRow,
    }));
    mocks.from.mockReset();
    mocks.from.mockResolvedValueOnce([existing]).mockResolvedValue([{ count: 3 }]);
    mocks.execute.mockResolvedValue({});
    mocks.insert.mockImplementation(() => ({ values: vi.fn().mockResolvedValue({}) }));
    mocks.deleteWhere.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("updates a specific ID, inserts missing repeated occurrences, and logs a row-level diff", async () => {
    const { runSponsorLicenceSync } = await import("../../lib/sponsorLicenceSync");
    await runSponsorLicenceSync("manual");

    expect(mocks.execute).toHaveBeenCalledOnce();
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0]![0]);
    expect(query.sql).toContain("WHERE sl.id = d.id");
    expect(query.sql).not.toContain("WHERE sl.organisation_name = d.organisation_name");
    expect(query.sql).not.toContain("industry    = d.industry");
    expect(query.params[0]).toBe(123);

    const dataWrites = mocks.insert.mock.results
      .map((result, index) => ({ table: mocks.insert.mock.calls[index]![0], writer: result.value.values }))
      .filter((call) => call.table === mocks.stored);
    expect(dataWrites).toHaveLength(1);
    const inserted = dataWrites[0]!.writer.mock.calls[0]![0];
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).not.toHaveProperty("existingId");
    expect(inserted.every((item: { organisationName: string }) => item.organisationName === "Example Limited")).toBe(true);
    const logWrite = mocks.insert.mock.results
      .map((result, index) => ({ table: mocks.insert.mock.calls[index]![0], writer: result.value.values }))
      .find((call) => call.table === mocks.logs);
    expect(logWrite?.writer).toHaveBeenCalledWith(expect.objectContaining({
      status: "success",
      recordCount: 3,
      addedCount: 2,
      updatedCount: 1,
      removedCount: 0,
    }));
  });

  it("updates keyword-classified rows by ID too", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      text: async () => header + csvRow.replace("Example Limited", "Example Hospital"),
    } as Response);
    mocks.from.mockReset();
    mocks.from
      .mockResolvedValueOnce([{ ...existing, organisationName: "Example Hospital" }])
      .mockResolvedValue([{ count: 1 }]);
    const { runSponsorLicenceSync } = await import("../../lib/sponsorLicenceSync");
    await runSponsorLicenceSync("manual");
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0]![0]);
    expect(query.sql).toContain("industry    = d.industry");
    expect(query.sql).toContain("WHERE sl.id = d.id");
    expect(query.params[0]).toBe(123);
  });

  it("registers only the canonical 02:00 UK-time cron", async () => {
    const { startSponsorLicenceScheduler } = await import("../../lib/sponsorLicenceScheduler");
    startSponsorLicenceScheduler();
    expect(mocks.schedule).toHaveBeenCalledOnce();
    expect(mocks.schedule).toHaveBeenCalledWith(
      "0 2 * * *", expect.any(Function), { timezone: "Europe/London" },
    );
  });
});
