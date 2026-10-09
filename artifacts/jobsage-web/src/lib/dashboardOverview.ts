export interface OverviewApplication {
  status?: string | null;
  interviewDate?: string | null;
}

export function countPendingApplications(applications: OverviewApplication[]): number {
  return applications.filter((application) =>
    application.status === "applied" || application.status === "shortlisted",
  ).length;
}

export function countUpcomingInterviews(
  applications: OverviewApplication[],
  now: Date = new Date(),
): number {
  return applications.filter((application) => {
    if (application.status !== "interview" || !application.interviewDate) return false;
    const interviewTime = Date.parse(application.interviewDate);
    return Number.isFinite(interviewTime) && interviewTime > now.getTime();
  }).length;
}

export function getMonthlyReportOverview(report: {
  period: { month: string; year: number };
  stats: { applicationsThisMonth: number };
  recommendations?: string | null;
} | undefined) {
  if (!report) return null;
  return {
    periodLabel: `${report.period.month} ${report.period.year}`,
    applicationsThisMonth: report.stats.applicationsThisMonth,
    recommendations: report.recommendations?.trim() || null,
  };
}
