import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getVacancyLinkStatus,
  RECENT_VERIFY_SKIP_MS,
  VACANCY_VISIBLE_WINDOW_MS,
  vacancyVisibilityWindowMs,
  getCandidateVacancyStatus,
  hasApprovedCompanyVacancyRoleEligibilityReview,
} from "../../lib/vacancyLiveness";

describe("candidate-facing vacancy freshness", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps click-time verification freshness at six hours", () => {
    expect(RECENT_VERIFY_SKIP_MS).toBe(6 * 60 * 60 * 1000);
  });

  it.each(["job_board", "company_site", null] as const)(
    "keeps successfully verified %s links visible for 48 hours",
    (sourceType) => {
    const now = new Date("2026-09-09T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    expect(vacancyVisibilityWindowMs(sourceType)).toBe(VACANCY_VISIBLE_WINDOW_MS);
    expect(VACANCY_VISIBLE_WINDOW_MS).toBe(48 * 60 * 60 * 1000);
    expect(getVacancyLinkStatus(
      "https://careers.example.com/jobs/1",
      "live",
      new Date(now.getTime() - 24 * 60 * 60 * 1000),
      null,
      vacancyVisibilityWindowMs(sourceType),
    )).toBe("live");
    expect(getVacancyLinkStatus(
      "https://careers.example.com/jobs/1",
      "live",
      new Date(now.getTime() - 49 * 60 * 60 * 1000),
      null,
      vacancyVisibilityWindowMs(sourceType),
    )).toBe("stale");
  });

  const base = {
    sourceType: "company_site" as const,
    title: "Operations Manager",
    liveness: "live",
    lastVerifiedAt: new Date("2026-09-09T10:00:00.000Z"),
    now: new Date("2026-09-09T12:00:00.000Z"),
  };

  it("hides company-site manager rows until approved evidence is complete", () => {
    expect(getCandidateVacancyStatus({ ...base, companyVacancyEvidence: { roleEligibilityReview: { status: "pending", socCode: "1234", evidenceUrl: "https://example.test/evidence" } } })).toBe("pending_review");
    expect(getCandidateVacancyStatus({ ...base, companyVacancyEvidence: { roleEligibilityReview: { status: "approved", socCode: "123", evidenceUrl: "https://example.test/evidence" } } })).toBe("pending_review");
    expect(getCandidateVacancyStatus({ ...base, companyVacancyEvidence: { roleEligibilityReview: { status: "approved", socCode: "1234", evidenceUrl: "http://example.test/evidence" } } })).toBe("pending_review");
  });

  it("shows only approved evidence with a valid SOC code and HTTPS URL", () => {
    const evidence = { roleEligibilityReview: { status: "approved", socCode: "1234", evidenceUrl: "https://example.test/evidence" } };
    expect(hasApprovedCompanyVacancyRoleEligibilityReview(evidence)).toBe(true);
    expect(getCandidateVacancyStatus({
      ...base,
      companyVacancyEvidence: {
        kind: "known_ats_posting",
        provider: "Greenhouse",
        listingUrl: "https://boards.greenhouse.io/example/jobs/1",
        roleEligibilityReview: evidence.roleEligibilityReview,
      },
    })).toBe("visible");
  });

  it("shows a reviewed strict healthcare role page and still hides an incomplete one", () => {
    expect(getCandidateVacancyStatus({
      ...base,
      title: "Registered Nurse",
      companyEvidenceLegacyUntil: new Date("2026-10-09T00:00:00.000Z"),
      companyVacancyEvidence: {
        kind: "strict_role_page",
        sector: "healthcare",
        listingUrl: "https://careers.example.test/vacancies",
        detailUrl: "https://careers.example.test/vacancies/registered-nurse-42",
        applicationUrl: "https://careers.example.test/vacancies/registered-nurse-42/apply",
        trustedSource: "manual_review",
        roleEligibilityReview: {
          status: "approved",
          socCode: "2231",
          evidenceUrl: "https://careers.example.test/vacancies/registered-nurse-42",
        },
      },
    })).toBe("visible");
    expect(getCandidateVacancyStatus({
      ...base,
      title: "Registered Nurse",
      companyVacancyEvidence: { kind: "strict_role_page", sector: "healthcare" },
    })).toBe("unverified");
  });

  it.each([
    ["generic structured cards", { kind: "structured_job_card" }],
    ["JSON-LD cards by default", { kind: "json_ld_job_posting", listingUrl: "https://example.test/jobs/1" }],
    ["microdata cards by default", { kind: "microdata_job_posting", listingUrl: "https://example.test/jobs/1" }],
    ["evidence-less rows", null],
  ])("hides company-site %s", (_label, companyVacancyEvidence) => {
    expect(getCandidateVacancyStatus({
      ...base,
      title: "Registered Nurse",
      companyVacancyEvidence,
    })).toBe("unverified");
  });

  it("does not treat liveness as semantic company-site evidence", () => {
    expect(getCandidateVacancyStatus({
      ...base,
      title: "Why work here",
      companyVacancyEvidence: null,
    })).toBe("unverified");
    expect(getCandidateVacancyStatus({
      ...base,
      title: "Benefits",
      companyVacancyEvidence: { kind: "structured_job_card" },
    })).toBe("unverified");
    expect(getCandidateVacancyStatus({
      ...base,
      title: "Skip to main content",
      companyVacancyEvidence: { kind: "json_ld_job_posting", listingUrl: "https://example.test/skip" },
    })).toBe("unverified");
  });

  it("hides direct-feed evidence with unknown provenance or observed source-missing state", () => {
    expect(getCandidateVacancyStatus({
      ...base,
      title: "Registered Nurse",
      companyVacancyEvidence: {
        kind: "known_ats_posting",
        provider: "unknown",
        listingUrl: "https://jobs.example.test/roles/1",
      },
    })).toBe("unverified");
    expect(getCandidateVacancyStatus({
      ...base,
      title: "Registered Nurse",
      sourceMissingObservations: 1,
      companyVacancyEvidence: {
        kind: "known_ats_posting",
        provider: "Ashby",
        listingUrl: "https://jobs.example.test/roles/1",
      },
    })).toBe("missing");
  });

  it("keeps structured evidence opt-in and requires a specific role route", () => {
    vi.stubEnv("COMPANY_SITE_SCHEMA_IMPORT_ENABLED", "true");
    expect(getCandidateVacancyStatus({
      ...base,
      title: "Registered Nurse",
      companyVacancyEvidence: {
        kind: "json_ld_job_posting",
        listingUrl: "https://example.test/jobs/registered-nurse",
      },
    })).toBe("visible");
    expect(getCandidateVacancyStatus({
      ...base,
      title: "Careers",
      companyVacancyEvidence: {
        kind: "json_ld_job_posting",
        listingUrl: "https://example.test/careers",
      },
    })).toBe("unverified");
    vi.unstubAllEnvs();
  });

  it("shows a verified direct ATS posting and only an explicit trusted legacy review", () => {
    expect(getCandidateVacancyStatus({
      ...base,
      title: "Registered Nurse",
      companyVacancyEvidence: {
        kind: "known_ats_posting",
        provider: "Ashby",
        listingUrl: "https://jobs.ashbyhq.com/example/1",
      },
    })).toBe("visible");
    expect(getCandidateVacancyStatus({
      ...base,
      companyEvidenceLegacyUntil: new Date("2026-09-10T00:00:00.000Z"),
      companyVacancyEvidence: {
        trustedSource: "manual_review",
        roleEligibilityReview: {
          status: "approved",
          socCode: "1234",
          evidenceUrl: "https://example.test/review",
        },
      },
    })).toBe("visible");
  });

  it("does not apply manager review to job boards or ordinary titles", () => {
    const evidence = { roleEligibilityReview: { status: "pending" } };
    expect(getCandidateVacancyStatus({ ...base, sourceType: "job_board", companyVacancyEvidence: evidence })).toBe("visible");
    expect(getCandidateVacancyStatus({
      ...base,
      title: "Senior Nurse",
      companyVacancyEvidence: {
        kind: "known_ats_posting",
        provider: "Lever",
        listingUrl: "https://jobs.lever.co/example/1",
        ...evidence,
      },
    })).toBe("visible");
  });
});