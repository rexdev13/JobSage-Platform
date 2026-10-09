import { describe, expect, it } from "vitest";
import { countPendingApplications, countUpcomingInterviews, getMonthlyReportOverview } from "./dashboardOverview";

describe("dashboard overview metrics", () => {
  it("counts only submitted applications in applied or shortlisted states", () => {
    expect(countPendingApplications([
      { status: "applied" }, { status: "shortlisted" }, { status: "link_clicked" },
      { status: "in_progress" }, { status: "offer" }, { status: "rejected" },
      { status: "no_response" },
    ])).toBe(2);
  });
  it("counts future interviews only when their status is interview", () => {
    const now = new Date("2026-04-10T12:00:00Z");
    expect(countUpcomingInterviews([
      { status: "interview", interviewDate: "2026-04-11T12:00:00Z" },
      { status: "interview", interviewDate: "2026-04-10T11:00:00Z" },
      { status: "applied", interviewDate: "2026-04-12T12:00:00Z" },
      { status: "interview", interviewDate: "not-a-date" },
    ], now)).toBe(1);
  });
  it("uses the real report period, applications this month and recommendations", () => {
    expect(getMonthlyReportOverview({
      period: { month: "April", year: 2026 },
      stats: { applicationsThisMonth: 7 },
      recommendations: "Keep preparing for interviews.",
    })).toEqual({
      periodLabel: "April 2026",
      applicationsThisMonth: 7,
      recommendations: "Keep preparing for interviews.",
    });
  });
});
