import cron from "node-cron";
import { db, sponsorLicenceVacanciesTable } from "@workspace/db";
import { and, eq, isNotNull, lt } from "drizzle-orm";

export const SPONSOR_VACANCY_CLEANUP_GRACE_HOURS = 24;

export type SponsorVacancyCleanupResult = {
  deleted: number;
  graceHours: number;
};

/**
 * Remove only vacancies that liveness has positively classified as dead.
 * Unverified and inconclusive rows are deliberately retained for retry or
 * later discovery. The grace period protects against a transient false
 * negative before the row is physically removed.
 */
export async function runSponsorVacancyCleanup(
  options: { graceHours?: number } = {},
): Promise<SponsorVacancyCleanupResult> {
  const graceHours = Math.max(0, options.graceHours ?? SPONSOR_VACANCY_CLEANUP_GRACE_HOURS);
  const cutoff = new Date(Date.now() - graceHours * 60 * 60 * 1000);
  const deleted = await db
    .delete(sponsorLicenceVacanciesTable)
    .where(and(
      eq(sponsorLicenceVacanciesTable.liveness, "dead"),
      isNotNull(sponsorLicenceVacanciesTable.lastVerifiedAt),
      lt(sponsorLicenceVacanciesTable.lastVerifiedAt, cutoff),
    ))
    .returning({ id: sponsorLicenceVacanciesTable.id });

  console.info(
    `[vacancy-cleanup] deleted=${deleted.length} grace_hours=${graceHours}`,
  );
  return { deleted: deleted.length, graceHours };
}

export function startSponsorVacancyCleanupScheduler(): void {
  cron.schedule(
    "30 3 * * *",
    () => {
      runSponsorVacancyCleanup().catch((error) => {
        console.error(
          "[vacancy-cleanup] Scheduled cleanup failed:",
          error instanceof Error ? error.message : error,
        );
      });
    },
    { timezone: "Europe/London" },
  );
  console.log(
    `[vacancy-cleanup] Scheduler registered: daily at 03:30 Europe/London, grace ${SPONSOR_VACANCY_CLEANUP_GRACE_HOURS}h`,
  );
}