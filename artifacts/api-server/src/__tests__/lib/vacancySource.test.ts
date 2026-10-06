import { describe, expect, it } from "vitest";
import {
  canonicalVacancyUrl,
  classifyVacancySource,
  vacancyStorageKey,
} from "../../lib/vacancySource";

describe("vacancy source metadata", () => {
  it("classifies exact adverts from supported boards", () => {
    expect(classifyVacancySource("https://www.jobs.nhs.uk/candidate/jobadvert/C0001-260001?ref=x")).toEqual({
      sourceType: "job_board",
      boardName: "NHS Jobs",
      externalListingId: "C0001-260001",
    });
    expect(classifyVacancySource("https://www.trac.jobs/job-advert/1234567")).toMatchObject({
      sourceType: "job_board",
      boardName: "Trac",
    });
    expect(classifyVacancySource("https://www.reed.co.uk/jobs/staff-nurse/57262903")).toEqual({
      sourceType: "job_board",
      boardName: "Reed",
      externalListingId: "57262903",
    });
    expect(classifyVacancySource("https://www.jobs.ac.uk/job/DSK409/lecturer-in-law")).toEqual({
      sourceType: "job_board",
      boardName: "jobs.ac.uk",
      externalListingId: "DSK409",
    });
    expect(classifyVacancySource(
      "https://teaching-vacancies.service.gov.uk/jobs/teacher-of-law-example-school",
    )).toEqual({
      sourceType: "job_board",
      boardName: "Teaching Vacancies",
      externalListingId: "teacher-of-law-example-school",
    });
    expect(classifyVacancySource(
      "https://www.arbeitnow.com/jobs/companies/dkbcodefactory/devops-engineer-berlin-20354",
    )).toEqual({
      sourceType: "job_board",
      boardName: "Arbeitnow",
      externalListingId: "devops-engineer-berlin-20354",
    });
    expect(classifyVacancySource(
      "https://www.arbeitnow.co.uk/jobs/companies/gymshark/senior-executive-creator-marketing-12m-ftc-solihull-293978",
    )).toEqual({
      sourceType: "job_board",
      boardName: "Arbeitnow",
      externalListingId: "senior-executive-creator-marketing-12m-ftc-solihull-293978",
    });
    expect(classifyVacancySource(
      "https://www.arbeitnow.fr/jobs/companies/catonetworks/enterprise-sales-director-paris-paris-337612",
    )).toEqual({
      sourceType: "job_board",
      boardName: "Arbeitnow",
      externalListingId: "enterprise-sales-director-paris-paris-337612",
    });
    expect(classifyVacancySource(
      "https://www.arbeitnow.ch/jobs/companies/example/senior-engineer-zurich-12345",
    )).toEqual({
      sourceType: "job_board",
      boardName: "Arbeitnow",
      externalListingId: "senior-engineer-zurich-12345",
    });
    expect(classifyVacancySource(
      "https://jobicy.com/jobs/154706-crm-marketing-intern",
    )).toEqual({
      sourceType: "job_board",
      boardName: "Jobicy",
      externalListingId: "154706-crm-marketing-intern",
    });
    expect(classifyVacancySource(
      "https://himalayas.app/companies/trillium-health-resources/jobs/tribal-liaison",
    )).toEqual({
      sourceType: "job_board",
      boardName: "Himalayas",
      externalListingId: "tribal-liaison",
    });
  });

  it("canonicalizes tracking variants to one organisation-and-URL key", () => {
    const first = "https://www.reed.co.uk/jobs/staff-nurse/57262903?source=searchResults&utm_source=email";
    const second = "https://www.reed.co.uk/jobs/staff-nurse/57262903";
    expect(canonicalVacancyUrl(first)).toBe(canonicalVacancyUrl(second));
    expect(vacancyStorageKey("Example Trust", first)).toBe(vacancyStorageKey("Example Trust", second));
    expect(vacancyStorageKey("Another Trust", first)).not.toBe(vacancyStorageKey("Example Trust", second));
  });
});
