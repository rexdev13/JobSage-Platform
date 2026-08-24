import { describe, it, expect } from "vitest";
import {
  BLOCKED_VACANCY_DOMAINS,
  isBlockedVacancyUrl,
  isValidVacancyDeepLink,
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

  it("rejects pathnames shorter than 8 characters", () => {
    expect(isValidVacancyDeepLink("https://acme.com/hr")).toBe(false);
    expect(isValidVacancyDeepLink("https://acme.com/join")).toBe(false);
  });
});
