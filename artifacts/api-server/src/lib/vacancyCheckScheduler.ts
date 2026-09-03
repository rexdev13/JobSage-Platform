import cron from "node-cron";
import { db } from "@workspace/db";
import { vacancySyncLogTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { runVacancyCheck } from "./vacancyCheckHelper";

export type VacancySyncTriggeredBy = "scheduler" | "manual";
export type VacancyCheckBatchSummary = {
  selected: number;
  checked: number;
  cacheHits: number;
  errors: number;
  upserted: number;
};

export const DEFAULT_VACANCY_CHECK_BATCH_SIZE = 250;
export const MAX_VACANCY_CHECK_BATCH_SIZE = 250;
export const VACANCY_CHECK_CONCURRENCY = 15;
export const VACANCY_CHECK_CRON = "0 2,8,14,20 * * *";
export const HEALTHCARE_SPONSOR_INDICATORS = [
  "nhs",
  "hospital",
  "health",
  "medical",
  "social care",
  "care home",
  "nursing",
] as const;
export const HEALTHCARE_SPONSOR_SQL_REGEXP =
  `\\m(${HEALTHCARE_SPONSOR_INDICATORS.join("|")})\\M`;
export const BOOKMARK_QUEUE_SHARE = 0.25;
export const HEALTHCARE_QUEUE_SHARE = 0.5;

// Overlap guard — released in a finally block so it can never stay stuck.
let batchInProgress = false;

function getBatchSize(): number {
  const raw = process.env["VACANCY_CHECK_BATCH_SIZE"];
  if (raw) {
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n > 0) return Math.min(n, MAX_VACANCY_CHECK_BATCH_SIZE);
  }
  return DEFAULT_VACANCY_CHECK_BATCH_SIZE;
}

/**
 * Select up to batchSize companies to vacancy-check, in explicit priority order:
 *
 * Tier A: reserve a quarter of the batch for bookmarked sponsors, regardless
 * of their sector.
 * Tier B: fill the remaining slots with an even healthcare/non-health split,
 * using the oldest rows in each cohort first.
 * Tier C: use any available rows to fill a shortfall when one cohort is small.
 *
 * Healthcare relevance is determined from the sponsor's industry or organisation
 * name: NHS, hospital, health, medical, social care, care home, or nursing.
 * Every stale sponsor is eligible: the healthcare signal balances the queue but
 * never excludes education, engineering, technology, finance, legal, or other
 * professional sectors.
 */
export async function selectBatch(batchSize: number): Promise<{ id: number; organisation_name: string }[]> {
  const bookmarkLimit = Math.max(1, Math.floor(batchSize * BOOKMARK_QUEUE_SHARE));
  const result = await db.execute<{ id: number; organisation_name: string }>(sql`
    WITH eligible AS (
      SELECT
        sl.id,
        sl.organisation_name,
        vc.last_checked,
        b.sponsor_licence_id IS NOT NULL AS is_bookmarked,
        (
          lower(COALESCE(sl.industry, '')) ~* ${HEALTHCARE_SPONSOR_SQL_REGEXP}
          OR lower(sl.organisation_name) ~* ${HEALTHCARE_SPONSOR_SQL_REGEXP}
        ) AS is_healthcare
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
      WHERE vc.last_checked IS NULL OR vc.last_checked < NOW() - INTERVAL '24 hours'
    ),
    selected_bookmarks AS (
      SELECT e.*
      FROM eligible e
      WHERE e.is_bookmarked
      ORDER BY
        CASE WHEN e.last_checked IS NOT NULL THEN e.last_checked END ASC NULLS FIRST,
        e.id ASC
      LIMIT ${bookmarkLimit}
    ),
    queue_limits AS (
      SELECT GREATEST(0, ${batchSize} - COUNT(*)::int) AS unbookmarked_slots
      FROM selected_bookmarks
    ),
    ranked_unbookmarked AS (
      SELECT
        e.*,
        ROW_NUMBER() OVER (
          PARTITION BY e.is_healthcare
          ORDER BY
            CASE WHEN e.last_checked IS NOT NULL THEN e.last_checked END ASC NULLS FIRST,
            e.id ASC
        ) AS cohort_rank
      FROM eligible e
      WHERE NOT e.is_bookmarked
    ),
    balanced_unbookmarked AS (
      SELECT r.*
      FROM ranked_unbookmarked r
      CROSS JOIN queue_limits q
      WHERE r.cohort_rank <= CASE
        WHEN r.is_healthcare
        THEN FLOOR(q.unbookmarked_slots * CAST(${HEALTHCARE_QUEUE_SHARE} AS numeric))
        ELSE q.unbookmarked_slots - FLOOR(q.unbookmarked_slots * CAST(${HEALTHCARE_QUEUE_SHARE} AS numeric))
      END
    ),
    fill_unbookmarked AS (
      SELECT r.*
      FROM ranked_unbookmarked r
      WHERE NOT EXISTS (
        SELECT 1
        FROM balanced_unbookmarked b
        WHERE b.id = r.id
      )
      ORDER BY
        CASE WHEN r.last_checked IS NOT NULL THEN r.last_checked END ASC NULLS FIRST,
        r.id ASC
      LIMIT (
        SELECT GREATEST(
          0,
          q.unbookmarked_slots - (SELECT COUNT(*)::int FROM balanced_unbookmarked)
        )
        FROM queue_limits q
      )
    ),
    selected AS (
      SELECT id, organisation_name, 0 AS priority, last_checked FROM selected_bookmarks
      UNION ALL
      SELECT id, organisation_name, 1 AS priority, last_checked FROM balanced_unbookmarked
      UNION ALL
      SELECT id, organisation_name, 2 AS priority, last_checked FROM fill_unbookmarked
    )
    SELECT id, organisation_name
    FROM selected
    ORDER BY priority ASC, last_checked ASC NULLS FIRST, id ASC
    LIMIT ${batchSize}
  `);
  return result.rows;
}

