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
      sourceType: "job_board",
      boardName: "NHS Jobs",
      externalListingId: "C9000-26-0001",
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

  it("uses explicit target regions first, then location text, while leaving unknown locations unrestricted", async () => {
    rows = [
      vacancyRow({ id: 20, targetRegions: ["North West"], location: "London" }),
      vacancyRow({ id: 21, targetRegions: [], location: "London" }),
      vacancyRow({ id: 22, targetRegions: [], location: "Remote in the UK" }),
    ];

    const result = await fetchSponsorVacanciesAsRoles("NMC");

    expect(result.find((role) => role.id === 2_000_020)?.targetRegions).toEqual(["North West"]);
    expect(result.find((role) => role.id === 2_000_021)?.targetRegions).toEqual(["London"]);
    expect(result.find((role) => role.id === 2_000_022)?.targetRegions).toEqual([]);
  });

  it("hides company-site rows until the exact deep link is verified live", async () => {
    rows = [
      vacancyRow({
        id: 30,
        sourceType: "company_site",
        boardName: null,
        externalListingId: null,
        url: "https://careers.example.nhs.uk/jobs/senior-staff-nurse-30",
        liveness: "unverified",
      }),
      vacancyRow({
        id: 31,
        sourceType: "company_site",
        boardName: null,
        externalListingId: null,
        url: "https://careers.example.nhs.uk/jobs/senior-staff-nurse-31",
        liveness: "live",
      }),
    ];

    const result = await fetchSponsorVacanciesAsRoles("NMC");

    expect(result.map((role) => role.id)).toEqual([2_000_031]);
  });

  it("returns classified professional engineering vacancies for engineer candidates", async () => {
    rows = [
      vacancyRow({
        id: 40,
        organisationName: "Acme Engineering Limited",
        title: "Senior Structural Engineer",
        sourceType: "company_site",
        boardName: null,
        externalListingId: null,
        url: "https://careers.acme.example/jobs/senior-structural-engineer-40",
      }),
    ].map((row: any) => ({
      ...row,
      lic: { ...row.lic, industry: "Engineering design activities" },
    }));

    const result = await fetchSponsorVacanciesAsRoles("ENGINEERING");

    expect(result).toEqual([
      expect.objectContaining({
        id: 2_000_040,
        regulator: "ENGINEERING",
        requiredRegistration: "UK professional engineering pathway",
      }),
    ]);
  });

  it("keeps unrelated construction, software, and accounting roles out of clinical Opportunities", async () => {
    rows = [
      vacancyRow({ id: 50, title: "Construction Project Manager" }),
      vacancyRow({ id: 51, title: "Software Developer" }),
      vacancyRow({ id: 52, title: "Senior Accountant" }),
      vacancyRow({ id: 53, title: "Senior Staff Nurse" }),
    ];

    const result = await fetchSponsorVacanciesAsRoles("NMC");

    expect(result.map((role) => role.id)).toEqual([2_000_053]);
  });
});