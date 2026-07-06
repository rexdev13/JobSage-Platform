import cron from "node-cron";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { runVacancyCheck } from "./vacancyCheckHelper";

const DEFAULT_BATCH_SIZE = 50;

function getBatchSize(): number {
  const raw = process.env["VACANCY_CHECK_BATCH_SIZE"];
  if (raw) {
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return DEFAULT_BATCH_SIZE;
}

/**
 * Select up to batchSize companies to vacancy-check, in explicit priority order:
 *
 * Tier A (priority 1): Bookmarked by any user AND last checked > 7 days ago (or never).
 *   These are the most likely to surface relevant results for engaged users.
 *
 * Tier B (priority 2): Has any check history AND stale (> 24h), NOT in Tier A.
 *   Ordered by last_checked DESC — companies checked most recently by users are
 *   prioritised first (they show active user interest in that company).
 *
 * Tier C (priority 3): Never checked at all, NOT in Tier A.
 *   Lowest priority; fills remaining batch slots.
 *
 * Global exclusion: any company with a check fresher than 24h is excluded — the
 * helper would return a cached hit anyway, so there is no value in including them.
 */
async function selectBatch(batchSize: number): Promise<{ id: number; organisation_name: string }[]> {
  return db.execute<{ id: number; organisation_name: string }>(sql`
    SELECT sl.id, sl.organisation_name
    FROM sponsor_licences sl
    LEFT JOIN (
      SELECT organisation_name, MAX(checked_at) AS last_checked
      FROM sponsor_licence_vacancy_checks
      GROUP BY organisation_name
    ) vc ON vc.organisation_name = sl.organisation_name
    LEFT JOIN (
      SELECT DISTINCT sponsor_licence_id
      FROM sponsor_licence_bookmarks
    ) b ON b.sponsor_licence_id = sl.id
    WHERE
      vc.last_checked IS NULL
      OR vc.last_checked < NOW() - INTERVAL '24 hours'
    ORDER BY
      -- Tier assignment: A=1, B=2, C=3
      CASE
        WHEN b.sponsor_licence_id IS NOT NULL
         AND (vc.last_checked IS NULL OR vc.last_checked < NOW() - INTERVAL '7 days')
        THEN 1
        WHEN vc.last_checked IS NOT NULL
        THEN 2
        ELSE 3
      END ASC,
      -- Within Tier B: most recently checked companies first (interest signal).
      -- For Tier A and C this expression is NULL, so NULLS LAST has no effect on ordering.
      CASE WHEN vc.last_checked IS NOT NULL THEN vc.last_checked END DESC NULLS LAST
    LIMIT ${batchSize}
  `);
}

async function runVacancyCheckBatch(): Promise<void> {
  const batchSize = getBatchSize();
  console.log(`[vacancy-scheduler] Starting daily batch (size: ${batchSize})`);

  const rows = await selectBatch(batchSize);
  console.log(`[vacancy-scheduler] ${rows.length} companies selected`);

  let checked = 0;
  let fromCache = 0;
  let errors = 0;

  for (const row of rows) {
    try {
      const result = await runVacancyCheck(row.organisation_name);
      if (result.fromCache) {
        fromCache++;
      } else {
        checked++;
      }
    } catch (err) {
      errors++;
      console.error(
        `[vacancy-scheduler] Failed for "${row.organisation_name}":`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(
    `[vacancy-scheduler] Batch complete — new checks: ${checked}, cache hits: ${fromCache}, errors: ${errors}`,
  );
}

export function startVacancyCheckScheduler(): void {
  cron.schedule(
    "0 6 * * *",
    () => {
      runVacancyCheckBatch().catch((err) => {
        console.error("[vacancy-scheduler] Unhandled scheduler error:", err);
      });
    },
    { timezone: "Europe/London" },
  );

  console.log("[vacancy-scheduler] Scheduler registered: daily at 06:00 Europe/London");
}
