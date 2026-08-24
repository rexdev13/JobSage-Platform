import { describe, expect, it } from "vitest";
import { buildLeadStats, buildWeeklyApplicationStats, getRollingWeekStart } from "../../lib/weeklyStats";

const NOW = new Date("2026-08-24T12:00:00.000Z");

describe("weekly stats", () => {
  it("counts application statuses inside the inclusive seven-day window only", () => {
    const stats = buildWeeklyApplicationStats(
      [
        { appliedAt: new Date("2026-08-17T12:00:00.000Z"), status: "link_clicked" },
        { appliedAt: new Date("2026-08-18T12:00:00.000Z"), status: "applied" },
        { appliedAt: new Date("2026-08-20T12:00:00.000Z"), status: "interview" },
        { appliedAt: new Date("2026-08-24T11:59:59.999Z"), status: "offer" },
        { appliedAt: new Date("2026-08-17T11:59:59.999Z"), status: "offer" },
        { appliedAt: new Date("2026-08-24T12:00:00.001Z"), status: "applied" },
      ],
      NOW,
    );

    expect(stats).toEqual({
      total: 4,
      link_clicked: 1,
      applied: 1,
      interview: 1,
      offer: 1,
    });
  });

  it("uses the same exact seven-day start for timestamp queries", () => {
    expect(getRollingWeekStart(NOW).toISOString()).toBe("2026-08-17T12:00:00.000Z");
  });

  it("maps SQL lead aggregates into every lead-status total", () => {
    const stats = buildLeadStats(
      [
        { status: "new", total: 2 },
        { status: "contacted", total: 1 },
        { status: "registered", total: 1 },
        { status: "unqualified", total: 1 },
      ],
      4,
    );

    expect(stats).toEqual({
      statusTotals: {
        new: 2,
        contacted: 1,
        registered: 1,
        unqualified: 1,
      },
      createdLast7Days: 4,
    });
  });
});