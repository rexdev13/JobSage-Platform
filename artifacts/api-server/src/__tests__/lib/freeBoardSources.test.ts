import { describe, expect, it } from "vitest";
import {
  FREE_BOARD_SOURCES,
  parseHimalayasSearchResponse,
  parseNhsVacancyXml,
  parseTeachingSitemapSlugs,
} from "../../lib/freeBoardSources";
import { ALL_FREE_BOARD_SOURCES } from "../../lib/freeBoardSourceRegistry";
import {
  parseCharityJobPage,
  parseNhsScotlandJobCards,
} from "../../lib/supplementalFreeBoardSources";
import { classifyVacancySource } from "../../lib/vacancySource";
import { isValidJobBoardVacancyDeepLink } from "../../lib/vacancyUrlPolicy";

describe("free vacancy source adapters", () => {
  it("registers the free, keyless public feeds", () => {
    expect(ALL_FREE_BOARD_SOURCES.map((source) => source.id)).toEqual([
      "nhs-jobs",
      "teaching-vacancies",
      "arbeitnow",
      "jobicy",
      "himalayas",
      "nhs-scotland",
      "jobs-ac-uk",
      "charityjob",
    ]);
    expect(FREE_BOARD_SOURCES).toHaveLength(5);
  });

  it("maps UK-eligible Himalayas search pages and retains worldwide listings", () => {
    const ukJob = {
      title: "Remote Policy Analyst",
      companyName: "Example Sponsor Employer",
      guid: "remote-policy-analyst",
      applicationLink: "https://careers.example.org/apply/remote-policy-analyst",
      locationRestrictions: [{
        alpha2: "GB",
        name: "United Kingdom",
        slug: "united-kingdom",
      }],
      employmentType: "Full Time",
      categories: ["Policy"],
    };
    const firstPage = parseHimalayasSearchResponse({
      limit: 20,
      totalCount: 21,
      jobs: [ukJob],
    }, 1);
    expect(firstPage).toMatchObject({
      recordsFetched: 1,
      reportedTotal: 21,
      nextCursor: "2",
    });
    expect(firstPage.adverts[0]).toMatchObject({
      externalId: "remote-policy-analyst",
      organisationName: "Example Sponsor Employer",
      location: "Remote (United Kingdom)",
      url: "https://himalayas.app/jobs/remote-policy-analyst",
      sourceMetadata: {
        country: "GB",
        searchScope: "UK-eligible and worldwide",
      },
    });

    const lastPage = parseHimalayasSearchResponse({
      limit: 20,
      totalCount: 21,
      jobs: [{ ...ukJob, guid: "worldwide-role", locationRestrictions: [] }],
    }, 2);
    expect(lastPage.nextCursor).toBeNull();
    expect(lastPage.adverts[0]).toMatchObject({
      location: "Remote (Worldwide)",
      sourceMetadata: { country: null },
    });
  });

  it("fails closed on malformed Himalayas search paging or location evidence", () => {
    expect(() => parseHimalayasSearchResponse({
      limit: 20,
      totalCount: 21,
      jobs: [{ title: "Missing location evidence" }],
    }, 1)).toThrow("omitted its location restrictions");
    expect(() => parseHimalayasSearchResponse({
      limit: 20,
      totalCount: 21,
      jobs: [],
    }, 1)).toThrow("did not match its reported result count");
    expect(() => parseHimalayasSearchResponse({
      limit: 20,
      jobs: [],
    }, 1)).toThrow("omitted valid paging totals");
  });

  it("maps NHS XML records and validates pagination totals", () => {
    const parsed = parseNhsVacancyXml(`
      <nhsJobs>
        <totalPages>1</totalPages>
        <totalResults>1</totalResults>
        <vacancyDetails>
          <reference>C9437-25-0950</reference>
          <title>Adult Forensic Consultant</title>
          <employer>Greater Manchester Mental Health NHS Foundation Trust</employer>
          <type>Permanent</type>
          <salary>£109725 to £145478</salary>
          <closeDate>2026-10-31</closeDate>
          <postDate>2025-10-21T14:43:48.051</postDate>
          <url>https://beta.jobs.nhs.uk/candidate/jobadvert/C9437-25-0950</url>
          <locations><location>Prestwich</location></locations>
        </vacancyDetails>
      </nhsJobs>
    `);

    expect(parsed.totalPages).toBe(1);
    expect(parsed.totalResults).toBe(1);
    expect(parsed.adverts).toHaveLength(1);
    expect(parsed.adverts[0]).toMatchObject({
      externalId: "C9437-25-0950",
      title: "Adult Forensic Consultant",
      organisationName: "Greater Manchester Mental Health NHS Foundation Trust",
      location: "Prestwich",
      boardName: "NHS Jobs",
      sourceType: "job_board",
      url: "https://beta.jobs.nhs.uk/candidate/jobadvert/C9437-25-0950",
    });
    expect(parsed.adverts[0]?.postedDate).toBe("2025-10-21T14:43:48.051Z");
    expect(parsed.adverts[0]?.closesAt?.toISOString()).toBe("2026-10-31T23:59:59.000Z");
  });

  it("fails closed when NHS paging totals are missing or invalid", () => {
    expect(() => parseNhsVacancyXml("<nhsJobs><vacancyDetails /></nhsJobs>"))
      .toThrow("omitted valid paging totals");
  });

  it("extracts only same-host Teaching Vacancies job URLs from its sitemap", () => {
    const slugs = parseTeachingSitemapSlugs(`
      <urlset>
        <url><loc>https://teaching-vacancies.service.gov.uk/jobs/head-teacher-example-school</loc></url>
        <url><loc>https://teaching-vacancies.service.gov.uk/jobs/head-teacher-example-school</loc></url>
        <url><loc>https://teaching-vacancies.service.gov.uk/jobs</loc></url>
        <url><loc>https://example.org/jobs/not-a-teaching-vacancy</loc></url>
      </urlset>
    `);
    expect(slugs).toEqual(["head-teacher-example-school"]);
  });

  it("maps NHS Scotland result cards and preserves the reported total", () => {
    const parsed = parseNhsScotlandJobCards(`
      <input id="totalCurrentRecords" value="12">
      <input id="totalMatchRecords" value="905">
      <div class="card job-card">
        <a href="/Job/JobDetail?JobId=272123">Adult Consultant</a>
        <p class="jobdetailsitem salary"><strong>Salary:</strong> Band 8A (£65,125)</p>
        <p class="jobdetailsitem closingdate"><strong>Closing date:</strong> 20/10/2026</p>
        <p class="jobdetailsitem department"><strong>Job Family:</strong> Medical and Dental</p>
        <p class="jobdetailsitem location"><strong>Location:</strong> Aberdeen</p>
        <p class="jobdetailsitem employmenttype"><strong>Employment type:</strong> Permanent</p>
        <p class="jobdetailsitem livedate"><strong>Live date:</strong> 06/10/2026</p>
        <p class="jobdetailsitem school"><strong>Employer (NHS Board):</strong> NHS Grampian</p>
      </div>
    `);

    expect(parsed.totalResults).toBe(905);
    expect(parsed.recordsPerPage).toBe(12);
    expect(parsed.adverts).toHaveLength(1);
    expect(parsed.adverts[0]).toMatchObject({
      externalId: "272123",
      title: "Adult Consultant",
      organisationName: "NHS Grampian",
      location: "Aberdeen",
      url: "https://apply.jobs.scot.nhs.uk/Job/JobDetail?JobId=272123",
      boardName: "NHS Scotland",
    });
    expect(parsed.adverts[0]?.postedDate).toBe("2026-10-06T00:00:00.000Z");
    expect(parsed.adverts[0]?.closesAt?.toISOString()).toBe("2026-10-20T23:59:59.000Z");
  });

  it("maps paid CharityJob postings and deduplicates repeated cards by listing ID", () => {
    const article = `
      <article job-id="1086483" is-future-job="false" is-expired-job="false"
        class="job-card-wrapper active">
        <a href="javascript:void(0)" title="Centre for Women's Justice" class="job-card-logo"></a>
        <div class="job-title">
          <a href="https://www.charityjob.co.uk/jobs/centre-for-women-s-justice/legal-advice-lawyer/1086483">
            Legal Advice Lawyer
          </a>
        </div>
        <div class="organisation">Centre for Women's Justice, London (Hybrid)</div>
        <div class="job-summary-item"><span>£45,000 per year</span></div>
      </article>`;
    const parsed = parseCharityJobPage(`${article}${article}`);

    expect(parsed.recordsFetched).toBe(2);
    expect(parsed.adverts).toHaveLength(1);
    expect(parsed.adverts[0]).toMatchObject({
      externalId: "1086483",
      title: "Legal Advice Lawyer",
      organisationName: "Centre for Women's Justice",
      location: "London (Hybrid)",
      salary: "£45,000 per year",
      boardName: "CharityJob",
    });
  });

  it("recognizes exact NHS Scotland and CharityJob detail URLs only", () => {
    const scotlandUrl = "https://apply.jobs.scot.nhs.uk/Job/JobDetail?JobId=272123";
    const charityUrl = "https://www.charityjob.co.uk/jobs/example-charity/project-lead/1086483";
    expect(isValidJobBoardVacancyDeepLink(scotlandUrl)).toBe(true);
    expect(isValidJobBoardVacancyDeepLink("https://apply.jobs.scot.nhs.uk/Home/Job")).toBe(false);
    expect(isValidJobBoardVacancyDeepLink(charityUrl)).toBe(true);
    expect(isValidJobBoardVacancyDeepLink("https://www.charityjob.co.uk/jobs")).toBe(false);
    expect(classifyVacancySource(scotlandUrl)).toMatchObject({
      sourceType: "job_board",
      boardName: "NHS Scotland",
      externalListingId: "272123",
    });
    expect(classifyVacancySource(charityUrl)).toMatchObject({
      sourceType: "job_board",
      boardName: "CharityJob",
      externalListingId: "1086483",
    });
  });
});
