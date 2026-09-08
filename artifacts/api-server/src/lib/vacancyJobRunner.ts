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
export const LIVENESS_HTTP_BUDGET_MS = 18_000;

export const CLI_JOB_LIMITS: Record<VacancyJobKind, number> = {
  job_board: DEFAULT_VACANCY_CHECK_BATCH_SIZE,
  company_site: COMPANY_SITE_DISCOVERY_BATCH_SIZE,
  liveness: VACANCY_LIVENESS_BATCH_LIMIT,
  contact: CONTACT_ENRICHMENT_BATCH_SIZE,
};

async function withPipelineWriter<T>(
  job: VacancyJobKind,
  run: () => Promise<T>,
  deadlineMs?: number,
): Promise<T | null> {
  const wait = async <V>(promise: Promise<V>): Promise<V> => {
    if (!deadlineMs) return promise;
    const remaining = deadlineMs - Date.now();
    if (remaining <= 0) throw new Error("VACANCY_JOB_DEADLINE");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("VACANCY_JOB_DEADLINE")), remaining);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  const connectPromise = pool.connect();
  let client: Awaited<typeof connectPromise>;
  try {
    client = await wait(connectPromise);
  } catch (error) {
    void connectPromise.then((lateClient) => lateClient.release()).catch(() => {});
    throw error;
  }
  let acquired = false;
  let releaseAfterUnlock = false;
  try {
    const lockPromise = client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [PIPELINE_WRITER_LOCK],
    );
    let lock: Awaited<typeof lockPromise>;
    try {
      lock = await wait(lockPromise);
    } catch (error) {
      if (error instanceof Error && error.message === "VACANCY_JOB_DEADLINE") {
        // Never return a client to the pool while its lock query is active.
        // If it acquires the lock after our HTTP deadline, release that lock
        // before making the connection reusable.
        releaseAfterUnlock = true;
        void lockPromise
          .then(async (lateLock) => {
            if (lateLock.rows[0]?.acquired === true) {
              await client.query(
                "SELECT pg_advisory_unlock(hashtext($1))",
                [PIPELINE_WRITER_LOCK],
              );
            }
          })
          .catch((cleanupError) => {
            console.error(
              "[vacancy-job] Late writer-lock cleanup failed:",
              cleanupError instanceof Error ? cleanupError.message : cleanupError,
            );
          })
          .finally(() => client.release());
      }
      throw error;
    }
    acquired = lock.rows[0]?.acquired === true;
    if (!acquired) {
      console.log(`[vacancy-job] job=${job} skipped=writer-lock-held`);
      return null;
    }
    return job === "liveness" ? await run() : await wait(run());
  } finally {
    if (acquired) {
      releaseAfterUnlock = true;
      void client
        .query("SELECT pg_advisory_unlock(hashtext($1))", [PIPELINE_WRITER_LOCK])
        .catch((error) => {
          console.error(
            "[vacancy-job] Failed to release writer lock:",
            error instanceof Error ? error.message : error,
          );
        })
        .finally(() => client.release());
    }
    if (!releaseAfterUnlock) client.release();
  }
}

export async function runVacancyJob(
  job: VacancyJobKind,
  limit = CLI_JOB_LIMITS[job],
  options: { deadlineMs?: number } = {},
): Promise<VacancyJobSummary | null> {
  const batchLimit = Math.max(1, Math.floor(limit));
  let selected = 0;
  try {
    return await withPipelineWriter(job, async () => {
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

    const summary = await runVacancyLivenessSweep({
      batchLimit,
      domainConcurrency: VACANCY_LIVENESS_DOMAIN_CONCURRENCY,
      deadlineMs: options.deadlineMs ?? Date.now() + LIVENESS_HTTP_BUDGET_MS,
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
      done: !summary?.deadlineStopped && (summary?.remaining ?? 0) === 0,
      remaining: summary?.remaining,
      remainingIsLowerBound: summary?.remainingIsLowerBound,
    };
    }, job === "liveness" ? options.deadlineMs : undefined);
  } catch (error) {
    const deadlineReached =
      error instanceof Error &&
      (error.message === "VACANCY_JOB_DEADLINE" ||
        error.message === "Vacancy liveness sweep deadline reached");
    if (job !== "liveness" || !deadlineReached) {
      throw error;
    }
    return {
      selected,
      upserted: 0,
      live: 0,
      dead: 0,
      inconclusive: 0,
      errors: 0,
      done: false,
      remaining: Math.max(1, selected),
      remainingIsLowerBound: true,
    };
  }
}