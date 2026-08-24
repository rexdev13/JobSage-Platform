import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  openaiCreateMock,
  searchNhsJobsMock,
  selectMock,
  insertValuesMock,
  deleteWhereMock,
  cacheLimitMock,
  priorWhereMock,
} = vi.hoisted(() => ({
  openaiCreateMock: vi.fn(),
  searchNhsJobsMock: vi.fn(),
  selectMock: vi.fn(),
  insertValuesMock: vi.fn(),
  deleteWhereMock: vi.fn(),
  cacheLimitMock: vi.fn(),
  priorWhereMock: vi.fn(),
}));

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { responses: { create: openaiCreateMock } },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: selectMock,
    insert: () => ({ values: insertValuesMock }),
    delete: () => ({ where: deleteWhereMock }),
    update: vi.fn(),
  },
  sponsorLicenceVacancyChecksTable: { organisationName: "organisationName", checkedAt: "checkedAt" },
  sponsorLicenceVacanciesTable: {
    organisationName: "organisationName",
    url: "url",
    liveness: "liveness",
    lastVerifiedAt: "lastVerifiedAt",
    livenessReason: "livenessReason",
    id: "id",
  },
  sponsorLicencesTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  gt: vi.fn(),
  desc: vi.fn(),
  sql: vi.fn(),
}));

vi.mock("../../lib/nhsJobsClient", () => ({ searchNhsJobs: searchNhsJobsMock }));
vi.mock("../../lib/linkVerification", () => ({ queueLinkVerificationBatch: vi.fn() }));

const { runVacancyCheck } = await import("../../lib/vacancyCheckHelper");

const originalCap = process.env["VACANCY_AI_WEB_SEARCH_DAILY_CAP"];

describe("runVacancyCheck HTTP-first discovery", () => {
  beforeEach(() => {
    openaiCreateMock.mockReset();
    searchNhsJobsMock.mockReset();
    selectMock.mockReset();
    insertValuesMock.mockReset();
    deleteWhereMock.mockReset();
    cacheLimitMock.mockReset();
    priorWhereMock.mockReset();

    selectMock
      .mockReturnValueOnce({
        from: () => ({ where: () => ({ orderBy: () => ({ limit: cacheLimitMock }) }) }),
      })
      .mockReturnValueOnce({
        from: () => ({ where: priorWhereMock }),
      });
    cacheLimitMock.mockResolvedValue([]);
    priorWhereMock.mockResolvedValue([]);
    insertValuesMock.mockReturnValue({ returning: () => Promise.resolve([{ checkedAt: new Date("2026-08-24T08:00:00.000Z") }]) });
    deleteWhereMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    if (originalCap === undefined) delete process.env["VACANCY_AI_WEB_SEARCH_DAILY_CAP"];
    else process.env["VACANCY_AI_WEB_SEARCH_DAILY_CAP"] = originalCap;
  });

  it("persists an HTTP no-vacancy result without calling OpenAI when the cap is zero", async () => {
    process.env["VACANCY_AI_WEB_SEARCH_DAILY_CAP"] = "0";
    searchNhsJobsMock.mockResolvedValue({
      sourceUrl: "https://www.jobs.nhs.uk/candidate/search/results?employer=Example",
      vacancies: [],
      structuredFeedWorked: false,
      resultsRequestSucceeded: true,
    });

    const result = await runVacancyCheck("Example NHS Trust");

    expect(openaiCreateMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      vacanciesFound: false,
      sourceUrl: "https://www.jobs.nhs.uk/candidate/search/results?employer=Example",
      fromCache: false,
    });
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organisationName: "Example NHS Trust",
        vacanciesFound: false,
        vacancyList: [],
      }),
    );
  });

  it("does not cache a failed NHS request when AI fallback is capped", async () => {
    process.env["VACANCY_AI_WEB_SEARCH_DAILY_CAP"] = "0";
    searchNhsJobsMock.mockResolvedValue({
      sourceUrl: "https://www.jobs.nhs.uk/candidate/search/results?employer=Example",
      vacancies: [],
      structuredFeedWorked: false,
      resultsRequestSucceeded: false,
    });

    const result = await runVacancyCheck("Example NHS Trust");

    expect(openaiCreateMock).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(result.summary).toContain("unavailable");
  });
});