import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearAdditionalBoardBackfillState,
  getAdditionalBoardBackfillPlan,
  NHS_PROFESSION_BACKFILL_TARGETS,
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

  it("searches NHS healthcare professions before the other board sources", () => {
    const plan = getAdditionalBoardBackfillPlan();
    expect(plan.slice(0, NHS_PROFESSION_BACKFILL_TARGETS.length).map((item) => item.source))
      .toEqual(NHS_PROFESSION_BACKFILL_TARGETS.map(() => "nhs_jobs"));
    expect(plan[0]).toMatchObject({ source: "nhs_jobs", target: { profession: "Nurse", category: "NMC" } });
  });

  it("keeps an NHS nurse advert when the employer is a sponsor and drops everyone else", async () => {
    const persist = vi.fn(async (adverts: readonly { title: string; boardName: string | null }[]) => ({
      inserted: adverts.length,
      updated: 0,
      revived: 0,
    }));
    const result = await runAdditionalBoardProfessionBackfill({
      sources: [{
        id: "nhs_jobs",
        boardName: "NHS Jobs",
        acceptedBoardNames: ["NHS Jobs", "Trac", "HealthJobsUK"],
        totalLimit: 40,
        targets: [NHS_PROFESSION_BACKFILL_TARGETS[0]],
        search: async () => ({
          vacancies: [
            {
              title: "Staff Nurse",
              employer: "Royal Free London NHS Foundation Trust",
              location: "London",
              salary: null,
              url: "https://www.jobs.nhs.uk/candidate/jobadvert/C1234-56-7890",
              description: null,
              postedDate: null,
              targetRegions: null,
              externalListingId: "C1234-56-7890",
              contactEmail: "recruitment@example.nhs.uk",
              contactEvidenceUrl: "https://www.jobs.nhs.uk/candidate/jobadvert/C1234-56-7890",
            },
            {
              title: "Staff Nurse",
              employer: "Not A Sponsor Clinic",
              location: "London",
              salary: null,
              url: "https://www.jobs.nhs.uk/candidate/jobadvert/C9999-00-0001",
              description: null,
              postedDate: null,
              targetRegions: null,
              externalListingId: "C9999-00-0001",
              contactEmail: null,
              contactEvidenceUrl: null,
            },
          ],
          requestSucceeded: true,
          transientFailure: false,
          status: 200,
        }),
      }],
      loadSponsors: async () => ["Royal Free London NHS Foundation Trust"],
      persist,
      readVisibility: async () => ({ live: 1, candidateVisible: 1 }),
      recordSourceMetrics: async () => {},
    });

    expect(result).toMatchObject({ discovered: 2, sponsorMatched: 1, classified: 1, inserted: 1 });
    expect(persist.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        title: "Staff Nurse",
        boardName: "NHS Jobs",
        organisationName: "Royal Free London NHS Foundation Trust",
        contactEmail: "recruitment@example.nhs.uk",
      }),
    ]);
  });
});