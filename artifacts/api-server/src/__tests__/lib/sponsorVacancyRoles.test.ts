import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock, gtMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  gtMock: vi.fn(),
}));

let rows: unknown[] = [];

vi.mock("@workspace/db", () => {
  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return {
    db: { select: selectMock.mockImplementation(() => chain) },
    sponsorLicenceVacanciesTable: {
      id: "id",
      organisationName: "organisationName",
      liveness: "liveness",
      createdAt: "createdAt",
    },
    sponsorLicencesTable: { organisationName: "organisationName" },
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: vi.fn(),
  gt: gtMock,
  ne: vi.fn(),
}));

const { fetchSponsorVacanciesAsRoles } = await import("../../lib/sponsorVacancyRoles");

const NHS_URL = "https://www.jobs.nhs.uk/candidate/jobadvert/C9000-26-0001?language=en";

function vacancyRow(overrides: Record<string, unknown> = {}) {
  return {
    vac: {
      id: 10,
      organisationName: "Example NHS Trust",
      title: "Senior Staff Nurse",
      location: "London",
      url: NHS_URL,
      description: null,
      createdAt: new Date("2026-08-24T06:30:00.000Z"),
      liveness: "live",
      lastVerifiedAt: new Date("2026-08-24T06:35:00.000Z"),
      livenessReason: null,
      ...overrides,
    },
    lic: {
      contactEmail: "jobs@example.nhs.uk",
      contactPhone: null,
      website: "https://example.nhs.uk",
      industry: "Hospital activities",
    },
  };
}

describe("fetchSponsorVacanciesAsRoles alert options", () => {
  beforeEach(() => {
    rows = [];
    selectMock.mockClear();
    gtMock.mockClear();
  });

  it("keeps only specific, non-dead vacancy URLs when preparing an alert", async () => {
    rows = [
      vacancyRow(),
      vacancyRow({ id: 11, url: null }),
      vacancyRow({ id: 12, liveness: "dead" }),
    ];
    const since = new Date("2026-08-24T06:00:00.000Z");

    const result = await fetchSponsorVacanciesAsRoles("NMC", {
      since,
      requireSpecificVacancyUrl: true,
    });

    expect(gtMock).toHaveBeenCalledWith("createdAt", since);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 2_000_010,
      title: "Senior Staff Nurse",
      applyUrl: NHS_URL,
      linkVerified: true,
    });
  });
});