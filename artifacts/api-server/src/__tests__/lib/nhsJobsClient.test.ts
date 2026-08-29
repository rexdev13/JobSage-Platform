import { afterEach, describe, expect, it, vi } from "vitest";
import {
  employerNamesCloselyMatch,
  candidateEmployerMatchesSponsor,
  MAX_CANDIDATE_HTML_PAGES,
  parseNhsJobsCandidateHtml,
  parseNhsJobsHtml,
  searchNhsJobs,
  searchNhsJobsForCandidate,
} from "../../lib/nhsJobsClient";

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
        targetRegions: null,
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
    expect(employerNamesCloselyMatch("Nottingham CityCare Partnership CIC", "Nottingham CityCare Partnership")).toBe(true);
    expect(employerNamesCloselyMatch("11:FS GROUP LIMITED", "InHealth Group")).toBe(false);
    expect(employerNamesCloselyMatch("10/10 MEDICAL LIMITED", "Portobello Medical Centre")).toBe(false);
    expect(employerNamesCloselyMatch("18.01 London Limited", "University College London Hospitals NHS Foundation Trust")).toBe(false);
    expect(employerNamesCloselyMatch("Alton Street Surgery", "Crown Street Surgery")).toBe(false);
    expect(employerNamesCloselyMatch("APOLLO HOSPITALITY (PORTOBELLO) LIMITED", "Portobello Medical Centre")).toBe(false);
    expect(employerNamesCloselyMatch("Express Homerton Ltd", "Homerton Healthcare NHS Foundation Trust")).toBe(false);
  });

  it("uses strict sponsor identity matching for candidate-wide searches", () => {
    expect(candidateEmployerMatchesSponsor("InHealth Ltd", "InHealth Group")).toBe(true);
    expect(candidateEmployerMatchesSponsor("Chelsea & Westminster NHS Foundation Trust", "Chelsea and Westminster Hospital NHS Foundation Trust")).toBe(true);
    expect(candidateEmployerMatchesSponsor("Great Ormond Street Hospital NHS Trust", "Great Ormond Street Hospital for Children NHS Foundation Trust")).toBe(true);
    expect(candidateEmployerMatchesSponsor("Ambourne House Limited", "Tamworth House Medical Centre")).toBe(false);
    expect(candidateEmployerMatchesSponsor("Homerton College", "Homerton Healthcare NHS Foundation Trust")).toBe(false);
    expect(candidateEmployerMatchesSponsor("Imperial Centre Limited", "Imperial College Healthcare NHS Trust")).toBe(false);
  });

  it("returns employer identity for candidate-wide sponsor matching", () => {
    expect(parseNhsJobsCandidateHtml(RESULTS_HTML)).toEqual([
      expect.objectContaining({
        title: "Registered Nurse",
        employer: "Example London NHS Foundation Trust",
      }),
      expect.objectContaining({
        title: "Consultant Psychiatrist",
        employer: "Another NHS Foundation Trust",
      }),
    ]);
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

  it("searches by candidate keywords and region without an employer constraint", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(RESULTS_HTML)));
    const result = await searchNhsJobsForCandidate("nurse", "London", 20);
    expect(result.vacancies).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Registered Nurse", employer: "Example London NHS Foundation Trust" }),
    ]));
    expect(result.sourceUrl).toContain("keyword=nurse");
    expect(result.sourceUrl).toContain("location=London");
  });

  it("uses the expanded bounded candidate page budget", () => {
    expect(MAX_CANDIDATE_HTML_PAGES).toBe(30);
  });

  it("stops paginating when a page adds no new vacancies", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(RESULTS_HTML));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchNhsJobsForCandidate("nurse", "London", 300);

    expect(result.vacancies).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it("stops candidate pagination on a 429 and reports a transient failure", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(resultPage(1, 10)))
      .mockResolvedValueOnce(response("Too many requests", 429));
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchNhsJobsForCandidate("nurse", "London", 300);

    expect(result).toMatchObject({
      resultsRequestSucceeded: false,
      transientFailure: true,
    });
    expect(result.vacancies).toHaveLength(10);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});