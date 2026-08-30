import { describe, expect, it, vi } from "vitest";
import {
  boardVacancyFingerprint,
  discoverEmployerBoardVacancies,
  normaliseAndDedupeBoardAdverts,
  type BoardAdapter,
  type BoardAdvert,
} from "../../lib/boardVacancyPipeline";

function advert(overrides: Partial<BoardAdvert> = {}): BoardAdvert {
  return {
    organisationName: "Example NHS Trust",
    employer: "Example NHS Trust",
    title: "Staff Nurse",
    location: "London",
    salary: null,
    url: "https://www.jobs.nhs.uk/candidate/jobadvert/C123?language=en",
    description: null,
    postedDate: null,
    targetRegions: ["London"],
    boardName: "NHS Jobs",
    externalId: "C123",
    ...overrides,
  };
}

describe("shared board vacancy pipeline", () => {
  it("supports a fake board through the adapter contract without pipeline changes", async () => {
    const adapter: BoardAdapter = {
      id: "fake",
      reserve: vi.fn().mockResolvedValue({ allowed: true, organisationKey: "example", leaseId: "1" }),
      complete: vi.fn().mockResolvedValue(undefined),
      fail: vi.fn().mockResolvedValue(null),
      searchByEmployer: vi.fn().mockResolvedValue({
        sourceUrl: "https://fake.example/jobs",
        adverts: [advert()],
        requestSucceeded: true,
        transientFailure: false,
      }),
    };

    const result = await discoverEmployerBoardVacancies("Example NHS Trust", [adapter]);

    expect(result.adverts).toHaveLength(1);
    expect(result.boardCounts).toEqual({ fake: 1 });
    expect(adapter.complete).toHaveBeenCalledTimes(1);
  });

  it("deduplicates canonical URLs and organisation/title/location fingerprints with NHS preference", () => {
    const result = normaliseAndDedupeBoardAdverts([
      advert({
        boardName: "Reed",
        url: "https://www.reed.co.uk/jobs/staff-nurse/12345?utm_source=test",
        externalId: "12345",
      }),
      advert(),
      advert({ url: "https://www.jobs.nhs.uk/candidate/jobadvert/C123?language=en&utm_medium=email" }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ boardName: "NHS Jobs", externalId: "C123" });
  });

  it("keeps a direct employer advert when a job-board advert has the same fingerprint", () => {
    const result = normaliseAndDedupeBoardAdverts([
      advert(),
      advert({
        sourceType: "company_site",
        url: "https://careers.example.nhs.uk/jobs/staff-nurse-123",
        boardName: null,
        externalId: null,
      }),
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.sourceType).sort()).toEqual(["company_site", "job_board"]);
  });

  it("drops manual-labour titles before persistence", () => {
    expect(normaliseAndDedupeBoardAdverts([advert({ title: "Warehouse Operative" })])).toEqual([]);
  });

  it("normalises fingerprint case, whitespace, and punctuation", () => {
    expect(boardVacancyFingerprint(advert())).toBe(
      boardVacancyFingerprint(advert({
        organisationName: " EXAMPLE   NHS TRUST ",
        title: "Staff-Nurse",
        location: "LONDON!",
      })),
    );
  });
});