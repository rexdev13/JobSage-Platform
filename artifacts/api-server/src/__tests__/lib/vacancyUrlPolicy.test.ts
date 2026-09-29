import { describe, it, expect } from "vitest";
import {
  BLOCKED_VACANCY_DOMAINS,
  isBlockedVacancyUrl,
  isValidVacancyDeepLink,
  isValidJobBoardVacancyDeepLink,
  isValidVacancyUrlForSource,
} from "../../lib/vacancyUrlPolicy";

describe("isBlockedVacancyUrl", () => {
  it("blocks aggregator domains and their subdomains", () => {
    expect(isBlockedVacancyUrl("https://www.indeed.com/viewjob?jk=abc")).toBe(true);
    expect(isBlockedVacancyUrl("https://uk.indeed.com/viewjob?jk=abc")).toBe(true);
    expect(isBlockedVacancyUrl("https://www.adzuna.co.uk/jobs/details/12345")).toBe(true);
    expect(isBlockedVacancyUrl("https://www.jobijoba.co.uk/jobs/nurse")).toBe(true);
    expect(isBlockedVacancyUrl("https://www.simplyhired.co.uk/job/xyz")).toBe(true);
    expect(isBlockedVacancyUrl("https://uk.bebee.com/job/12345")).toBe(true);
    expect(isBlockedVacancyUrl("https://www.jobs.nhs.uk/candidate/jobadvert/C9999")).toBe(false);
  });

  it("does not block employer domains", () => {
    expect(isBlockedVacancyUrl("https://careers.tesco.com/jobs/12345-cashier")).toBe(false);
  });

  it("returns false on malformed URLs", () => {
    expect(isBlockedVacancyUrl("not-a-url")).toBe(false);
  });

  it("includes the historic strict backfill blocklist", () => {
    for (const d of ["monster.co.uk", "cwjobs.co.uk", "google.com", "careerjet.co.uk"]) {
      expect(BLOCKED_VACANCY_DOMAINS).toContain(d);
    }
  });
});

describe("job-board vacancy URL policy", () => {
  it("allows exact supported-board adverts only in job-board mode", () => {
    const reedAdvert = "https://www.reed.co.uk/jobs/staff-nurse-london/57262903?source=searchResults";
    expect(isValidJobBoardVacancyDeepLink(reedAdvert)).toBe(true);
    expect(isValidVacancyUrlForSource(reedAdvert, "job_board")).toBe(true);
    expect(isValidVacancyUrlForSource(reedAdvert, "company_site")).toBe(false);
  });

  it("rejects board search and employer-listing URLs", () => {
    expect(isValidJobBoardVacancyDeepLink("https://www.reed.co.uk/jobs?keywords=nurse")).toBe(false);
    expect(isValidJobBoardVacancyDeepLink("https://uk.indeed.com/jobs?q=nurse")).toBe(false);
    expect(isValidJobBoardVacancyDeepLink("https://uk.indeed.com/viewjob?jk=abc123")).toBe(true);
  });

  it("allows only exact jobs.ac.uk and Teaching Vacancies adverts", () => {
    expect(isValidJobBoardVacancyDeepLink(
      "https://www.jobs.ac.uk/job/DSK409/lecturer-in-law",
    )).toBe(true);
    expect(isValidJobBoardVacancyDeepLink(
      "https://www.jobs.ac.uk/search/?keywords=law",
    )).toBe(false);
    expect(isValidJobBoardVacancyDeepLink(
      "https://teaching-vacancies.service.gov.uk/jobs/teacher-of-law-example-school",
    )).toBe(true);
    expect(isValidJobBoardVacancyDeepLink(
      "https://teaching-vacancies.service.gov.uk/jobs?query=teacher",
    )).toBe(false);
  });

  it("classifies exact NHS-family adverts as job-board links", () => {
    expect(isValidJobBoardVacancyDeepLink("https://www.jobs.nhs.uk/candidate/jobadvert/C0001-260001")).toBe(true);
    expect(isValidJobBoardVacancyDeepLink("https://www.trac.jobs/job-advert/1234567")).toBe(true);
    expect(isValidJobBoardVacancyDeepLink("https://www.healthjobsuk.com/job/UK/London/Trust/Nurse-v123456")).toBe(true);
  });
});

