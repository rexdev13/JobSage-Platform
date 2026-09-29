import { describe, expect, it } from "vitest";
import { getCandidateVacancyStatus } from "../../lib/vacancyLiveness";
import {
  buildStrictHealthcareRoleEvidence,
  extractHealthcareApplicationRoute,
  hasStrictHealthcareRoleEvidence,
} from "../../lib/healthcareRoleEvidence";

const listingUrl = "https://careers.example-care.co.uk/vacancies";
const detailUrl = "https://careers.example-care.co.uk/vacancies/staff-nurse-1204";

describe("strict healthcare role evidence", () => {
  it("accepts a specific care role with an apply link on the employer host", () => {
    const evidence = buildStrictHealthcareRoleEvidence({
      title: "Staff Nurse",
      detailUrl,
      listingUrl,
      employerHost: "example-care.co.uk",
      applicationUrl: "https://careers.example-care.co.uk/vacancies/staff-nurse-1204/apply",
    });
    expect(evidence?.kind).toBe("strict_role_page");
    expect(evidence?.roleEligibilityReview.socCode).toBe("2231");
    expect(hasStrictHealthcareRoleEvidence(evidence, "Staff Nurse")).toBe(true);
    expect(getCandidateVacancyStatus({
      sourceType: "company_site",
      title: "Staff Nurse",
      liveness: "live",
      lastVerifiedAt: new Date("2026-09-29T08:00:00.000Z"),
      now: new Date("2026-09-29T09:00:00.000Z"),
      companyEvidenceLegacyUntil: new Date("2026-10-29T00:00:00.000Z"),
      companyVacancyEvidence: evidence,
    })).toBe("visible");
  });

  it("rejects benefits pages, generic titles, and pages with no recruitment route", () => {
    expect(buildStrictHealthcareRoleEvidence({
      title: "Our benefits",
      detailUrl: "https://careers.example-care.co.uk/careers/benefits",
      listingUrl,
      employerHost: "example-care.co.uk",
      applicationUrl: "https://careers.example-care.co.uk/careers/benefits",
    })).toBeNull();
    expect(buildStrictHealthcareRoleEvidence({
      title: "Skip to main content",
      detailUrl,
      listingUrl,
      employerHost: "example-care.co.uk",
      applicationUrl: detailUrl,
    })).toBeNull();
    expect(buildStrictHealthcareRoleEvidence({
      title: "Support Worker",
      detailUrl,
      listingUrl,
      employerHost: "example-care.co.uk",
    })).toBeNull();
    expect(buildStrictHealthcareRoleEvidence({
      title: "Support Worker",
      detailUrl: "https://jobs.example-news.co.uk/blog/support-worker-story",
      listingUrl: "https://jobs.example-news.co.uk/blog",
      employerHost: "example-news.co.uk",
      contactEmail: "careers@example-news.co.uk",
    })).toBeNull();
  });

  it("reads an apply button or recruitment mailbox from the role page", () => {
    const html = `
      <a href="/vacancies/staff-nurse-1204/apply">Apply now</a>
      <a href="mailto:careers@example-care.co.uk">Email</a>
    `;
    expect(extractHealthcareApplicationRoute(html, detailUrl, "example-care.co.uk")).toEqual({
      applicationUrl: "https://careers.example-care.co.uk/vacancies/staff-nurse-1204/apply",
      contactEmail: "careers@example-care.co.uk",
    });
  });

  it("treats a same-page apply fragment or vacancy application form as a route", () => {
    const viewUrl = "https://careers.example-care.co.uk/vacancies/view/care-home-support-worker-6056";
    expect(extractHealthcareApplicationRoute(
      `<a href="#apply"></a><p>Closing date: 26/10/2026</p>`,
      viewUrl,
      "example-care.co.uk",
    ).applicationUrl).toBe(`${viewUrl}#apply`);
    expect(extractHealthcareApplicationRoute(
      `<form method="post"><input type="file" name="cv"><button>Agree & submit application</button></form>`,
      viewUrl,
      "example-care.co.uk",
    ).applicationUrl).toBe(viewUrl);
    expect(extractHealthcareApplicationRoute(
      "<p>Just a moment</p>",
      viewUrl,
      "example-care.co.uk",
    ).applicationUrl).toBeNull();
    expect(extractHealthcareApplicationRoute(
      `<a href="#apply">Apply</a>`,
      "https://careers.example-care.co.uk/vacancies",
      "example-care.co.uk",
    ).applicationUrl).toBeNull();
  });
});
