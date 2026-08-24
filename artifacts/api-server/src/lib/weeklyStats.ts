const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

const APPLICATION_STATUSES = ["link_clicked", "applied", "interview", "offer"] as const;
const LEAD_STATUSES = ["new", "contacted", "registered", "unqualified"] as const;

type TimestampValue = Date | string | number;

export function getRollingWeekStart(now: Date): Date {
  return new Date(now.getTime() - SEVEN_DAYS_MS);
}

function isWithinLastSevenDays(value: TimestampValue, now: Date): boolean {
  const timestamp = new Date(value).getTime();
  const end = now.getTime();
  return Number.isFinite(timestamp) && timestamp >= getRollingWeekStart(now).getTime() && timestamp <= end;
}

export type WeeklyApplicationStats = {
  total: number;
  link_clicked: number;
  applied: number;
  interview: number;
  offer: number;
};

export function buildWeeklyApplicationStats(
  applications: readonly { appliedAt: TimestampValue; status: string }[],
  now: Date,
): WeeklyApplicationStats {
  const stats: WeeklyApplicationStats = {
    total: 0,
    link_clicked: 0,
    applied: 0,
    interview: 0,
    offer: 0,
  };

  for (const application of applications) {
    if (!isWithinLastSevenDays(application.appliedAt, now)) continue;
    stats.total += 1;
    if (APPLICATION_STATUSES.includes(application.status as (typeof APPLICATION_STATUSES)[number])) {
      stats[application.status as (typeof APPLICATION_STATUSES)[number]] += 1;
    }
  }

  return stats;
}

export type LeadStats = {
  statusTotals: {
    new: number;
    contacted: number;
    registered: number;
    unqualified: number;
  };
  createdLast7Days: number;
};

export function buildLeadStats(
  statusRows: readonly { status: string | null; total: number | string }[],
  createdLast7Days: number | string,
): LeadStats {
  const stats: LeadStats = {
    statusTotals: {
      new: 0,
      contacted: 0,
      registered: 0,
      unqualified: 0,
    },
    createdLast7Days: 0,
  };

  for (const row of statusRows) {
    if (row.status && LEAD_STATUSES.includes(row.status as (typeof LEAD_STATUSES)[number])) {
      stats.statusTotals[row.status as (typeof LEAD_STATUSES)[number]] = Number(row.total);
    }
  }
  stats.createdLast7Days = Number(createdLast7Days);

  return stats;
}