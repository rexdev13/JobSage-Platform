import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { pool } from "@workspace/db";
import {
  runVacancyCheckBatch,
  DEFAULT_VACANCY_CHECK_BATCH_SIZE,
  VACANCY_CHECK_CONCURRENCY,
} from "./lib/vacancyCheckScheduler";
import {
  runCompanySiteDiscoveryBatch,
  COMPANY_SITE_DISCOVERY_BATCH_SIZE,
  COMPANY_SITE_DISCOVERY_CONCURRENCY,
} from "./lib/companySiteScheduler";
import {
  runVacancyLivenessSweep,
  VACANCY_LIVENESS_BATCH_LIMIT,
  VACANCY_LIVENESS_DOMAIN_CONCURRENCY,
} from "./lib/vacancyLivenessSweep";
import { getVacancyAiWebSearchDailyCap } from "./lib/vacancyAiBudget";

export type VacancyJobKind = "job_board" | "company_site" | "liveness";

const PIPELINE_WRITER_LOCK = "jobsage:external-vacancy-pipeline-writer";

function requestedJobKind(): VacancyJobKind {
  const value = process.env["VACANCY_JOB_KIND"] ?? process.argv[2];
  if (value === "job_board" || value === "company_site" || value === "liveness") {
    return value;
  }
  throw new Error(
    `VACANCY_JOB_KIND must be one of job_board, company_site, or liveness; received "${value ?? ""}".`,
  );
}

async function withPipelineWriter<T>(job: VacancyJobKind, run: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  let acquired = false;
  try {
    const lock = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [PIPELINE_WRITER_LOCK],
    );
    acquired = lock.rows[0]?.acquired === true;
    if (!acquired) {
      console.log(`[vacancy-job] job=${job} skipped=writer-lock-held selected=0 upserted=0 live=0 dead=0 inconclusive=0`);
      return null;
    }

    return await run();
  } finally {
    if (acquired) {
      await client
        .query("SELECT pg_advisory_unlock(hashtext($1))", [PIPELINE_WRITER_LOCK])
        .catch((error) => {
          console.error("[vacancy-job] Failed to release writer lock:", error instanceof Error ? error.message : error);
        });
    }
    client.release();
  }
}

async function runJob(job: VacancyJobKind): Promise<void> {
  console.log(`[vacancy-job] job=${job} environment=production database=DATABASE_URL`);

  await withPipelineWriter(job, async () => {
    if (job === "job_board") {
      const summary = await runVacancyCheckBatch("scheduler");
      console.log(
        `[vacancy-job] job=job_board selected=${summary?.selected ?? 0} checked=${summary?.checked ?? 0} ` +
          `upserted=${summary?.upserted ?? 0} live=0 dead=0 inconclusive=0 errors=${summary?.errors ?? 0} ` +
          `batch_cap=${DEFAULT_VACANCY_CHECK_BATCH_SIZE} concurrency=${VACANCY_CHECK_CONCURRENCY}`,
      );
      return;
    }

    if (job === "company_site") {
      const summary = await runCompanySiteDiscoveryBatch();
      console.log(
        `[vacancy-job] job=company_site selected=${summary?.selected ?? 0} checked=${summary?.checked ?? 0} ` +
          `upserted=${summary?.upserted ?? 0} live=0 dead=0 inconclusive=0 errors=${summary?.errors ?? 0} ` +
          `batch_cap=${COMPANY_SITE_DISCOVERY_BATCH_SIZE} concurrency=${COMPANY_SITE_DISCOVERY_CONCURRENCY}`,
      );
      return;
    }

    const summary = await runVacancyLivenessSweep({
      batchLimit: VACANCY_LIVENESS_BATCH_LIMIT,
      domainConcurrency: VACANCY_LIVENESS_DOMAIN_CONCURRENCY,
    });
    console.log(
      `[vacancy-job] job=liveness checked=${summary?.checked ?? 0} upserted=0 ` +
        `live=${summary?.live ?? 0} dead=${summary?.dead ?? 0} inconclusive=${summary?.inconclusive ?? 0} ` +
        `batch_cap=${VACANCY_LIVENESS_BATCH_LIMIT} domain_concurrency=${VACANCY_LIVENESS_DOMAIN_CONCURRENCY}`,
    );
  });
}

export async function main(): Promise<void> {
  if (process.env["VACANCY_JOB_ENV"] !== "production") {
    throw new Error("Refusing to run vacancy jobs without VACANCY_JOB_ENV=production.");
  }
  if (getVacancyAiWebSearchDailyCap() !== 0) {
    throw new Error("Refusing to run vacancy jobs unless VACANCY_AI_WEB_SEARCH_DAILY_CAP is 0.");
  }

  const job = requestedJobKind();
  try {
    await runJob(job);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error("[vacancy-job] Failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}