import { afterEach, describe, expect, it, vi } from "vitest";
import { parseJobsAcUkHtml, searchJobsAcUk } from "../../lib/jobsAcUkClient";

function result(id: string, title: string, employer: string): string {
  return `<div class="j-search-result__result ie-border-left" data-advert-id="1">
    <div class="j-search-result__text">
      <a href="/job/${id}/${title.toLowerCase().replace(/\s+/g, "-")}">${title}</a>
      <div class="j-search-result__employer"><b>${employer}</b></div>
      <div>Location: London</div>
      <div class="j-search-result__info"><strong>Salary: </strong>£50,000</div>
      <div><strong>Date Placed: </strong>18 Sep</div>
    </div>
    <div class="j-search-result__date">Closes 18 Oct</div>
  </div>`;
}

describe("jobs.ac.uk public HTML discovery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses exact advert links and employer metadata", () => {
    expect(parseJobsAcUkHtml(result("DSK409", "Lecturer in Law", "Example University"))).toEqual([
      expect.objectContaining({
        title: "Lecturer in Law",
        employer: "Example University",
        boardName: "jobs.ac.uk",
        externalListingId: "DSK409",
        url: "https://www.jobs.ac.uk/job/DSK409/lecturer-in-law",
      }),
    ]);
  });

  it("stops on a 429 and reports a transient failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: { get: () => "text/html" },
    }));
    await expect(searchJobsAcUk("architect", 40)).resolves.toMatchObject({
      requestSucceeded: false,
      transientFailure: true,
      status: 429,
    });
  });
});