describe("isValidVacancyDeepLink", () => {
  it("accepts a real deep-link to a specific advert", () => {
    expect(isValidVacancyDeepLink("https://careers.acme.co.uk/vacancy/12345-staff-nurse")).toBe(true);
    expect(isValidVacancyDeepLink("https://www.acme.com/jobs/view/98765")).toBe(true);
  });

  it("rejects null, undefined, empty and malformed URLs", () => {
    expect(isValidVacancyDeepLink(null)).toBe(false);
    expect(isValidVacancyDeepLink(undefined)).toBe(false);
    expect(isValidVacancyDeepLink("")).toBe(false);
    expect(isValidVacancyDeepLink("not-a-url")).toBe(false);
    expect(isValidVacancyDeepLink("ftp://acme.com/jobs/12345678")).toBe(false);
  });

  it("rejects blocked aggregator domains even with deep paths", () => {
    expect(isValidVacancyDeepLink("https://uk.indeed.com/viewjob?jk=abcdef123456")).toBe(false);
    expect(isValidVacancyDeepLink("https://www.adzuna.co.uk/jobs/details/5001234567")).toBe(false);
  });

  it("rejects generic careers/homepage paths", () => {
    expect(isValidVacancyDeepLink("https://hegarty.co.uk/careers")).toBe(false);
    expect(isValidVacancyDeepLink("https://hegarty.co.uk/careers/")).toBe(false);
    expect(isValidVacancyDeepLink("https://acme.com/")).toBe(false);
    expect(isValidVacancyDeepLink("https://acme.com")).toBe(false);
    expect(isValidVacancyDeepLink("https://acme.com/career")).toBe(false);
    expect(isValidVacancyDeepLink("https://acme.com/jobs")).toBe(false);
    expect(isValidVacancyDeepLink("https://acme.com/vacancies")).toBe(false);
    expect(isValidVacancyDeepLink("https://acme.com/search")).toBe(false);
    expect(isValidVacancyDeepLink("https://acme.com/Careers")).toBe(false);
  });

  it("rejects career filters and utility pages but allows an exact search-result job ID", () => {
    expect(isValidVacancyDeepLink(
      "https://jobs.bmc.com/Careers/SearchJobs?1273=2616669&1273_format=1340&listFilterMode=1",
    )).toBe(false);
    expect(isValidVacancyDeepLink(
      "https://jobs.bmc.com/Careers/SearchJobs?1274=9435&1274_format=1347&intcmp=JobsByCountry&listFilterMode=1",
    )).toBe(false);
    expect(isValidVacancyDeepLink(
      "https://jobs.bmc.com/Careers/RecommendationMethods",
    )).toBe(false);
    expect(isValidVacancyDeepLink(
      "https://jobs.bmc.com/Careers/TalentCommunity",
    )).toBe(false);
    expect(isValidVacancyDeepLink(
      "https://jobs.bmc.com/Careers/SearchJobs?jobId=12345",
    )).toBe(true);
    expect(isValidVacancyDeepLink(
      "https://jobs.example.com/Careers/Search-Jobs?jobId=12345",
    )).toBe(true);
  });

  it("rejects career resource pages while preserving specific role destinations", () => {
    const resourceSlugs = [
      "benefits",
      "why-work-in-the-industry",
      "working-in-the-industry",
      "pharmaceutical-recruiters",
      "international-non-eu-applicants",
      "pharmaceutical-careers-for-doctors",
      "post-graduates-post-doctoral-researchers",
      "undergraduates",
    ];

    for (const slug of resourceSlugs) {
      expect(isValidVacancyDeepLink(`https://www.abpi.org.uk/careers/${slug}`)).toBe(false);
    }
    expect(isValidVacancyDeepLink(
      "https://careers.example.com/careers/jobs/benefits-manager-12345",
    )).toBe(true);
    expect(isValidVacancyDeepLink(
      "https://careers.example.com/careers/jobs/registered-nurse-12345",
    )).toBe(true);
  });

  it("rejects pathnames shorter than 8 characters", () => {
    expect(isValidVacancyDeepLink("https://acme.com/hr")).toBe(false);
    expect(isValidVacancyDeepLink("https://acme.com/join")).toBe(false);
  });
});
