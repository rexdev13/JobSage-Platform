import { afterEach, describe, expect, it, vi } from "vitest";
import { parseReedJobsHtml, searchReedJobs } from "../../lib/reedJobsClient";

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
});
