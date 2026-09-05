import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { pool } from "@workspace/db";
import {
  CLI_JOB_LIMITS,
  runVacancyJob,
  type VacancyJobKind,
} from "./lib/vacancyJobRunner";
import { getVacancyAiWebSearchDailyCap } from "./lib/vacancyAiBudget";

function requestedJobKind(): VacancyJobKind {
  const value = process.env["VACANCY_JOB_KIND"] ?? process.argv[2];
  if (value === "job_board" || value === "company_site" || value === "liveness") {
    return value;
  }
  throw new Error(
    `VACANCY_JOB_KIND must be one of job_board, company_site, or liveness; received "${value ?? ""}".`,
  );
}

async function runJob(job: VacancyJobKind): Promise<void> {
  console.log(`[vacancy-job] job=${job} environment=production database=DATABASE_URL`);
  const summary = await runVacancyJob(job, CLI_JOB_LIMITS[job]);
  console.log(
    `[vacancy-job] job=${job} selected=${summary?.selected ?? 0} upserted=${summary?.upserted ?? 0} ` +
      `live=${summary?.live ?? 0} dead=${summary?.dead ?? 0} inconclusive=${summary?.inconclusive ?? 0} ` +
      `errors=${summary?.errors ?? 0} done=${summary?.done ?? false} batch_cap=${CLI_JOB_LIMITS[job]}`,
  );
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