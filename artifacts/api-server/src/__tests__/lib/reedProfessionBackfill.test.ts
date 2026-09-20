import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearReedProfessionBackfillCooldown,
  REED_PROFESSION_BACKFILL_TARGETS,
  runReedProfessionBackfill,
} from "../../lib/reedProfessionBackfill";

function reedVacancy(
  title: string,
  employer: string,
  id: string,
  url = `https://www.reed.co.uk/jobs/${id}/${id.replace(/\D/g, "") || "123456"}`,
) {
  return {
    title,
    employer,
    location: "London",
    salary: null,
    url,
    description: null,
    postedDate: "today",
    targetRegions: null,
    sourceType: "job_board" as const,
    boardName: "Reed" as const,
    externalListingId: id,
    contactEmail: null,
    contactEvidenceUrl: null,
  };
}

describe("bounded Reed profession backfill", () => {
  beforeEach(() => {
    clearReedProfessionBackfillCooldown();
  });

  it("runs each configured category, strictly sponsor-matches, classifies, and persists deduped adverts", async () => {
    const search = vi.fn(async (keywords: string, _region: string | null, limit: number) => {
      expect(limit).toBe(40);
      if (keywords === "teacher OR lecturer") {
        return {
          vacancies: [
            reedVacancy("Primary Teacher", "Acme Education Ltd", "100001"),
            reedVacancy("Primary Teacher", "Acme Education Ltd", "100001"),
            reedVacancy("Software Developer", "Not A Sponsor", "100002"),
          ],
          sourceUrl: "https://www.reed.co.uk/jobs?keywords=teacher",
          requestSucceeded: true,
          transientFailure: false,
        };
      }
      if (keywords === "engineer") {
        return {
          vacancies: [reedVacancy("Civil Engineer", "Acme Engineering Ltd", "100003")],
          sourceUrl: "https://www.reed.co.uk/jobs?keywords=engineer",
          requestSucceeded: true,
          transientFailure: false,
        };
      }
      return {
        vacancies: [],
        sourceUrl: `https://www.reed.co.uk/jobs?keywords=${keywords}`,
        requestSucceeded: true,
        transientFailure: false,
      };
    });
    const persist = vi.fn(async (adverts: readonly { url: string }[]) => ({
      inserted: adverts.length,
      updated: 0,
      revived: 0,
    }));
    const readVisibility = vi.fn(async (urls: readonly string[]) => ({
      live: urls.length,
      candidateVisible: urls.length,
    }));
    const recordMetrics = vi.fn(async () => {});

    const result = await runReedProfessionBackfill({
      loadSponsors: async () => ["Acme Education Ltd", "Acme Engineering Ltd"],
      search,
      persist,
      readVisibility,
      recordMetrics,
    });

    expect(search).toHaveBeenCalledTimes(REED_PROFESSION_BACKFILL_TARGETS.length);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist.mock.calls[0]?.[0]).toHaveLength(1);
    expect(persist.mock.calls[1]?.[0]).toHaveLength(1);
    expect(result.categories[0]).toMatchObject({
      category: "EDUCATION",
      discovered: 3,
      sponsorMatched: 2,
      classified: 1,
      inserted: 1,
      candidateVisible: 1,
    });
    expect(result.categories[1]).toMatchObject({
      category: "ENGINEERING",
      sponsorMatched: 1,
      classified: 1,
      inserted: 1,
    });
    expect(result.sponsorMatched).toBe(3);
    expect(result.classified).toBe(2);
    expect(recordMetrics).toHaveBeenCalledTimes(1);
  });

  it("enforces the total persistence cap while still completing every category search", async () => {
    const search = vi.fn(async (keywords: string) => ({
      vacancies: keywords === "teacher OR lecturer"
        ? Array.from({ length: 4 }, (_, index) =>
            reedVacancy(`Teacher ${index}`, "Acme Education Ltd", `20000${index}`),
          )
        : [],
      sourceUrl: "https://www.reed.co.uk/jobs",
      requestSucceeded: true,
      transientFailure: false,
    }));
    const persist = vi.fn(async (adverts: readonly { url: string }[]) => ({
      inserted: adverts.length,
      updated: 0,
      revived: 0,
    }));

    const result = await runReedProfessionBackfill({
      loadSponsors: async () => ["Acme Education Ltd"],
      search,
      persist,
      perCategoryLimit: 4,
      totalPersistLimit: 2,
      readVisibility: async (urls) => ({ live: urls.length, candidateVisible: urls.length }),
      recordMetrics: async () => {},
    });

    expect(search).toHaveBeenCalledTimes(REED_PROFESSION_BACKFILL_TARGETS.length);
    expect(persist.mock.calls[0]?.[0]).toHaveLength(2);
    expect(result.categories[0]?.skippedByTotalCap).toBe(2);
    expect(result.categories[0]?.classified).toBe(4);
  });

  it("stops repeated Reed requests behind a failure cooldown", async () => {
    const search = vi.fn(async () => ({
      vacancies: [],
      sourceUrl: "https://www.reed.co.uk/jobs",
      requestSucceeded: false,
      transientFailure: true,
    }));

    const first = await runReedProfessionBackfill({
      loadSponsors: async () => ["Acme Ltd"],
      search,
      recordMetrics: async () => {},
    });
    const second = await runReedProfessionBackfill({
      loadSponsors: async () => ["Acme Ltd"],
      search,
      recordMetrics: async () => {},
    });

    expect(first.failed).toBe(true);
    expect(first.categories).toHaveLength(REED_PROFESSION_BACKFILL_TARGETS.length);
    expect(second).toMatchObject({
      started: false,
      skipped: true,
      skipReason: "failure_cooldown",
    });
    expect(search).toHaveBeenCalledTimes(REED_PROFESSION_BACKFILL_TARGETS.length);
  });
});