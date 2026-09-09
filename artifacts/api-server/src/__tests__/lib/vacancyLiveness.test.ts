import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getVacancyLinkStatus,
  RECENT_VERIFY_SKIP_MS,
  VACANCY_VISIBLE_WINDOW_MS,
  vacancyVisibilityWindowMs,
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
});