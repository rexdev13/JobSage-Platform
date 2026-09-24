import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/companySiteHttp", () => ({
  fetchCompanySitePublicApiPage: vi.fn(),
}));

const {
  parseDirectBoardMapping,
  fetchDirectEmployerBoard,
} = await import("../../lib/directEmployerBoardConnectors");
const { fetchCompanySitePublicApiPage } = await import("../../lib/companySiteHttp");

describe("direct employer board connectors", () => {
  it("derives strict board mappings only from saved platform URLs", () => {
    expect(parseDirectBoardMapping("Ashby", "https://jobs.ashbyhq.com/9fin")).toMatchObject({
      provider: "Ashby",
      boardId: "9fin",
    });
    expect(parseDirectBoardMapping("Greenhouse", "https://boards.greenhouse.io/appier")).toMatchObject({
      provider: "Greenhouse",
      boardId: "appier",
    });
    expect(parseDirectBoardMapping("Lever", "https://jobs.lever.co/aeratechnology")).toMatchObject({
      provider: "Lever",
      boardId: "aeratechnology",
    });
    expect(parseDirectBoardMapping(
      "Ashby",
      "https://jobs.ashbyhq.com/9fin/form/talent-community",
    )).toMatchObject({
      provider: "Ashby",
      boardId: "9fin",
      feedUrl: "https://api.ashbyhq.com/posting-api/job-board/9fin",
    });
    expect(parseDirectBoardMapping("Ashby", "https://jobs.ashbyhq.com/9fin/not-a-job")).toBeNull();
    expect(parseDirectBoardMapping("Ashby", "https://example.com/9fin")).toBeNull();
    expect(parseDirectBoardMapping("Greenhouse", "https://boards.greenhouse.io/")).toBeNull();
  });

  it("excludes unlisted Ashby jobs and preserves exact listing URLs and IDs", async () => {
    vi.mocked(fetchCompanySitePublicApiPage).mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://api.ashbyhq.com/posting-api/job-board/9fin",
      contentType: "application/json",
      body: JSON.stringify({
        jobs: [
          {
            id: "listed-id",
            title: "Senior Engineer",
            jobUrl: "https://jobs.ashbyhq.com/9fin/listed-id",
            descriptionPlain: "Full description",
            location: "London",
            publishedAt: "2025-01-01T00:00:00Z",
            isListed: true,
          },
          {
            id: "hidden-id",
            title: "Hidden",
            jobUrl: "https://jobs.ashbyhq.com/9fin/hidden-id",
            isListed: false,
          },
        ],
      }),
    });
    const result = await fetchDirectEmployerBoard("9fin Limited", "Ashby", "https://jobs.ashbyhq.com/9fin");
    expect(result.complete).toBe(true);
    expect(result.adverts).toHaveLength(1);
    expect(result.adverts[0]).toMatchObject({
      externalId: "listed-id",
      url: "https://jobs.ashbyhq.com/9fin/listed-id",
      applicationUrl: null,
      title: "Senior Engineer",
      description: "Full description",
      location: "London",
      sourceType: "company_site",
    });
  });

  it("extracts Greenhouse jobs whose provider IDs are numeric", async () => {
    vi.mocked(fetchCompanySitePublicApiPage).mockResolvedValue({
      ok: true,
      status: 200,
      url: "https://boards-api.greenhouse.io/v1/boards/public/jobs?content=true",
      contentType: "application/json",
      body: JSON.stringify({
        jobs: [
          {
            id: 7982150003,
            title: "Active Trader Sales: Options Lead",
            absolute_url: "https://job-boards.greenhouse.io/public/jobs/7982150003",
            content: "<p>About Public</p>",
            location: { name: "New York City or US Remote" },
            updated_at: "2026-08-31T14:25:18-04:00",
          },
          {
            id: 7970574003,
            title: "Lifecycle Marketing Lead",
            absolute_url: "https://job-boards.greenhouse.io/public/jobs/7970574003",
            location: { name: "New York, New York" },
          },
        ],
      }),
    });
    const result = await fetchDirectEmployerBoard(
      "Public",
      "Greenhouse",
      "https://job-boards.greenhouse.io/public",
    );

    expect(result.complete).toBe(true);
    expect(result.adverts).toHaveLength(2);
    expect(result.adverts[0]).toMatchObject({
      externalId: "7982150003",
      url: "https://job-boards.greenhouse.io/public/jobs/7982150003",
      title: "Active Trader Sales: Options Lead",
      description: "About Public",
      location: "New York City or US Remote",
    });
  });

  it("paginates Lever until a short page and reports malformed pages incomplete", async () => {
    const page = (count: number, start: number) =>
      Array.from({ length: count }, (_, i) => ({
        id: `id-${start + i}`,
        text: `Role ${start + i}`,
        hostedUrl: `https://jobs.lever.co/board/id-${start + i}`,
        applyUrl: `https://jobs.lever.co/board/id-${start + i}/apply`,
        descriptionPlain: "Description",
        categories: { location: "London" },
      }));
    vi.mocked(fetchCompanySitePublicApiPage)
      .mockResolvedValueOnce({
        ok: true, status: 200, url: "https://api.lever.co/v0/postings/board?skip=0",
        contentType: "application/json", body: JSON.stringify(page(100, 0)),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200, url: "https://api.lever.co/v0/postings/board?skip=100",
        contentType: "application/json", body: JSON.stringify(page(1, 100)),
      });
    const result = await fetchDirectEmployerBoard("Board Ltd", "Lever", "https://jobs.lever.co/board");
    expect(result.complete).toBe(true);
    expect(result.pagesFetched).toBe(2);
    expect(result.adverts).toHaveLength(101);
    expect(result.adverts[0]?.url).toBe("https://jobs.lever.co/board/id-0");
    expect(result.adverts[0]?.applicationUrl).toBe("https://jobs.lever.co/board/id-0/apply");
  });
});