import {
  db,
  pool,
  sponsorLicenceCompanySiteChecksTable,
  sponsorLicencesTable,
  vacancySyncLogTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  runVacancyCheckBatch,
  DEFAULT_VACANCY_CHECK_BATCH_SIZE,
} from "./vacancyCheckScheduler";
import {
  runCompanySiteDiscoveryBatch,
  COMPANY_SITE_DISCOVERY_BATCH_SIZE,
  runCompanySiteProbeDiscoveryBatch,
} from "./companySiteScheduler";
import {
  COMPANY_SITE_PROBE_BATCH_SIZE,
  COMPANY_SITE_PROBE_HTTP_BUDGET_MS,
} from "./companySiteProbe";
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
import { runFreeBoardVacancyCollector } from "./freeBoardVacancyCollector";
import { isFreeBoardSourceId } from "./freeBoardSourceRegistry";
import { REFERENCE_ATS_TARGETS } from "./referenceAtsTargets";

export type VacancyJobKind =
  | "job_board"
  | "company_site"
  | "company_site_direct_feed"
  | "company_site_probe"
  | "liveness"
  | "contact"
  | "reed_professions"
  | "additional_boards"
  | "free_board_sources"
  | "free_source_ats";

export type VacancyJobSummary = {
  selected: number;
  recordsFetched?: number;
  sponsorMatched?: number;
  saved?: number;
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
export const FREE_BOARD_HTTP_BUDGET_MS = 45_000;
export const LIVENESS_HTTP_BUDGET_MS = 18_000;
export const PROFESSION_BACKFILL_HTTP_BUDGET_MS = 22_000;
export const PROFESSION_BACKFILL_HTTP_CATEGORY_LIMIT = 2;
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
  company_site_direct_feed: COMPANY_SITE_DISCOVERY_BATCH_SIZE,
  company_site_probe: COMPANY_SITE_PROBE_BATCH_SIZE,
  liveness: VACANCY_LIVENESS_BATCH_LIMIT,
  contact: CONTACT_ENRICHMENT_BATCH_SIZE,
  reed_professions: PROFESSION_BACKFILL_HTTP_CATEGORY_LIMIT,
  additional_boards: PROFESSION_BACKFILL_HTTP_CATEGORY_LIMIT,
  free_board_sources: 5,
  free_source_ats: 5,
};

export type VacancyJobOptions = {
  deadlineMs?: number;
  cursor?: number;
  categoryLimit?: number;
  organisationNames?: readonly string[];
  sourceId?: string;
};

export { isFreeBoardSourceId };

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

