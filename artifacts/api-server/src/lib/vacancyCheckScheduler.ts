import cron from "node-cron";
import { db } from "@workspace/db";
import { vacancySyncLogTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { runVacancyCheck } from "./vacancyCheckHelper";

export type VacancySyncTriggeredBy = "scheduler" | "manual";

const DEFAULT_BATCH_SIZE = 20;
const BATCH_CONCURRENCY = 15;

// Overlap guard — released in a finally block so it can never stay stuck.
let batchInProgress = false;

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
 * Tier B (priority 2): Has any check history AND stale (> 24h), NOT in Tier A.
 * Tier C (priority 3): Never checked at all, NOT in Tier A.
 *
 * Global exclusion: any company with a check fresher than 24h is excluded.
 */
async function selectBatch(batchSize: number): Promise<{ id: number; organisation_name: string }[]> {
  const result = await db.execute<{ id: number; organisation_name: string }>(sql`
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
      CASE
        WHEN b.sponsor_licence_id IS NOT NULL
         AND (vc.last_checked IS NULL OR vc.last_checked < NOW() - INTERVAL '7 days')
        THEN 1
        WHEN vc.last_checked IS NOT NULL
        THEN 2
        ELSE 3
      END ASC,
      CASE WHEN vc.last_checked IS NOT NULL THEN vc.last_checked END DESC NULLS LAST
    LIMIT ${batchSize}
  `);
  return result.rows;
}

export async function runVacancyCheckBatch(triggeredBy: VacancySyncTriggeredBy = "scheduler"): Promise<void> {
  if (batchInProgress) {
    console.log("[vacancy-scheduler] Previous batch still running — skipping this tick");
    return;
  }
  batchInProgress = true;

  try {
    const batchSize = getBatchSize();
    const startMs = Date.now();
    console.log(`[vacancy-scheduler] Starting batch (size: ${batchSize}, concurrency: ${BATCH_CONCURRENCY}, triggered by: ${triggeredBy})`);

    const rows = await selectBatch(batchSize);
    console.log(`[vacancy-scheduler] ${rows.length} companies selected`);
    if (rows.length === 0) return;

    let checked = 0;
    let fromCache = 0;
    let errors = 0;
    let lastErrorMsg: string | null = null;

    // Bounded worker pool — per-company failures are logged and skipped so a
    // single bad org can never kill the batch.
    let idx = 0;
    async function worker(): Promise<void> {
      while (idx < rows.length) {
        const row = rows[idx++];
        if (!row) continue;
        try {
          const result = await runVacancyCheck(row.organisation_name);
          if (result.fromCache) {
            fromCache++;
          } else {
            checked++;
          }
        } catch (err) {
          errors++;
          lastErrorMsg = err instanceof Error ? err.message : String(err);
          console.error(
            `[vacancy-scheduler] Failed for "${row.organisation_name}":`,
            lastErrorMsg,
          );
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(BATCH_CONCURRENCY, rows.length) }, () => worker()),
    );

    const durationMs = Date.now() - startMs;
    const status = errors > 0 && checked === 0 && fromCache === 0 ? "error" : "success";

    await db.insert(vacancySyncLogTable).values({
      status,
      batchSize: rows.length,
      checkedCount: checked,
      cacheHitCount: fromCache,
      errorCount: errors,
      errorMessage: lastErrorMsg ? (lastErrorMsg as string).slice(0, 2000) : null,
      triggeredBy,
      durationMs,
    }).catch((err) => {
      console.error("[vacancy-scheduler] Failed to write sync log:", err);
    });

    console.log(
      `[vacancy-scheduler] Batch complete — new checks: ${checked}, cache hits: ${fromCache}, errors: ${errors}, ${durationMs}ms`,
    );
  } finally {
    batchInProgress = false;
  }
}

export function startVacancyCheckScheduler(): void {
  // Batch every 6 hours with a 15-worker pool, honouring the tiered
  // prioritisation in selectBatch.
  cron.schedule(
    "0 */6 * * *",
    () => {
      runVacancyCheckBatch("scheduler").catch((err) => {
        console.error("[vacancy-scheduler] Unhandled scheduler error:", err);
      });
    },
    { timezone: "Europe/London" },
  );

  console.log(
    `[vacancy-scheduler] Scheduler registered: every 6 hours, batch size ${getBatchSize()}, concurrency ${BATCH_CONCURRENCY}`,
  );
}
