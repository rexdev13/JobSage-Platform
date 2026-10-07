import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("../../lib/companySiteHttp", () => ({ fetchCompanySitePage: mocks.fetch }));

beforeEach(() => {
  vi.resetModules();
  mocks.fetch.mockReset();
});

const progress = {
  phase: "sitemap", offset: 0, sitemapHash: null, listedIds: ["listed-role"],
  listRecordsFetched: 1, reportedTotal: 1, reportedTotalChanged: false,
  listCoverageWarning: null,
};
const context = (cursor: string | null) => ({
  cursor, deadlineMs: Date.now() + 15_000, seenExternalIds: new Set<string>(),
});
const response = (body: string) => ({ ok: true, status: 200, body });

describe("bounded free-board source requests", () => {
  it("checkpoints a Teaching sitemap snapshot without requesting details", async () => {
    mocks.fetch.mockResolvedValue(response(`<urlset>
      <url><loc>https://teaching-vacancies.service.gov.uk/jobs/listed-role</loc></url>
      <url><loc>https://teaching-vacancies.service.gov.uk/jobs/extra-one</loc></url>
      <url><loc>https://teaching-vacancies.service.gov.uk/jobs/extra-two</loc></url>
    </urlset>`));
    const { FREE_BOARD_SOURCES, parseTeachingCursor } = await import("../../lib/freeBoardSources");
    const source = FREE_BOARD_SOURCES.find((source) => source.id === "teaching-vacancies")!;
    const page = await source.fetchPage(context(JSON.stringify(progress)));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(page).toMatchObject({
      adverts: [], recordsFetched: 0, stopAfterPage: true, sitemapTotal: 3, sitemapOnlyCount: 2,
    });
    expect(parseTeachingCursor(page.nextCursor)).toMatchObject({
      offset: 0, sitemapBackfillSlugs: ["extra-one", "extra-two"], sitemapTotal: 3,
    });

    // Simulate a new autoscale process with no in-memory sitemap cache.
    vi.resetModules();
    mocks.fetch.mockReset().mockResolvedValue(response(JSON.stringify({
      title: "Teacher", hiringOrganization: { name: "Example School" },
    })));
    const reloaded = await import("../../lib/freeBoardSources");
    const resumed = await reloaded.FREE_BOARD_SOURCES
      .find((source) => source.id === "teaching-vacancies")!
      .fetchPage(context(page.nextCursor));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch.mock.calls[0]?.[0]).toContain("/api/v1/jobs/extra-one.json");
    expect(resumed.adverts[0]?.externalId).toBe("extra-one");
    expect(reloaded.parseTeachingCursor(resumed.nextCursor)).toMatchObject({
      offset: 1, sitemapBackfillSlugs: ["extra-one", "extra-two"],
    });
  });

  it("propagates the actual host retry time without consuming a Teaching detail", async () => {
    const retryAt = new Date(Date.now() + 60_000);
    mocks.fetch.mockResolvedValue({
      ok: false, kind: "rate_limited", reason: "hostname is paced or in backoff", retryAt,
    });
    const { FREE_BOARD_SOURCES } = await import("../../lib/freeBoardSources");
    const source = FREE_BOARD_SOURCES.find((source) => source.id === "teaching-vacancies")!;
    const cursor = JSON.stringify({
      ...progress, sitemapHash: "hash", sitemapBackfillSlugs: ["extra-one"], sitemapTotal: 2,
    });
    await expect(source.fetchPage(context(cursor))).rejects.toMatchObject({ retryAt });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("retains the jobs.ac.uk index when its empty page precedes its reported end", async () => {
    mocks.fetch.mockResolvedValue(response("<h1>2,129 Jobs Found</h1>"));
    const { SUPPLEMENTAL_FREE_BOARD_SOURCES } = await import("../../lib/supplementalFreeBoardSources");
    const page = await SUPPLEMENTAL_FREE_BOARD_SOURCES
      .find((source) => source.id === "jobs-ac-uk")!
      .fetchPage(context("1876"));
    expect(page).toMatchObject({
      nextCursor: "1876", recordsFetched: 0, reportedTotal: 2129,
      coverageWarning: expect.stringContaining("expected 25"),
    });
  });
});