async function getVerifiedReferenceAtsTargetNames(
  targets: readonly (typeof REFERENCE_ATS_TARGETS)[number][],
): Promise<string[]> {
  if (targets.length === 0) return [];
  const targetByEmployer = new Map(
    targets.map((target) => [target.employer.trim().toLowerCase(), target]),
  );
  const employerKeys = [...targetByEmployer.keys()];
  const rows = await db
    .select({
      employer: sponsorLicencesTable.organisationName,
      provider: sponsorLicenceCompanySiteChecksTable.atsProvider,
      boardId: sponsorLicenceCompanySiteChecksTable.atsBoardId,
    })
    .from(sponsorLicencesTable)
    .innerJoin(
      sponsorLicenceCompanySiteChecksTable,
      sql`lower(btrim(${sponsorLicenceCompanySiteChecksTable.organisationName})) =
          lower(btrim(${sponsorLicencesTable.organisationName}))`,
    )
    .where(and(
      inArray(
        sql<string>`lower(btrim(${sponsorLicencesTable.organisationName}))`,
        employerKeys,
      ),
      eq(sponsorLicenceCompanySiteChecksTable.atsMappingStatus, "verified"),
    ));
  const matched = new Set<string>();
  for (const row of rows) {
    if (!row.provider || !row.boardId) continue;
    const target = targetByEmployer.get(row.employer.trim().toLowerCase());
    if (
      target &&
      row.provider.trim().toLowerCase() === target.provider &&
      row.boardId.trim().toLowerCase() === target.boardId
    ) {
      matched.add(row.employer.trim());
    }
  }
  return [...matched];
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
  let releaseWhenRunSettles = false;
  const unlockAndRelease = async (): Promise<void> => {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [PIPELINE_WRITER_LOCK]);
    } catch (error) {
      console.error(
        "[vacancy-job] Failed to release writer lock:",
        error instanceof Error ? error.message : error,
      );
    } finally {
      client.release();
    }
  };
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
    if (job === "liveness") return await run();
    const runPromise = run();
    if (job !== "company_site_probe") return await wait(runPromise);
    try {
      return await wait(runPromise);
    } catch (error) {
      if (error instanceof Error && error.message === "VACANCY_JOB_DEADLINE") {
        // Bound the HTTP request without releasing serialization early. The
        // cooperative probe keeps the advisory lock until its outstanding
        // selection/writes/logging have actually settled.
        releaseWhenRunSettles = true;
        releaseAfterUnlock = true;
        void runPromise
          .catch((lateError) => {
            console.error(
              "[vacancy-job] Company-site probe settled after HTTP deadline:",
              lateError instanceof Error ? lateError.message : lateError,
            );
          })
          .finally(() => unlockAndRelease());
      }
      throw error;
    }
  } finally {
    if (acquired && !releaseWhenRunSettles) {
      releaseAfterUnlock = true;
      void unlockAndRelease();
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

    if (job === "company_site" || job === "company_site_direct_feed") {
      const directFeedsOnly = job === "company_site_direct_feed";
      const companySiteOptions: {
        batchSize: number;
        deadlineMs: number;
        organisationNames?: readonly string[];
        directFeedsOnly: boolean;
      } = {
        batchSize: batchLimit,
        deadlineMs: Date.now() + COMPANY_SITE_HTTP_BUDGET_MS,
        directFeedsOnly,
      };
      if (options.organisationNames !== undefined) {
        companySiteOptions.organisationNames = options.organisationNames;
      }
      const summary = await runCompanySiteDiscoveryBatch(companySiteOptions);
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
        metrics: {
          attempted: summary.attempted,
          completed: summary.completed,
          partial: summary.partial,
          failed: summary.failed,
          empty: summary.empty,
          careersFound: summary.careersFound,
          atsFound: summary.atsFound,
          pagesFetched: summary.pagesFetched,
          advertsExtracted: summary.advertsExtracted,
          advertsRejected: summary.advertsRejected,
          rejected: summary.advertsRejected,
          errors: summary.errors,
          inserted: summary.inserted,
          updated: summary.updated,
          revived: summary.revived,
          permanentFailures: summary.permanentFailures,
          temporaryFailures: summary.temporaryFailures,
          checked: summary.checked,
          skipped: summary.skipped,
          jobKind: job,
          directFeedsOnly,
          batchId: summary.batchId,
          employerMetrics: summary.employerMetrics,
        },
      };
    }

    if (job === "free_board_sources") {
      const summary = await runFreeBoardVacancyCollector({
        pagesPerSource: batchLimit,
        deadlineMs: options.deadlineMs ?? Date.now() + FREE_BOARD_HTTP_BUDGET_MS,
        sourceId: options.sourceId,
      });
      return {
        selected: summary.selected,
        recordsFetched: summary.recordsFetched,
        sponsorMatched: summary.sponsorMatched,
        saved: summary.saved,
        upserted: summary.upserted,
        live: 0,
        dead: 0,
        inconclusive: 0,
        errors: summary.errors,
        done: summary.done,
        remaining: summary.remaining,
        durationMs: summary.durationMs,
        metrics: summary.metrics,
      };
    }

    if (job === "free_source_ats") {
      const cursor = Math.max(0, Math.floor(options.cursor ?? 0));
      const targets = REFERENCE_ATS_TARGETS.slice(cursor, cursor + batchLimit);
      const targetNames = await getVerifiedReferenceAtsTargetNames(targets);
      let sourceSummary: Awaited<ReturnType<typeof runCompanySiteDiscoveryBatch>> = null;
      if (targetNames.length > 0) {
        sourceSummary = await runCompanySiteDiscoveryBatch({
          batchSize: targetNames.length,
          deadlineMs: options.deadlineMs ?? Date.now() + COMPANY_SITE_HTTP_BUDGET_MS,
          organisationNames: targetNames,
          directFeedsOnly: true,
        });
        if (!sourceSummary) return null;
      }
      const failed = (sourceSummary?.errors ?? 0) > 0 || sourceSummary?.done === false;
      const nextCursor = failed ? cursor : cursor + targets.length;
      const total = REFERENCE_ATS_TARGETS.length;
      return {
        selected: sourceSummary?.selected ?? 0,
        upserted: sourceSummary
          ? sourceSummary.inserted + sourceSummary.updated + sourceSummary.revived
          : 0,
        live: 0,
        dead: 0,
        inconclusive: 0,
        errors: sourceSummary?.errors ?? 0,
        done: nextCursor >= total,
        remaining: Math.max(0, total - nextCursor),
        cursor,
        nextCursor,
        durationMs: sourceSummary?.durationMs ?? 0,
        metrics: {
          referenceTargets: targets,
          verifiedMatchingTargets: targetNames,
          batch: sourceSummary,
        },
      };
    }

    if (job === "company_site_probe") {
      const summary = await runCompanySiteProbeDiscoveryBatch({
        batchSize: batchLimit,
        deadlineMs: options.deadlineMs ?? Date.now() + COMPANY_SITE_PROBE_HTTP_BUDGET_MS,
      });
      if (!summary) return null;
      return {
        selected: summary.selected,
        upserted: 0,
        live: 0,
        dead: 0,
        inconclusive: 0,
        errors: summary.errors,
        done: summary.done,
        remaining: summary.remaining,
        remainingIsLowerBound: summary.remainingIsLowerBound,
        durationMs: summary.durationMs,
        metrics: summary,
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
    }, job === "liveness" || job === "company_site_probe" ? options.deadlineMs : undefined);
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