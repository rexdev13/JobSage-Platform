import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  deleteMock,
  whereMock,
  returningMock,
  scheduleMock,
  selectMock,
  fromMock,
  inArrayMock,
} = vi.hoisted(() => ({
  deleteMock: vi.fn(),
  whereMock: vi.fn(),
  returningMock: vi.fn(),
  scheduleMock: vi.fn(),
  selectMock: vi.fn(),
  fromMock: vi.fn(),
  inArrayMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { delete: deleteMock, select: selectMock },
  sponsorLicenceVacanciesTable: {
    liveness: "liveness",
    lastVerifiedAt: "lastVerifiedAt",
    id: "id",
    sourceType: "sourceType",
  },
  vacancySourceObservationsTable: { vacancyId: "sourceObservationVacancyId" },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((...args: unknown[]) => ({ kind: "eq", args })),
  inArray: inArrayMock,
  isNotNull: vi.fn((...args: unknown[]) => ({ kind: "isNotNull", args })),
  lt: vi.fn((...args: unknown[]) => ({ kind: "lt", args })),
}));

vi.mock("node-cron", () => ({
  default: { schedule: scheduleMock },
}));

describe("sponsor vacancy cleanup", () => {
  beforeEach(() => {
    vi.resetModules();
    deleteMock.mockReset();
    whereMock.mockReset();
    returningMock.mockReset();
    scheduleMock.mockReset();
    selectMock.mockReset();
    fromMock.mockReset();
    inArrayMock.mockReset();
    returningMock.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    whereMock.mockReturnValue({ returning: returningMock });
    deleteMock.mockReturnValue({ where: whereMock });
    selectMock.mockReturnValue({ from: fromMock });
    fromMock.mockReturnValue("source-observation-subquery");
    inArrayMock.mockImplementation((column, values) => ({ kind: "inArray", column, values }));
  });

  it("deletes only confirmed dead rows through a grace-period predicate", async () => {
    const { runSponsorVacancyCleanup } = await import("../../lib/sponsorVacancyCleanup");
    const result = await runSponsorVacancyCleanup();

    expect(deleteMock).toHaveBeenCalledOnce();
    expect(whereMock).toHaveBeenCalledOnce();
    expect(returningMock).toHaveBeenCalledOnce();
    expect(selectMock).toHaveBeenCalledWith({ vacancyId: "sourceObservationVacancyId" });
    expect(fromMock).toHaveBeenCalledWith({ vacancyId: "sourceObservationVacancyId" });
    expect(inArrayMock).toHaveBeenCalledWith("sourceType", ["job_board", "company_site"]);
    expect(inArrayMock).toHaveBeenCalledWith("id", "source-observation-subquery");
    expect(result).toMatchObject({ deleted: 2, graceHours: 24 });
  });

  it("registers a daily London-time cleanup", async () => {
    const { startSponsorVacancyCleanupScheduler } = await import("../../lib/sponsorVacancyCleanup");
    startSponsorVacancyCleanupScheduler();

    expect(scheduleMock).toHaveBeenCalledWith(
      "30 3 * * *",
      expect.any(Function),
      { timezone: "Europe/London" },
    );
  });
});