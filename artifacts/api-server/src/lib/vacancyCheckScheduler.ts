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
 * Select up to batchSize companies to vacancy-check, in priority order:
 *  1. Bookmarked by the most users (most user interest) — checked > 24h ago or never
 *  2. Any other companies not checked in the last 24h, oldest-checked first
 *
 * Companies with a fresh check (< 24h) are excluded entirely — the helper
 * would return a cached hit anyway, so there's no point including them.
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
      SELECT sponsor_licence_id, COUNT(DISTINCT user_id) AS bookmark_count
      FROM sponsor_licence_bookmarks
      GROUP BY sponsor_licence_id
    ) b ON b.sponsor_licence_id = sl.id
    WHERE vc.last_checked IS NULL
       OR vc.last_checked < NOW() - INTERVAL '24 hours'
    ORDER BY
      COALESCE(b.bookmark_count, 0) DESC,
      vc.last_checked ASC NULLS FIRST
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
