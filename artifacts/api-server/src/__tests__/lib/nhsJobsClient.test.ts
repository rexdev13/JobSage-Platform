import { afterEach, describe, expect, it, vi } from "vitest";
import { employerNamesCloselyMatch, parseNhsJobsHtml, searchNhsJobs } from "../../lib/nhsJobsClient";

const RESULTS_HTML = `
  <ul class="nhsuk-list search-results">
    <li class="nhsuk-list-panel search-result" data-test="search-result">
      <h2><a href="/candidate/jobadvert/C0001-260001?search=test" data-test="search-result-job-title">Registered Nurse</a></h2>
      <div data-test="search-result-location"><h3>Example London NHS Foundation Trust<div class="location-font-size">London SE1 1AA</div></h3></div>
      <li data-test="search-result-salary">Salary: <strong>£35,000</strong></li>
      <li data-test="search-result-publicationDate">Date posted: <strong>24 August 2026</strong></li>
    </li>
    <li class="nhsuk-list-panel search-result" data-test="search-result">
      <h2><a href="/candidate/jobadvert/C0002-260002?search=test" data-test="search-result-job-title">Cleaner</a></h2>
      <div data-test="search-result-location"><h3>Example London NHS Foundation Trust<div class="location-font-size">London</div></h3></div>
    </li>
    <li class="nhsuk-list-panel search-result" data-test="search-result">
      <h2><a href="/candidate/jobadvert/C0003-260003?search=test" data-test="search-result-job-title">Consultant Psychiatrist</a></h2>
      <div data-test="search-result-location"><h3>Another NHS Foundation Trust<div class="location-font-size">London</div></h3></div>
    </li>
  </ul>
`;

describe("NHS Jobs HTML parser", () => {
  it("keeps only closely matched employers with direct NHS vacancy URLs", () => {
    const vacancies = parseNhsJobsHtml(RESULTS_HTML, "Example London NHS Foundation Trust");

    expect(vacancies).toEqual([
      {
        title: "Registered Nurse",
        location: "London SE1 1AA",
        salary: "£35,000",
        url: "https://www.jobs.nhs.uk/candidate/jobadvert/C0001-260001?search=test",
        description: null,
        postedDate: "24 August 2026",
      },
    ]);
  });

  it("requires distinctive employer-name overlap", () => {
    expect(employerNamesCloselyMatch("Example London NHS Foundation Trust", "Example London NHS Foundation Trust")).toBe(true);
    expect(employerNamesCloselyMatch("Example London NHS Foundation Trust", "Another NHS Foundation Trust")).toBe(false);
    expect(employerNamesCloselyMatch("Guy's and St Thomas' NHS Foundation Trust", "Guy's and St Thomas' NHS Foundation Trust")).toBe(true);
    expect(employerNamesCloselyMatch("Guy's and St Thomas' NHS Foundation Trust", "GSTT")).toBe(true);
    expect(employerNamesCloselyMatch("South London and Maudsley NHS Foundation Trust", "SLaM NHS Foundation Trust")).toBe(true);
    expect(employerNamesCloselyMatch("Central London Community Healthcare NHS Trust", "CLCH")).toBe(true);
    expect(employerNamesCloselyMatch("Guy's and St Thomas' NHS Foundation Trust", "Great Western Hospitals NHS Foundation Trust")).toBe(false);
  });
});

function response(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn().mockResolvedValue(body),
    headers: { get: () => "text/html" },
  };
}

function resultPage(firstId: number, count: number): string {
  return `
    <ul class="nhsuk-list search-results">
      ${Array.from({ length: count }, (_, index) => {
        const id = firstId + index;
        return `
          <li class="nhsuk-list-panel search-result" data-test="search-result">
            <h2><a href="/candidate/jobadvert/C9000-2600${id}?search=test" data-test="search-result-job-title">Registered Nurse ${id}</a></h2>
            <div data-test="search-result-location"><h3>Example London NHS Foundation Trust<div class="location-font-size">London</div></h3></div>
          </li>`;
      }).join("")}
    </ul>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NHS Jobs HTML pagination", () => {
  it("collects up to eight quality vacancies across three extra pages", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response("<html>legacy endpoint</html>"))
      .mockResolvedValueOnce(response(resultPage(1, 2)))
      .mockResolvedValueOnce(response(resultPage(3, 2)))
      .mockResolvedValueOnce(response(resultPage(5, 2)))
      .mockResolvedValueOnce(response(resultPage(7, 2)));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchNhsJobs("Example London NHS Foundation Trust");

    expect(result).toMatchObject({
      structuredFeedWorked: false,
      resultsRequestSucceeded: true,
      transientFailure: false,
    });
    expect(result.vacancies).toHaveLength(8);
    expect(fetchMock).toHaveBeenCalledTimes(5); // structured attempt + first page + 3 extra pages
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain("page=2");
    expect(String(fetchMock.mock.calls[4]?.[0])).toContain("page=4");
  });

  it("stops on an NHS 5xx response and reports a transient failure", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response("<html>legacy endpoint</html>"))
      .mockResolvedValueOnce(response("Service unavailable", 503));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchNhsJobs("Example London NHS Foundation Trust");

    expect(result).toMatchObject({
      vacancies: [],
      resultsRequestSucceeded: false,
      transientFailure: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});