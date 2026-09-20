import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectMock, leftJoinMock, eqMock, gtMock, sqlMock } = vi.hoisted(() => ({
  selectMock: vi.fn(),
  leftJoinMock: vi.fn(),
  eqMock: vi.fn(),
  gtMock: vi.fn(),
  sqlMock: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
}));

let rows: unknown[] = [];

vi.mock("@workspace/db", () => {
  const chain: any = {
    from: () => chain,
    leftJoin: (...args: unknown[]) => {
      leftJoinMock(...args);
      return chain;
    },
    where: () => chain,
    then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return {
    db: { select: selectMock.mockImplementation(() => chain) },
    sponsorLicenceVacanciesTable: {
      id: "id",
      organisationName: "vacancyOrganisationName",
      liveness: "liveness",
      createdAt: "createdAt",
      sourceType: "sourceType",
    },
    sponsorLicencesTable: { organisationName: "sponsorOrganisationName" },
  };
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn(),
  eq: eqMock,
  gt: gtMock,
  ne: vi.fn(),
  sql: sqlMock,
}));

const {
  classifyVacancyCategory,
  fetchSponsorVacanciesAsRoles,
  inferVacancySponsorshipStatus,
  presentApplyLink,
} = await import("../../lib/sponsorVacancyRoles");

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
      lastVerifiedAt: new Date(),
      companyEvidenceLegacyUntil: new Date(Date.now() + 86400000),
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
    leftJoinMock.mockClear();
    eqMock.mockClear();
    gtMock.mockClear();
    sqlMock.mockClear();
  });

  it("joins vacancy contacts to sponsors using trimmed case-insensitive identity", async () => {
    rows = [vacancyRow()];

    await fetchSponsorVacanciesAsRoles("NMC");

    expect(sqlMock).toHaveBeenCalledWith(
      expect.any(Array),
      "vacancyOrganisationName",
      "sponsorOrganisationName",
    );
    expect(leftJoinMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        values: ["vacancyOrganisationName", "sponsorOrganisationName"],
      }),
    );
  });

  it("preserves dead URL evidence and distinguishes none, stale, and live", () => {
    expect(presentApplyLink(NHS_URL, "dead", new Date(), "soft_closed")).toMatchObject({
      applyUrl: NHS_URL,
      linkStatus: "dead",
      linkVerified: false,
    });
    expect(presentApplyLink(null, "dead", new Date())).toMatchObject({
      applyUrl: null,
      linkStatus: "none",
    });
    expect(presentApplyLink(NHS_URL, "live", new Date(0))).toMatchObject({
      applyUrl: NHS_URL,
      linkStatus: "stale",
      linkVerified: false,
    });
    expect(presentApplyLink(NHS_URL, "live", new Date())).toMatchObject({
      linkStatus: "live",
      linkVerified: true,
    });
  });

  it.each([
    ["Visa sponsorship is available for this role.", "confirmed"],
    ["We offer Skilled Worker sponsorship.", "confirmed"],
    ["Certificate of Sponsorship available.", "confirmed"],
    ["We cannot offer visa sponsorship for this role.", "not_offered"],
    ["Sponsorship is not available.", "not_offered"],
    ["Sponsorship may be considered depending on circumstances.", "unknown"],
    [null, "unknown"],
  ])("classifies vacancy sponsorship evidence %j as %s", (description, expected) => {
    expect(inferVacancySponsorshipStatus("Senior Staff Nurse", description)).toBe(expected);
  });

  it("keeps sponsor licensing separate from unconfirmed vacancy sponsorship", async () => {
    rows = [vacancyRow({ description: "Join our friendly nursing team." })];

    const [result] = await fetchSponsorVacanciesAsRoles("NMC");

    expect(result).toMatchObject({
      licensedSponsor: true,
      sponsorshipStatus: "unknown",
      sponsorshipOffered: false,
    });
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

  it("filters candidate vacancy tabs by source in the database query", async () => {
    rows = [vacancyRow()];

    await fetchSponsorVacanciesAsRoles("NMC", { sourceType: "job_board" });

    expect(eqMock).toHaveBeenCalledWith("sourceType", "job_board");
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
        regulator: null,
        opportunityCategory: "ENGINEERING",
        statutoryRegulator: null,
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

  it.each([
    ["Consultant Dentist", "DENTAL"],
    ["Dental Nurses", "DENTAL"],
    ["Clinical Pharmacist", "PHARMACY"],
    ["Nurse Pharmacist Practitioner", "PHARMACY"],
    ["Senior Social Worker", "SOCIAL_WORK"],
    ["Management Accountant", "ACCOUNTING"],
    ["Software Engineer", "IT"],
    ["Construction Engineer", "ENGINEERING"],
    ["Optometrist", "HCPC"],
    ["Senior Clinical Academic", "GMC"],
    ["Commercial Solicitor", "LEGAL"],
    ["Project Architect", "ARCHITECTURE"],
    ["University Lecturer", "EDUCATION"],
    ["Clinical Research Administrator", "GMC"],
  ])("classifies %s as %s", (title, expected) => {
    expect(classifyVacancyCategory(title, null)).toBe(expected);
  });

  it.each([
    ["Medical Director", "GMC"],
    ["Foundation Doctor FY1", "GMC"],
    ["Specialty Registrar in Cardiology", "GMC"],
    ["Physio - Musculoskeletal Outpatients", "HCPC"],
    ["Speech and Language Therapist (SLT)", "HCPC"],
    ["Trainee Education Mental Health Practitioner", "EDUCATION"],
    ["Early Years Practitioner", "EDUCATION"],
    ["Teaching Assistant", "EDUCATION"],
    ["Engineering Technician", "ENGINEERING"],
    ["Network Engineer", "IT"],
    ["Cloud Engineer", "IT"],
    ["Data Analyst", "IT"],
    ["Database Administrator", "IT"],
  ])("classifies common job-board title %s as %s", (title, expected) => {
    expect(classifyVacancyCategory(title, null)).toBe(expected);
  });

  it.each([
    ["Apply to the Prep School Nursery"],
    ["Nursing Assistant Job In UK. CoS Available"],
    ["Healthcare Support Worker"],
    ["Careers Why I chose a job in social care for my first nursing role"],
  ])("does not classify non-NMC title %s as a nursing vacancy", (title) => {
    expect(classifyVacancyCategory(title, null)).toBeNull();
  });

  it.each([
    ["Registered Nurse RGN/RMN", "NMC"],
    ["Care Home Manager Nursing", "NMC"],
    ["Senior Ward Sister", "NMC"],
  ])("retains genuine nursing title %s as %s", (title, expected) => {
    expect(classifyVacancyCategory(title, null)).toBe(expected);
  });

  it("retains software engineering for IT and engineering candidates but not nurses", async () => {
    rows = [
      vacancyRow({
        id: 60,
        organisationName: "Acme Digital Limited",
        title: "Software Engineer",
      }),
    ];

    expect((await fetchSponsorVacanciesAsRoles("IT")).map((role) => role.id)).toEqual([2_000_060]);
    expect((await fetchSponsorVacanciesAsRoles("ENGINEERING")).map((role) => role.id)).toEqual([2_000_060]);
    expect(await fetchSponsorVacanciesAsRoles("NMC")).toEqual([]);
  });
});