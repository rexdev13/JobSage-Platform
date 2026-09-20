import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAdditionalBoardBackfillState,
  runAdditionalBoardProfessionBackfill,
} from "../../lib/additionalBoardProfessionBackfill";

const target = {
  profession: "Architect",
  category: "ARCHITECTURE" as const,
  keywords: "architect",
};

function vacancy(id: string, employer = "Example Design University") {
  return {
    title: "Project Architect",
    employer,
    location: "London",
    salary: "£50,000",
    url: `https://www.jobs.ac.uk/job/${id}/project-architect`,
    description: null,
    postedDate: null,
    targetRegions: null,
    externalListingId: id,
    contactEmail: null,
    contactEvidenceUrl: `https://www.jobs.ac.uk/job/${id}/project-architect`,
  };
}

describe("additional board profession backfill", () => {
  beforeEach(clearAdditionalBoardBackfillState);

  it("strictly sponsor-matches, classifies, persists, and records source metrics", async () => {
    const persist = vi.fn(async (adverts: readonly { url: string }[]) => ({
      inserted: adverts.length,
      updated: 0,
      revived: 0,
    }));
    const recordSourceMetrics = vi.fn(async () => {});
    const result = await runAdditionalBoardProfessionBackfill({
      sources: [{
        id: "jobs_ac_uk",
        boardName: "jobs.ac.uk",
        totalLimit: 40,
        targets: [target],
        search: async () => ({
          vacancies: [vacancy("ABC123"), vacancy("ABC124", "Unrelated Ltd")],
          requestSucceeded: true,
          transientFailure: false,
          status: 200,
        }),
      }],
      loadSponsors: async () => ["Example Design University"],
      persist,
      readVisibility: async (urls) => ({ live: urls.length, candidateVisible: urls.length }),
      recordSourceMetrics,
    });

    expect(persist).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      discovered: 2,
      sponsorMatched: 1,
      classified: 1,
      live: 1,
      candidateVisible: 1,
      inserted: 1,
    });
    expect(recordSourceMetrics).toHaveBeenCalledTimes(1);
  });

  it("enters source cooldown after a 429 and skips later categories", async () => {
    const search = vi.fn(async () => ({
      vacancies: [],
      requestSucceeded: false,
      transientFailure: true,
      status: 429,
    }));
    const result = await runAdditionalBoardProfessionBackfill({
      sources: [{
        id: "jobs_ac_uk",
        boardName: "jobs.ac.uk",
        totalLimit: 80,
        targets: [target, { ...target, profession: "Architect 2" }],
        search,
      }],
      loadSponsors: async () => ["Example Design University"],
      recordSourceMetrics: async () => {},
    });

    expect(search).toHaveBeenCalledTimes(1);
    expect(result.sources[0]?.categories[0]).toMatchObject({ failed: true, status: 429 });
    expect(result.sources[0]?.categories[1]).toMatchObject({ skippedByCooldown: true });
  });
});