import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchNhsJobsForCandidateMock, searchReedJobsForCandidateMock } = vi.hoisted(() => ({
  searchNhsJobsForCandidateMock: vi.fn(),
  searchReedJobsForCandidateMock: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  const select = vi.fn(() => {
    const builder = {
      where: vi.fn(() => Promise.resolve([])),
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
    };
    return { from: vi.fn(() => builder) };
  });
  return {
    db: {
      select,
      insert: vi.fn(),
      update: vi.fn(),
    },
    sponsorLicenceVacanciesTable: { sourceType: "source_type", id: "id" },
    sponsorLicencesTable: { organisationName: "organisation_name" },
  };
});

vi.mock("../../lib/nhsJobsClient", () => ({
  candidateEmployerMatchesSponsor: vi.fn(),
  searchNhsJobsForCandidate: searchNhsJobsForCandidateMock,
}));

vi.mock("../../lib/reedJobsClient", () => ({
  searchReedJobsForCandidate: searchReedJobsForCandidateMock,
}));

const {
  CANDIDATE_BOARD_FAILURE_CACHE_TTL_MS,
  CANDIDATE_BOARD_CACHE_TTL_MS,
  MAX_CANDIDATE_BOARD_RESULTS,
  candidateBoardSourceForProfession,
  clearCandidateBoardDiscoveryCache,
  hasFreshCandidateBoardSnapshot,
  professionKeywords,
  refreshCandidateBoardVacancies,
} = await import("../../lib/candidateBoardDiscovery");

describe("candidate board shared cache", () => {
  beforeEach(() => {
    clearCandidateBoardDiscoveryCache();
    searchNhsJobsForCandidateMock.mockReset();
    searchReedJobsForCandidateMock.mockReset();
  });

  it("uses a fresh snapshot only when at least 30 solid live rows are under six hours old", () => {
    const now = new Date("2026-08-29T12:00:00Z").getTime();
    const rows = Array.from({ length: 30 }, () => ({
      lastDiscoveredAt: new Date(now - 5 * 60 * 60 * 1000),
      liveness: "live",
      applyUrl: "https://jobs.nhs.uk/candidate/jobadvert/C123",
      sourceType: "job_board",
      boardName: "NHS Jobs",
    }));
    expect(hasFreshCandidateBoardSnapshot(rows, now)).toBe(true);
    expect(hasFreshCandidateBoardSnapshot(rows.slice(0, 29), now)).toBe(false);
    expect(hasFreshCandidateBoardSnapshot([
      ...rows.slice(0, 29),
      { ...rows[29]!, lastDiscoveredAt: new Date(now - 7 * 60 * 60 * 1000) },
    ], now)).toBe(false);
    const reedRows = rows.map((row) => ({
      ...row,
      applyUrl: "https://www.reed.co.uk/jobs/accountant/57262903",
      boardName: "Reed",
    }));
    expect(hasFreshCandidateBoardSnapshot(reedRows, now, "reed")).toBe(true);
    expect(hasFreshCandidateBoardSnapshot(reedRows, now, "nhs")).toBe(false);
    expect(hasFreshCandidateBoardSnapshot(rows, now, "reed")).toBe(false);
    expect(hasFreshCandidateBoardSnapshot(rows.map((row) => ({ ...row, sourceType: "company_site" })), now)).toBe(false);
  });

  it("routes clinical professions to NHS and non-clinical professions to Reed", () => {
    expect(candidateBoardSourceForProfession("Nurse")).toBe("nhs");
    expect(candidateBoardSourceForProfession("Allied Health Professional")).toBe("nhs");
    expect(candidateBoardSourceForProfession("Accountant")).toBe("reed");
    expect(candidateBoardSourceForProfession("Engineer")).toBe("reed");
    expect(candidateBoardSourceForProfession("Teacher / Lecturer")).toBe("reed");
  });

  it("uses broad allied-health keywords instead of physiotherapist alone", () => {
    const keywords = professionKeywords({ profession: "Allied Health Professional" }).toLowerCase();
    expect(keywords).toContain("physiotherapist");
    expect(keywords).toContain("occupational therapist");
    expect(keywords).toContain("radiographer");
    expect(keywords).toContain("paramedic");
  });

  it("shares one in-flight NHS search for the same profession, region, and source", async () => {
    let resolveSearch!: (value: unknown) => void;
    searchNhsJobsForCandidateMock.mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve;
      }),
    );

    const profile = { profession: "nurse", preferredRegion: ["London"] };
    const first = refreshCandidateBoardVacancies(profile);
    const second = refreshCandidateBoardVacancies({
      profession: "NURSE",
      preferredRegion: [" london "],
    });

    expect(searchNhsJobsForCandidateMock).toHaveBeenCalledTimes(1);

    resolveSearch({
      vacancies: [],
      resultsRequestSucceeded: true,
      transientFailure: false,
      sourceUrl: "https://www.jobs.nhs.uk/candidate/search/results",
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ failed: false }),
      expect.objectContaining({ failed: false }),
    ]);
  });

  it("keeps a transient NHS failure behind a long failure cache instead of retrying every request", async () => {
    searchNhsJobsForCandidateMock.mockResolvedValue({
      vacancies: [],
      resultsRequestSucceeded: false,
      transientFailure: true,
      sourceUrl: "https://www.jobs.nhs.uk/candidate/search/results",
    });

    const profile = { profession: "nurse", preferredRegion: "London" };
    const first = await refreshCandidateBoardVacancies(profile);
    const second = await refreshCandidateBoardVacancies(profile);

    expect(first).toMatchObject({ failed: true });
    expect(second).toMatchObject({ failed: true });
    expect(searchNhsJobsForCandidateMock).toHaveBeenCalledTimes(1);
    expect(CANDIDATE_BOARD_FAILURE_CACHE_TTL_MS).toBe(20 * 60 * 1000);
    expect(CANDIDATE_BOARD_CACHE_TTL_MS).toBe(20 * 60 * 1000);
    expect(MAX_CANDIDATE_BOARD_RESULTS).toBe(300);
  });

  it("uses Reed rather than NHS for an accountant live refresh", async () => {
    searchReedJobsForCandidateMock.mockResolvedValue({
      vacancies: [],
      requestSucceeded: true,
      transientFailure: false,
      sourceUrl: "https://www.reed.co.uk/jobs?keywords=accountant",
    });

    await expect(refreshCandidateBoardVacancies({
      profession: "Accountant",
      preferredRegion: "London",
    })).resolves.toMatchObject({ searched: true, failed: false });

    expect(searchReedJobsForCandidateMock).toHaveBeenCalledWith(
      "accountant",
      "London",
      MAX_CANDIDATE_BOARD_RESULTS,
    );
    expect(searchNhsJobsForCandidateMock).not.toHaveBeenCalled();
  });

  it("keeps a nurse live refresh on NHS rather than Reed", async () => {
    searchNhsJobsForCandidateMock.mockResolvedValue({
      vacancies: [],
      resultsRequestSucceeded: true,
      transientFailure: false,
      sourceUrl: "https://www.jobs.nhs.uk/candidate/search/results",
    });

    await expect(refreshCandidateBoardVacancies({
      profession: "Nurse",
      preferredRegion: "London",
    })).resolves.toMatchObject({ searched: true, failed: false });

    expect(searchNhsJobsForCandidateMock).toHaveBeenCalledWith(
      "nurse",
      "London",
      MAX_CANDIDATE_BOARD_RESULTS,
    );
    expect(searchReedJobsForCandidateMock).not.toHaveBeenCalled();
  });
});