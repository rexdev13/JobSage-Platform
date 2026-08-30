import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseReedCandidateJobsHtml,
  parseReedJobsHtml,
  searchReedJobs,
  searchReedJobsForCandidate,
} from "../../lib/reedJobsClient";

function card(id: number, title: string, employer: string): string {
  return `<article data-qa="job-card" data-id="job${id}">
    <a href="/jobs/${title.toLowerCase().replace(/\s+/g, "-")}/${id}?source=searchResults"
       data-id="${id}" data-qa="job-card-title">${title}</a>
    <div data-qa="job-posted-by">2 days ago by <a>${employer}</a></div>
    <li data-qa="job-metadata-salary"><svg></svg>£35,000 - £42,000</li>
    <li data-qa="job-metadata-location"><svg></svg>London</li>
    <a data-qa="company-name-link">${employer}</a>
  </article>`;
}

describe("Reed public HTML discovery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps only close employer matches and emits exact advert metadata", () => {
    const parsed = parseReedJobsHtml(
      card(57262903, "Staff Nurse", "Example London NHS Foundation Trust") +
        card(57262904, "Warehouse Operative", "Unrelated Agency"),
      "Example London NHS Foundation Trust",
    );
    expect(parsed).toEqual([
      expect.objectContaining({
        title: "Staff Nurse",
        url: "https://www.reed.co.uk/jobs/staff-nurse/57262903",
        sourceType: "job_board",
        boardName: "Reed",
        externalListingId: "57262903",
      }),
    ]);
  });

  it("parses profession-search results without pre-filtering non-sponsor employers", () => {
    const parsed = parseReedCandidateJobsHtml(
      card(57262903, "Management Accountant", "Example Finance Ltd") +
        card(57262904, "Financial Accountant", "Another Sponsor LLP"),
      20,
    );
    expect(parsed.map((vacancy) => vacancy.employer)).toEqual([
      "Example Finance Ltd",
      "Another Sponsor LLP",
    ]);
  });

  it("treats rate limits as transient failures instead of empty success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => "text/html" },
    }));
    await expect(searchReedJobs("Example Trust")).resolves.toMatchObject({
      vacancies: [],
      requestSucceeded: false,
      transientFailure: true,
    });
  });

  it("searches Reed with candidate profession keywords and region", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "text/html" },
      text: () => Promise.resolve(card(57262903, "Management Accountant", "Example Finance Ltd")),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(searchReedJobsForCandidate("accountant", "London", 300)).resolves.toMatchObject({
      requestSucceeded: true,
      transientFailure: false,
      vacancies: [expect.objectContaining({ title: "Management Accountant", boardName: "Reed" })],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.reed.co.uk/jobs?keywords=accountant&locationName=London",
      expect.any(Object),
    );
  });

  it("aggregates and deduplicates bounded Reed candidate result pages", async () => {
    const firstPage = Array.from({ length: 20 }, (_, index) =>
      card(index + 1, `Accountant ${index + 1}`, `Sponsor ${index + 1}`),
    ).join("");
    const secondPage = [
      card(20, "Accountant 20", "Sponsor 20"),
      ...Array.from({ length: 20 }, (_, index) =>
        card(index + 21, `Accountant ${index + 21}`, `Sponsor ${index + 21}`),
      ),
    ].join("");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => "text/html" },
        text: () => Promise.resolve(firstPage),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => "text/html" },
        text: () => Promise.resolve(secondPage),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchReedJobsForCandidate("accountant", "London", 40);

    expect(result).toMatchObject({
      requestSucceeded: true,
      transientFailure: false,
    });
    expect(result.vacancies).toHaveLength(40);
    expect(new Set(result.vacancies.map((vacancy) => vacancy.url))).toHaveLength(40);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://www.reed.co.uk/jobs?keywords=accountant&locationName=London&pageno=2",
    );
  });
});
