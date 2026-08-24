import { db, vacancyAiUsageTable } from "@workspace/db";
import { eq, lt, sql } from "drizzle-orm";

const LONDON_TIME_ZONE = "Europe/London";

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
export async function reserveVacancyAiWebSearch(
  now = new Date(),
): Promise<{ allowed: boolean; used: number; cap: number; day: string }> {
  const cap = getVacancyAiWebSearchDailyCap();
  const day = londonDayKey(now);

  // Zero is the safe default and short-circuits before any database/OpenAI
  // work. This is also the normal production path until an explicit cap is set.
  if (cap === 0) {
    return { allowed: false, used: 0, cap, day };
  }

  // The conflict predicate makes the increment itself the reservation. Once
  // the limit is reached, PostgreSQL returns no updated row and the existing
  // count is read for an accurate result.
  const [reserved] = await db
    .insert(vacancyAiUsageTable)
    .values({ londonDate: day, usedCount: 1 })
    .onConflictDoUpdate({
      target: vacancyAiUsageTable.londonDate,
      set: {
        usedCount: sql`${vacancyAiUsageTable.usedCount} + 1`,
        updatedAt: new Date(),
      },
      where: lt(vacancyAiUsageTable.usedCount, cap),
    })
    .returning({ used: vacancyAiUsageTable.usedCount });

  if (reserved) {
    return { allowed: true, used: reserved.used, cap, day };
  }

  const [current] = await db
    .select({ used: vacancyAiUsageTable.usedCount })
    .from(vacancyAiUsageTable)
    .where(eq(vacancyAiUsageTable.londonDate, day));
  return { allowed: false, used: current?.used ?? cap, cap, day };
}

/** Kept for callers that reset the old in-memory budget between tests. */
export function resetVacancyAiWebSearchUsageForTests(): void {}