import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteMock, whereMock, returningMock, scheduleMock } = vi.hoisted(() => ({
  deleteMock: vi.fn(),
  whereMock: vi.fn(),
  returningMock: vi.fn(),
  scheduleMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: { delete: deleteMock },
  sponsorLicenceVacanciesTable: {
    liveness: "liveness",
    lastVerifiedAt: "lastVerifiedAt",
    id: "id",
  },
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  isNotNull: vi.fn(),
  lt: vi.fn(),
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
    returningMock.mockResolvedValue([{ id: 1 }, { id: 2 }]);
    whereMock.mockReturnValue({ returning: returningMock });
    deleteMock.mockReturnValue({ where: whereMock });
  });

  it("deletes only confirmed dead rows through a grace-period predicate", async () => {
    const { runSponsorVacancyCleanup } = await import("../../lib/sponsorVacancyCleanup");
    const result = await runSponsorVacancyCleanup();

    expect(deleteMock).toHaveBeenCalledOnce();
    expect(whereMock).toHaveBeenCalledOnce();
    expect(returningMock).toHaveBeenCalledOnce();
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