export async function runVacancyCheckBatch(
  triggeredBy: VacancySyncTriggeredBy = "scheduler",
): Promise<VacancyCheckBatchSummary | null> {
  if (batchInProgress) {
    console.log("[vacancy-scheduler] Previous batch still running — skipping this tick");
    return null;
  }
  batchInProgress = true;

  try {
    const batchSize = getBatchSize();
    const startMs = Date.now();
    console.log(`[vacancy-scheduler] Starting batch (size: ${batchSize}, concurrency: ${VACANCY_CHECK_CONCURRENCY}, triggered by: ${triggeredBy})`);

    const rows = await selectBatch(batchSize);
    console.log(`[vacancy-scheduler] ${rows.length} companies selected`);
    if (rows.length === 0) {
      console.log(`[pipeline-tick] env=${process.env.NODE_ENV ?? "unknown"} job=job_board selected=0 upserted=0 live=0 dead=0 inconclusive=0 errors=0`);
      return { selected: 0, checked: 0, cacheHits: 0, errors: 0, upserted: 0 };
    }

    let checked = 0;
    let fromCache = 0;
    let errors = 0;
    let upserted = 0;
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
            upserted += result.upsertedCount ?? 0;
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
      Array.from({ length: Math.min(VACANCY_CHECK_CONCURRENCY, rows.length) }, () => worker()),
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
    console.log(`[pipeline-tick] env=${process.env.NODE_ENV ?? "unknown"} job=job_board selected=${rows.length} upserted=${upserted} live=0 dead=0 inconclusive=0 errors=${errors}`);
    return { selected: rows.length, checked, cacheHits: fromCache, errors, upserted };
  } finally {
    batchInProgress = false;
  }
}

export function startVacancyCheckScheduler(): void {
  // Batch every 6 hours with a 15-worker pool, honouring the tiered
  // prioritisation in selectBatch.
  cron.schedule(
    VACANCY_CHECK_CRON,
    () => {
      runVacancyCheckBatch("scheduler").catch((err) => {
        console.error("[vacancy-scheduler] Unhandled scheduler error:", err);
        console.log(`[pipeline-tick] env=${process.env.NODE_ENV ?? "unknown"} job=job_board selected=0 upserted=0 live=0 dead=0 inconclusive=0 errors=1`);
      });
    },
    { timezone: "Europe/London" },
  );

  console.log(
    `[vacancy-scheduler] Scheduler registered: every 6 hours (${VACANCY_CHECK_CRON}) Europe/London, batch size ${getBatchSize()}, concurrency ${VACANCY_CHECK_CONCURRENCY}`,
  );
}
