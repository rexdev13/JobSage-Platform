import { afterEach, describe, expect, it } from "vitest";
import {
  getVacancyAiWebSearchDailyCap,
  reserveVacancyAiWebSearch,
  resetVacancyAiWebSearchUsageForTests,
} from "../../lib/vacancyAiBudget";

const originalCap = process.env["VACANCY_AI_WEB_SEARCH_DAILY_CAP"];

afterEach(() => {
  if (originalCap === undefined) delete process.env["VACANCY_AI_WEB_SEARCH_DAILY_CAP"];
  else process.env["VACANCY_AI_WEB_SEARCH_DAILY_CAP"] = originalCap;
  resetVacancyAiWebSearchUsageForTests();
});

describe("vacancy AI web-search budget", () => {
  it("defaults to a zero-call daily cap", () => {
    delete process.env["VACANCY_AI_WEB_SEARCH_DAILY_CAP"];
    expect(getVacancyAiWebSearchDailyCap()).toBe(0);
    expect(reserveVacancyAiWebSearch(new Date("2026-08-24T08:00:00.000Z")).allowed).toBe(false);
  });

  it("reserves at most the configured number of calls in one London day", () => {
    process.env["VACANCY_AI_WEB_SEARCH_DAILY_CAP"] = "2";
    const now = new Date("2026-08-24T08:00:00.000Z");

    expect(reserveVacancyAiWebSearch(now)).toMatchObject({ allowed: true, used: 1, cap: 2, day: "2026-08-24" });
    expect(reserveVacancyAiWebSearch(now)).toMatchObject({ allowed: true, used: 2, cap: 2, day: "2026-08-24" });
    expect(reserveVacancyAiWebSearch(now)).toMatchObject({ allowed: false, used: 2, cap: 2, day: "2026-08-24" });
  });
});