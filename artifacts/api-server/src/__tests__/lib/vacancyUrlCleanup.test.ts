import { beforeEach, describe, expect, it, vi } from "vitest";

const { rows, updateMock, writeAuditEventMock } = vi.hoisted(() => ({
  rows: [] as Array<{
    id: number;
    url: string;
    organisationName: string;
    sourceType: string | null;
  }>,
  updateMock: vi.fn(),
  writeAuditEventMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(rows)),
      })),
    })),
    update: updateMock,
  },
  sponsorLicenceVacanciesTable: {
    id: "id",
    url: "url",
    organisationName: "organisation_name",
    sourceType: "source_type",
  },
}));

vi.mock("../../lib/audit", () => ({
  writeAuditEvent: writeAuditEventMock,
}));

const { runVacancyUrlCleanup } = await import("../../lib/vacancyUrlCleanup");

describe("vacancy URL cleanup", () => {
  beforeEach(() => {
    rows.length = 0;
    updateMock.mockReset();
    writeAuditEventMock.mockClear();
  });

  it("preserves a valid Reed deep link stored as a job-board advert", async () => {
    rows.push({
      id: 1,
      url: "https://www.reed.co.uk/jobs/management-accountant/57262903",
      organisationName: "Example Finance Ltd",
      sourceType: "job_board",
    });

    await expect(runVacancyUrlCleanup("test")).resolves.toMatchObject({
      scanned: 1,
      aggregatorPurges: 0,
      genericPurges: 0,
      remainingValidDeepLinks: 1,
    });
    expect(updateMock).not.toHaveBeenCalled();
  });
});