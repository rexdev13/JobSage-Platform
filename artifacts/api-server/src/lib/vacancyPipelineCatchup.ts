import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { runVacancyCheckBatch } from "./vacancyCheckScheduler";
import { runCompanySiteDiscoveryBatch } from "./companySiteScheduler";
import { runVacancyLivenessSweep } from "./vacancyLivenessSweep";

export const BOARD_CATCHUP_STALE_MS = 6 * 60 * 60 * 1000;
export const COMPANY_CATCHUP_STALE_MS = 60 * 60 * 1000;
export const LIVENESS_CATCHUP_STALE_MS = 6 * 60 * 60 * 1000;

type FreshnessRow = {
  board_last_success: string | null;
  company_last_success: string | null;
  liveness_last_success: string | null;
  unverified_job_board: number | string;
};

function isStale(value: string | null, thresholdMs: number): boolean {
  if (!value) return true;
  const timestamp = new Date(value).getTime();
  return !Number.isFinite(timestamp) || Date.now() - timestamp > thresholdMs;
}

async function withCatchupLock(name: string, run: () => Promise<void>): Promise<boolean> {
  const client = await pool.connect();
  try {
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [`jobsage-pipeline-catchup:${name}`],
    );
    if (lock.rows[0]?.acquired !== true) {
      console.log(`[pipeline-catchup] env=${process.env.NODE_ENV ?? "unknown"} job=${name} skipped=lock-held`);
      return false;
    }
    try {
      await run();
      return true;
    } finally {
      await client.query(
        "SELECT pg_advisory_unlock(hashtext($1))",
        [`jobsage-pipeline-catchup:${name}`],
      ).catch(() => {});
    }
  } finally {
    client.release();
  }
}

export async function getVacancyPipelineFreshness(): Promise<FreshnessRow> {
  const result = await db.execute<FreshnessRow>(sql`
    SELECT
      (SELECT MAX(created_at)::text FROM vacancy_sync_log WHERE status = 'success') AS board_last_success,
      (
        SELECT MAX(updated_at)::text
        FROM sponsor_licence_company_site_checks
        WHERE last_error IS NULL
          AND (generic_checked_at IS NOT NULL OR ats_checked_at IS NOT NULL)
      ) AS company_last_success,
      (
        SELECT MAX(last_verified_at)::text
        FROM sponsor_licence_vacancies
        WHERE source_type IN ('job_board', 'company_site')
      ) AS liveness_last_success,
      (
        SELECT COUNT(*)::int
        FROM sponsor_licence_vacancies
        WHERE source_type = 'job_board'
          AND liveness = 'unverified'
          AND url IS NOT NULL
      ) AS unverified_job_board
  `);
  return result.rows[0] ?? {
    board_last_success: null,
    company_last_success: null,
    liveness_last_success: null,
    unverified_job_board: 0,
  };
}

export async function runVacancyPipelineCatchupsIfStale(): Promise<void> {
  const freshness = await getVacancyPipelineFreshness();
  const unverifiedJobBoard = Number(freshness.unverified_job_board) || 0;
  const boardStale = isStale(freshness.board_last_success, BOARD_CATCHUP_STALE_MS);
  const companyStale = isStale(freshness.company_last_success, COMPANY_CATCHUP_STALE_MS);
  const livenessStale =
    unverifiedJobBoard > 0 ||
    isStale(freshness.liveness_last_success, LIVENESS_CATCHUP_STALE_MS);

  console.log(
    `[pipeline-catchup] env=${process.env.NODE_ENV ?? "unknown"} board_stale=${boardStale} company_stale=${companyStale} liveness_stale=${livenessStale} unverified_job_board=${unverifiedJobBoard}`,
  );

  const attempt = async (name: string, run: () => Promise<void>) => {
    try {
      await withCatchupLock(name, run);
    } catch (error) {
      console.error(
        `[pipeline-catchup] env=${process.env.NODE_ENV ?? "unknown"} job=${name} failed:`,
        error instanceof Error ? error.message : error,
      );
    }
  };

  if (boardStale) {
    await attempt("job_board", async () => {
      await runVacancyCheckBatch("scheduler");
    });
  }
  await Promise.all([
    companyStale
      ? attempt("company_site", async () => {
          await runCompanySiteDiscoveryBatch();
        })
      : Promise.resolve(),
    livenessStale
      ? attempt("liveness", async () => {
          await runVacancyLivenessSweep();
        })
      : Promise.resolve(),
  ]);
}