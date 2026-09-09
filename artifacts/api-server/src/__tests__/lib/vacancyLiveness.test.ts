import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_SITE_VISIBLE_WINDOW_MS,
  getVacancyLinkStatus,
  RECENT_VERIFY_SKIP_MS,
  vacancyVisibilityWindowMs,
} from "../../lib/vacancyLiveness";

describe("candidate-facing vacancy freshness", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps job-board freshness at six hours", () => {
    expect(vacancyVisibilityWindowMs("job_board")).toBe(RECENT_VERIFY_SKIP_MS);
    expect(RECENT_VERIFY_SKIP_MS).toBe(6 * 60 * 60 * 1000);
  });

  it("keeps successfully verified company-site links visible for 48 hours", () => {
    const now = new Date("2026-09-09T12:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    expect(vacancyVisibilityWindowMs("company_site")).toBe(
      COMPANY_SITE_VISIBLE_WINDOW_MS,
    );
    expect(COMPANY_SITE_VISIBLE_WINDOW_MS).toBe(48 * 60 * 60 * 1000);
    expect(getVacancyLinkStatus(
      "https://careers.example.com/jobs/1",
      "live",
      new Date(now.getTime() - 24 * 60 * 60 * 1000),
      null,
      vacancyVisibilityWindowMs("company_site"),
    )).toBe("live");
    expect(getVacancyLinkStatus(
      "https://careers.example.com/jobs/1",
      "live",
      new Date(now.getTime() - 49 * 60 * 60 * 1000),
      null,
      vacancyVisibilityWindowMs("company_site"),
    )).toBe("stale");
  });
});