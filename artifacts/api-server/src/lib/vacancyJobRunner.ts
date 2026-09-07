import { pool } from "@workspace/db";
import {
  runVacancyCheckBatch,
  DEFAULT_VACANCY_CHECK_BATCH_SIZE,
} from "./vacancyCheckScheduler";
import {
  runCompanySiteDiscoveryBatch,
  COMPANY_SITE_DISCOVERY_BATCH_SIZE,
} from "./companySiteScheduler";
import {
  runVacancyLivenessSweep,
  VACANCY_LIVENESS_BATCH_LIMIT,
  VACANCY_LIVENESS_DOMAIN_CONCURRENCY,
} from "./vacancyLivenessSweep";
import {
  runContactEnrichmentBatch,
  CONTACT_ENRICHMENT_BATCH_SIZE,
} from "./contactEnrichmentRunner";

export type VacancyJobKind = "job_board" | "company_site" | "liveness" | "contact";

export type VacancyJobSummary = {
  selected: number;
  upserted: number;
  live: number;
  dead: number;
  inconclusive: number;
  errors: number;
  done: boolean;
  remaining?: number;
  remainingIsLowerBound?: boolean;
  durationMs?: number;
};

export const PIPELINE_WRITER_LOCK = "jobsage:external-vacancy-pipeline-writer";
export const COMPANY_SITE_HTTP_BUDGET_MS = 20_000;

export const CLI_JOB_LIMITS: Record<VacancyJobKind, number> = {
  job_board: DEFAULT_VACANCY_CHECK_BATCH_SIZE,
  company_site: COMPANY_SITE_DISCOVERY_BATCH_SIZE,
  liveness: VACANCY_LIVENESS_BATCH_LIMIT,
  contact: CONTACT_ENRICHMENT_BATCH_SIZE,
};

async function withPipelineWriter<T>(
  job: VacancyJobKind,
  run: () => Promise<T>,
): Promise<T | null> {
  const client = await pool.connect();
  let acquired = false;
  try {
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [PIPELINE_WRITER_LOCK],
    );
    acquired = lock.rows[0]?.acquired === true;
    if (!acquired) {
      console.log(`[vacancy-job] job=${job} skipped=writer-lock-held`);
      return null;
    }
    return await run();
  } finally {
    if (acquired) {
      await client
        .query("SELECT pg_advisory_unlock(hashtext($1))", [PIPELINE_WRITER_LOCK])
        .catch((error) => {
          console.error(
            "[vacancy-job] Failed to release writer lock:",
            error instanceof Error ? error.message : error,
          );
        });
    }
    client.release();
  }
}

export async function runVacancyJob(
  job: VacancyJobKind,
  limit = CLI_JOB_LIMITS[job],
): Promise<VacancyJobSummary | null> {
  const batchLimit = Math.max(1, Math.floor(limit));
  return withPipelineWriter(job, async () => {
    if (job === "job_board") {
      const summary = await runVacancyCheckBatch("scheduler", { batchSize: batchLimit });
      const selected = summary?.selected ?? 0;
      return {
        selected,
        upserted: summary?.upserted ?? 0,
        live: 0,
        dead: 0,
        inconclusive: 0,
        errors: summary?.errors ?? 0,
        done: selected < batchLimit,
      };
    }

    if (job === "company_site") {
      const summary = await runCompanySiteDiscoveryBatch({
        batchSize: batchLimit,
        deadlineMs: Date.now() + COMPANY_SITE_HTTP_BUDGET_MS,
      });
      const selected = summary?.selected ?? 0;
      return {
        selected,
        upserted: summary?.upserted ?? 0,
        live: 0,
        dead: 0,
        inconclusive: 0,
        errors: summary?.errors ?? 0,
        done: summary?.done ?? selected < batchLimit,
        remaining: summary?.remaining,
        remainingIsLowerBound: summary?.remainingIsLowerBound,
        durationMs: summary?.durationMs,
      };
    }
    if (job === "contact") {
      return runContactEnrichmentBatch({ batchSize: batchLimit });
    }

    let selected = 0;
    const summary = await runVacancyLivenessSweep({
      batchLimit,
      domainConcurrency: VACANCY_LIVENESS_DOMAIN_CONCURRENCY,
      onSelected: (count) => {
        selected = count;
      },
    });
    return {
      selected,
      upserted: 0,
      live: summary?.live ?? 0,
      dead: summary?.dead ?? 0,
      inconclusive: summary?.inconclusive ?? 0,
      errors: 0,
      done: selected < batchLimit,
    };
  });
}