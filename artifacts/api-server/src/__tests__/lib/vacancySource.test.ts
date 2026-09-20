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
  });

  it("canonicalizes tracking variants to one organisation-and-URL key", () => {
    const first = "https://www.reed.co.uk/jobs/staff-nurse/57262903?source=searchResults&utm_source=email";
    const second = "https://www.reed.co.uk/jobs/staff-nurse/57262903";
    expect(canonicalVacancyUrl(first)).toBe(canonicalVacancyUrl(second));
    expect(vacancyStorageKey("Example Trust", first)).toBe(vacancyStorageKey("Example Trust", second));
    expect(vacancyStorageKey("Another Trust", first)).not.toBe(vacancyStorageKey("Example Trust", second));
  });
});
