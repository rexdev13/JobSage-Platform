const LONDON_TIME_ZONE = "Europe/London";
const usageByLondonDay = new Map<string, number>();

function londonDayKey(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

export function getVacancyAiWebSearchDailyCap(raw = process.env["VACANCY_AI_WEB_SEARCH_DAILY_CAP"]): number {
  const parsed = raw ? Number.parseInt(raw, 10) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Reserve one OpenAI web-search call before starting it. This is synchronous so
 * concurrent batch workers cannot overspend the configured daily allowance.
 */
export function reserveVacancyAiWebSearch(now = new Date()): { allowed: boolean; used: number; cap: number; day: string } {
  const cap = getVacancyAiWebSearchDailyCap();
  const day = londonDayKey(now);
  const used = usageByLondonDay.get(day) ?? 0;

  // The map only needs today's and recent London days in this long-lived process.
  for (const key of usageByLondonDay.keys()) {
    if (key < day) usageByLondonDay.delete(key);
  }

  if (cap === 0 || used >= cap) {
    return { allowed: false, used, cap, day };
  }

  const nextUsed = used + 1;
  usageByLondonDay.set(day, nextUsed);
  return { allowed: true, used: nextUsed, cap, day };
}

/** Test-only reset; production usage naturally rolls over when the London date changes. */
export function resetVacancyAiWebSearchUsageForTests(): void {
  usageByLondonDay.clear();
}