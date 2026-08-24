import { afterEach, describe, expect, it, vi } from "vitest";

const { usage, insertMock, selectMock } = vi.hoisted(() => ({
  usage: { used: 0 },
  insertMock: vi.fn(),
  selectMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    insert: insertMock.mockImplementation(() => ({
      values: () => ({
        onConflictDoUpdate: () => ({
          returning: () => {
            if (usage.used >= 2) return Promise.resolve([]);
            usage.used += 1;
            return Promise.resolve([{ used: usage.used }]);
          },
        }),
      }),
    })),
    select: selectMock.mockImplementation(() => ({
      from: () => ({ where: () => Promise.resolve([{ used: usage.used }]) }),
    })),
  },
  vacancyAiUsageTable: { londonDate: "londonDate", usedCount: "usedCount", updatedAt: "updatedAt" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  lt: vi.fn(),
  sql: vi.fn(),
}));

import {
  getVacancyAiWebSearchDailyCap,
  reserveVacancyAiWebSearch,
  resetVacancyAiWebSearchUsageForTests,
} from "../../lib/vacancyAiBudget";

const originalCap = process.env["VACANCY_AI_WEB_SEARCH_DAILY_CAP"];

afterEach(() => {
  if (originalCap === undefined) delete process.env["VACANCY_AI_WEB_SEARCH_DAILY_CAP"];
  else process.env["VACANCY_AI_WEB_SEARCH_DAILY_CAP"] = originalCap;
  usage.used = 0;
  insertMock.mockClear();
  selectMock.mockClear();
  resetVacancyAiWebSearchUsageForTests();
});

describe("vacancy AI web-search budget", () => {
  it("defaults to a zero-call daily cap", async () => {
    delete process.env["VACANCY_AI_WEB_SEARCH_DAILY_CAP"];
    expect(getVacancyAiWebSearchDailyCap()).toBe(0);
    await expect(reserveVacancyAiWebSearch(new Date("2026-08-24T08:00:00.000Z"))).resolves.toMatchObject({ allowed: false });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("reserves at most the configured number of calls in one London day", async () => {
    process.env["VACANCY_AI_WEB_SEARCH_DAILY_CAP"] = "2";
    const now = new Date("2026-08-24T08:00:00.000Z");

    await expect(reserveVacancyAiWebSearch(now)).resolves.toMatchObject({ allowed: true, used: 1, cap: 2, day: "2026-08-24" });
    await expect(reserveVacancyAiWebSearch(now)).resolves.toMatchObject({ allowed: true, used: 2, cap: 2, day: "2026-08-24" });
    await expect(reserveVacancyAiWebSearch(now)).resolves.toMatchObject({ allowed: false, used: 2, cap: 2, day: "2026-08-24" });
  });
});