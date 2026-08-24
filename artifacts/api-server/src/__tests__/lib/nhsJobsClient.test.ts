import { describe, expect, it } from "vitest";
import { employerNamesCloselyMatch, parseNhsJobsHtml } from "../../lib/nhsJobsClient";

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
  });
});