import { describe, expect, it } from "vitest";
import {
  FREE_BOARD_SOURCES,
  parseNhsVacancyXml,
  parseTeachingSitemapSlugs,
} from "../../lib/freeBoardSources";

describe("free vacancy source adapters", () => {
  it("registers only the five free, keyless source feeds", () => {
    expect(FREE_BOARD_SOURCES.map((source) => source.id)).toEqual([
      "nhs-jobs",
      "teaching-vacancies",
      "arbeitnow",
      "jobicy",
      "himalayas",
    ]);
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
});
