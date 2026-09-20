import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseTeachingVacanciesHtml,
  searchTeachingVacancies,
} from "../../lib/teachingVacanciesClient";

function result(): string {
  return `<div class="search-results__item">
    <h2><a class="govuk-link view-vacancy-link" href="/jobs/teacher-of-law-example-school">Teacher of Law</a></h2>
    <p class="govuk-body address">Example School, London, SW1A 1AA</p>
    <dl>
      <dt>Full time equivalent salary</dt><dd>£35,000 Annually</dd>
      <dt>Closing date</dt><dd>30 September 2026 at 11:59pm</dd>
      <dt>Visa sponsorship</dt><dd>Visas can be sponsored</dd>
    </dl>
  </div>`;
}

describe("Teaching Vacancies public HTML discovery", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses exact advert links, school identity, and sponsorship text", () => {
    expect(parseTeachingVacanciesHtml(result())).toEqual([
      expect.objectContaining({
        title: "Teacher of Law",
        employer: "Example School",
        location: "London, SW1A 1AA",
        description: "Visas can be sponsored",
        boardName: "Teaching Vacancies",
        externalListingId: "teacher-of-law-example-school",
      }),
    ]);
  });

  it("reports 403 as a transient failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      headers: { get: () => "text/html" },
    }));
    await expect(searchTeachingVacancies("teacher", 40)).resolves.toMatchObject({
      requestSucceeded: false,
      transientFailure: true,
      status: 403,
    });
  });
});