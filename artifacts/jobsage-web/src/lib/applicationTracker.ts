export type TimeframeFilter = "7d" | "30d" | "1y" | "all";

export const TIMEFRAME_OPTIONS: Array<{ id: TimeframeFilter; label: string }> = [
  { id: "7d", label: "7 Days" },
  { id: "30d", label: "Month" },
  { id: "1y", label: "Year" },
  { id: "all", label: "Full History" },
];

const TIMEFRAME_DAYS: Record<Exclude<TimeframeFilter, "all">, number> = {
  "7d": 7,
  "30d": 30,
  "1y": 365,
};

export function filterApplicationsByTimeframe<T extends {
  appliedAt?: string | Date | null;
  createdAt?: string | Date | null;
}>(
  applications: T[],
  timeframe: TimeframeFilter,
  nowMs = Date.now(),
): T[] {
  if (timeframe === "all") return applications;

  const cutoff = nowMs - TIMEFRAME_DAYS[timeframe] * 24 * 60 * 60 * 1000;
  return applications.filter((application) => {
    const timestamp = application.appliedAt ?? application.createdAt;
    if (!timestamp) return false;
    const dateMs = new Date(timestamp).getTime();
    return Number.isFinite(dateMs) && dateMs >= cutoff;
  });
}

export function excludeClosedApplications<T extends { isClosed?: boolean | null }>(
  applications: T[],
): T[] {
  return applications.filter((application) => application.isClosed !== true);
}

export type ApplicationProcessStage = 0 | 1 | 2 | 3;

export function getApplicationProcessStage(status: string): ApplicationProcessStage {
  switch (status) {
    case "link_clicked":
      return 0;
    case "interview":
    case "interview_invited":
      return 2;
    case "offer":
      return 3;
    case "applied":
    case "cv_sent":
    case "sent":
    case "under_review":
    case "shortlisted":
    case "acknowledged":
    case "no_response":
    case "rejected":
    default:
      return 1;
  }
}

export function isRejectedApplicationStatus(status: string): boolean {
  return status === "rejected";
}