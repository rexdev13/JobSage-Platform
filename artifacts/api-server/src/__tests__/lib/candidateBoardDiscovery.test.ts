import { beforeEach, describe, expect, it, vi } from "vitest";

const { searchNhsJobsForCandidateMock } = vi.hoisted(() => ({
  searchNhsJobsForCandidateMock: vi.fn(),
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

const {
  CANDIDATE_BOARD_FAILURE_CACHE_TTL_MS,
  CANDIDATE_BOARD_CACHE_TTL_MS,
  MAX_CANDIDATE_BOARD_RESULTS,
  clearCandidateBoardDiscoveryCache,
  refreshCandidateBoardVacancies,
} = await import("../../lib/candidateBoardDiscovery");

describe("candidate board shared cache", () => {
  beforeEach(() => {
    clearCandidateBoardDiscoveryCache();
    searchNhsJobsForCandidateMock.mockReset();
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
});