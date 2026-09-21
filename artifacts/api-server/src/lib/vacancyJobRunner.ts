import { db, pool, vacancySyncLogTable } from "@workspace/db";
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
import {
  getAdditionalBoardBackfillPage,
  getAdditionalBoardBackfillPlan,
  runAdditionalBoardProfessionBackfill,
} from "./additionalBoardProfessionBackfill";
import {
  REED_PROFESSION_BACKFILL_TARGETS,
  runReedProfessionBackfill,
} from "./reedProfessionBackfill";

export type VacancyJobKind =
  | "job_board"
  | "company_site"
  | "liveness"
  | "contact"
  | "reed_professions"
  | "additional_boards";

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
  cursor?: number;
  nextCursor?: number;
  metrics?: unknown;
};

export const PIPELINE_WRITER_LOCK = "jobsage:external-vacancy-pipeline-writer";
export const COMPANY_SITE_HTTP_BUDGET_MS = 20_000;
export const LIVENESS_HTTP_BUDGET_MS = 18_000;
export const PROFESSION_BACKFILL_HTTP_BUDGET_MS = 22_000;
export const PROFESSION_BACKFILL_HTTP_CATEGORY_LIMIT = 1;
export const PROFESSION_BACKFILL_HTTP_MAX_CATEGORY_LIMIT = 2;
/**
 * Twenty results gives each profession page materially more coverage than the
 * old eight-result cap while staying inside the 22-second HTTP budget. The
 * source clients still enforce their own request, page, pacing, URL, and
 * response limits.
 */
export const PROFESSION_BACKFILL_HTTP_RESULTS_PER_CATEGORY = 20;

export const CLI_JOB_LIMITS: Record<VacancyJobKind, number> = {
  job_board: DEFAULT_VACANCY_CHECK_BATCH_SIZE,
  company_site: COMPANY_SITE_DISCOVERY_BATCH_SIZE,
  liveness: VACANCY_LIVENESS_BATCH_LIMIT,
  contact: CONTACT_ENRICHMENT_BATCH_SIZE,
  reed_professions: PROFESSION_BACKFILL_HTTP_CATEGORY_LIMIT,
  additional_boards: PROFESSION_BACKFILL_HTTP_CATEGORY_LIMIT,
};

export type VacancyJobOptions = {
  deadlineMs?: number;
  cursor?: number;
  categoryLimit?: number;
};

function getCategoryLimit(options: VacancyJobOptions): number {
  return Math.max(
    1,
    Math.min(
      PROFESSION_BACKFILL_HTTP_MAX_CATEGORY_LIMIT,
      Math.floor(options.categoryLimit ?? PROFESSION_BACKFILL_HTTP_CATEGORY_LIMIT),
    ),
  );
}

function firstBlockedCategoryIndex(
  categories: readonly { failed?: boolean; skippedByCooldown?: boolean }[],
): number {
  return categories.findIndex((category) => category.failed || category.skippedByCooldown);
}

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
  options: VacancyJobOptions = {},
): Promise<VacancyJobSummary | null> {
  const batchLimit = Math.max(1, Math.floor(limit));
  let selected = 0;
  try {
    return await withPipelineWriter(job, async () => {
    if (job === "job_board") {
      const summary = await runVacancyCheckBatch("scheduler", { batchSize: batchLimit });
      if (!summary) return null;
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
      if (!summary) return null;
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
      const startedAt = Date.now();
      const summary = await runContactEnrichmentBatch({ batchSize: batchLimit });
      await db.insert(vacancySyncLogTable).values({
        status: summary.errors > 0 ? "error" : "success",
        batchSize: batchLimit,
        checkedCount: summary.selected,
        errorCount: summary.errors,
        errorMessage: null,
        triggeredBy: "scheduler",
        durationMs: Date.now() - startedAt,
        jobKind: "contact",
        metrics: summary,
      });
      return summary;
    }

    if (job === "reed_professions") {
      const startedAt = Date.now();
      const cursor = Math.max(0, Math.floor(options.cursor ?? 0));
      const categoryLimit = getCategoryLimit(options);
      const total = REED_PROFESSION_BACKFILL_TARGETS.length;
      const targets = REED_PROFESSION_BACKFILL_TARGETS.slice(cursor, cursor + categoryLimit);
      const result = await runReedProfessionBackfill({
        targets,
        perCategoryLimit: PROFESSION_BACKFILL_HTTP_RESULTS_PER_CATEGORY,
        totalPersistLimit: PROFESSION_BACKFILL_HTTP_RESULTS_PER_CATEGORY * Math.max(1, targets.length),
        deadlineMs: options.deadlineMs,
      });
      const blockedIndex = firstBlockedCategoryIndex(result.categories);
      const processed = result.categories.length;
      const nextCursor = cursor + (blockedIndex >= 0 ? blockedIndex : processed);
      const updated = result.categories.reduce((sum, category) => sum + category.updated, 0);
      return {
        selected: processed,
        upserted: result.inserted + updated + result.revived,
        live: result.live,
        dead: 0,
        inconclusive: 0,
        errors: result.categories.filter((category) => category.failed).length,
        done: nextCursor >= total && processed >= targets.length,
        remaining: Math.max(0, total - nextCursor),
        cursor,
        nextCursor,
        durationMs: Date.now() - startedAt,
        metrics: result,
      };
    }

    if (job === "additional_boards") {
      const startedAt = Date.now();
      const cursor = Math.max(0, Math.floor(options.cursor ?? 0));
      const categoryLimit = getCategoryLimit(options);
      const page = getAdditionalBoardBackfillPage(cursor, categoryLimit);
      const result = await runAdditionalBoardProfessionBackfill({
        sources: page.sources,
        perCategoryLimit: PROFESSION_BACKFILL_HTTP_RESULTS_PER_CATEGORY,
        deadlineMs: options.deadlineMs,
      });
      const categories = result.sources.flatMap((source) => source.categories);
      const blockedIndex = firstBlockedCategoryIndex(categories);
      const processed = categories.length;
      const nextCursor = cursor + (blockedIndex >= 0 ? blockedIndex : processed);
      const total = getAdditionalBoardBackfillPlan().length;
      return {
        selected: processed,
        upserted: result.inserted + result.updated + result.revived,
        live: result.live,
        dead: 0,
        inconclusive: 0,
        errors: categories.filter((category) => category.failed).length,
        done: nextCursor >= total && processed >= page.selected,
        remaining: Math.max(0, total - nextCursor),
        cursor,
        nextCursor,
        durationMs: Date.now() - startedAt,
        metrics: result,
      };
    }

    const summary = await runVacancyLivenessSweep({
      batchLimit,
      domainConcurrency: VACANCY_LIVENESS_DOMAIN_CONCURRENCY,
      deadlineMs: options.deadlineMs ?? Date.now() + LIVENESS_HTTP_BUDGET_MS,
      onSelected: (count) => {
        selected = count;
      },
    });
    if (!summary) return null;
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