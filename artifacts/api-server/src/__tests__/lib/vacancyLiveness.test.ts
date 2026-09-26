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
    expect(getCandidateVacancyStatus({ ...base, companyVacancyEvidence: evidence })).toBe("visible");
  });

  it("does not apply manager review to job boards or ordinary titles", () => {
    const evidence = { roleEligibilityReview: { status: "pending" } };
    expect(getCandidateVacancyStatus({ ...base, sourceType: "job_board", companyVacancyEvidence: evidence })).toBe("visible");
    expect(getCandidateVacancyStatus({ ...base, title: "Senior Nurse", companyVacancyEvidence: evidence })).toBe("visible");
  });
});