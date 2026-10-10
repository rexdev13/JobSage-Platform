import cron from "node-cron";
import {
  db,
  sponsorLicenceVacanciesTable,
  vacancySourceObservationsTable,
} from "@workspace/db";
import { and, eq, exists, inArray, isNotNull, like, lt } from "drizzle-orm";

export const SPONSOR_VACANCY_CLEANUP_GRACE_HOURS = 24;

export type SponsorVacancyCleanupResult = {
  deleted: number;
  graceHours: number;
};

/**
 * Remove only source-observed vacancies that liveness has positively
 * classified as dead. Rows without importer provenance are retained, even
 * when their liveness fields meet the dead/grace-period conditions.
 */
export async function runSponsorVacancyCleanup(
  options: { graceHours?: number } = {},
): Promise<SponsorVacancyCleanupResult> {
  // A caller may lengthen the grace period but cannot bypass it with graceHours: 0.
  const graceHours = Math.max(
    SPONSOR_VACANCY_CLEANUP_GRACE_HOURS,
    Math.ceil(options.graceHours ?? SPONSOR_VACANCY_CLEANUP_GRACE_HOURS),
  );
  const cutoff = new Date(Date.now() - graceHours * 60 * 60 * 1000);
  const ownedObservation = exists(
    db
      .select({ vacancyId: vacancySourceObservationsTable.vacancyId })
      .from(vacancySourceObservationsTable)
      .where(and(
        eq(vacancySourceObservationsTable.vacancyId, sponsorLicenceVacanciesTable.id),
        eq(vacancySourceObservationsTable.sourceType, sponsorLicenceVacanciesTable.sourceType),
      )),
  );
  const deleted = await db
    .delete(sponsorLicenceVacanciesTable)
    .where(and(
      eq(sponsorLicenceVacanciesTable.liveness, "dead"),
      like(sponsorLicenceVacanciesTable.livenessReason, "confirmed_dead:%"),
      isNotNull(sponsorLicenceVacanciesTable.lastVerifiedAt),
      lt(sponsorLicenceVacanciesTable.lastVerifiedAt, cutoff),
      inArray(sponsorLicenceVacanciesTable.sourceType, ["job_board", "company_site"]),
      ownedObservation,
    ))
    .returning({ id: sponsorLicenceVacanciesTable.id });

  console.info(
    `[vacancy-cleanup] deleted=${deleted.length} grace_hours=${graceHours}`,
  );
  return { deleted: deleted.length, graceHours };
}

export function startSponsorVacancyCleanupScheduler(): void {
  if (process.env.NODE_ENV === "production") {
    console.info(
      "[vacancy-cleanup] Production scheduler disabled; destructive cleanup requires an explicit reviewed run.",
    );
    return;
  }

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