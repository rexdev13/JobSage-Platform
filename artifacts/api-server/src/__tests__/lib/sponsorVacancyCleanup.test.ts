import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  deleteMock,
  whereMock,
  returningMock,
  scheduleMock,
  selectMock,
  fromMock,
  sourceWhereMock,
  inArrayMock,
  existsMock,
  likeMock,
  ltMock,
} = vi.hoisted(() => ({
  deleteMock: vi.fn(),
  whereMock: vi.fn(),
  returningMock: vi.fn(),
  scheduleMock: vi.fn(),
  selectMock: vi.fn(),
  fromMock: vi.fn(),
  sourceWhereMock: vi.fn(),
  inArrayMock: vi.fn(),
  existsMock: vi.fn(),
  likeMock: vi.fn(),
  ltMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { delete: deleteMock, select: selectMock },
  sponsorLicenceVacanciesTable: {
    liveness: "liveness",
    livenessReason: "livenessReason",
    lastVerifiedAt: "lastVerifiedAt",
    id: "id",
    sourceType: "sourceType",
  },
  vacancySourceObservationsTable: {
    vacancyId: "sourceObservationVacancyId",
    sourceType: "sourceObservationSourceType",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...conditions: unknown[]) => conditions),
  eq: vi.fn((...args: unknown[]) => ({ kind: "eq", args })),
  exists: existsMock,
  inArray: inArrayMock,
  isNotNull: vi.fn((...args: unknown[]) => ({ kind: "isNotNull", args })),
  like: likeMock,
  lt: ltMock,
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
    sourceWhereMock.mockReset();
    inArrayMock.mockReset();
    existsMock.mockReset();
    likeMock.mockReset();
    ltMock.mockReset();
    returningMock.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    whereMock.mockReturnValue({ returning: returningMock });
    deleteMock.mockReturnValue({ where: whereMock });
    selectMock.mockReturnValue({ from: fromMock });
    fromMock.mockReturnValue({ where: sourceWhereMock });
    sourceWhereMock.mockReturnValue("source-observation-subquery");
    existsMock.mockReturnValue("source-observation-exists");
    inArrayMock.mockImplementation((column, values) => ({ kind: "inArray", column, values }));
    likeMock.mockImplementation((...args) => ({ kind: "like", args }));
    ltMock.mockImplementation((...args) => ({ kind: "lt", args }));
  });

  it("deletes only explicitly confirmed dead rows with matching importer provenance and a grace period", async () => {
    const { runSponsorVacancyCleanup } = await import("../../lib/sponsorVacancyCleanup");
    const result = await runSponsorVacancyCleanup();

    expect(deleteMock).toHaveBeenCalledOnce();
    expect(whereMock).toHaveBeenCalledOnce();
    expect(returningMock).toHaveBeenCalledOnce();
    expect(selectMock).toHaveBeenCalledWith({ vacancyId: "sourceObservationVacancyId" });
    expect(fromMock).toHaveBeenCalledWith(expect.objectContaining({
      vacancyId: "sourceObservationVacancyId",
      sourceType: "sourceObservationSourceType",
    }));
    expect(sourceWhereMock).toHaveBeenCalledOnce();
    expect(existsMock).toHaveBeenCalledWith("source-observation-subquery");
    expect(likeMock).toHaveBeenCalledWith("livenessReason", "confirmed_dead:%");
    expect(inArrayMock).toHaveBeenCalledWith("sourceType", ["job_board", "company_site"]);
    expect(ltMock).toHaveBeenCalledWith("lastVerifiedAt", expect.any(Date));
    expect(result).toMatchObject({ deleted: 2, graceHours: 24 });
  });

  it("does not let a caller bypass the 24-hour minimum grace period", async () => {
    const { runSponsorVacancyCleanup } = await import("../../lib/sponsorVacancyCleanup");
    const result = await runSponsorVacancyCleanup({ graceHours: 0 });

    expect(result.graceHours).toBe(24);
    expect(ltMock).toHaveBeenCalledWith("lastVerifiedAt", expect.any(Date));
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